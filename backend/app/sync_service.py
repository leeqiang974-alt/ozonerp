"""Read-only, idempotent Ozon-to-ERP synchronization services."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .erp_models import FbsPostingLineRecord, FbsPostingRecord, OzonCategoryCacheRecord, ProductRecord, SkuRecord, SyncRun
from .integrations.ozon_seller import OzonSellerClient, OzonSellerError
from .models import ApiCredential, Shop
from .security import CredentialEncryptionUnavailable, decrypt_secret


class SyncConfigurationError(RuntimeError):
    pass


def sync_products(db: Session, shop_id: int, *, limit: int, last_id: str) -> SyncRun:
    return _run(db, shop_id, "products", lambda client: _upsert_products(db, shop_id, client.list_products(limit=limit, last_id=last_id)))


def sync_fbs_postings(
    db: Session, shop_id: int, *, since: datetime, to: datetime, limit: int, offset: int, status: str
) -> SyncRun:
    return _run(
        db,
        shop_id,
        "fbs_postings",
        lambda client: _upsert_postings(
            db,
            shop_id,
            client.list_fbs_postings(
                since=_to_ozon_timestamp(since), to=_to_ozon_timestamp(to), limit=limit, offset=offset, status=status
            ),
        ),
    )


def sync_fbs_product_images(db: Session, shop_id: int) -> SyncRun:
    return _run(db, shop_id, "fbs_product_images", lambda client: _sync_posting_images(db, shop_id, client))


def sync_category_cache(db: Session, shop_id: int) -> SyncRun:
    return _run(db, shop_id, "categories", lambda client: _replace_category_cache(db, shop_id, client.get_category_tree()))


def _run(db: Session, shop_id: int, resource: str, operation) -> SyncRun:
    if db.get(Shop, shop_id) is None:
        raise SyncConfigurationError("店铺不存在")
    run = SyncRun(shop_id=shop_id, resource=resource, status="running")
    db.add(run)
    db.commit()
    db.refresh(run)
    try:
        client_id, api_key = _credentials(db, shop_id)
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            records_seen, records_changed, cursor = operation(client)
        run.status = "succeeded"
        run.records_seen = records_seen
        run.records_changed = records_changed
        run.cursor = cursor
    except (OzonSellerError, ValueError, SyncConfigurationError) as exc:
        run.status = "failed"
        run.error_summary = _safe_error(exc)
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run


def _credentials(db: Session, shop_id: int) -> tuple[str, str]:
    if db.get(Shop, shop_id) is None:
        raise SyncConfigurationError("店铺不存在")
    credential = db.scalar(select(ApiCredential).where(ApiCredential.shop_id == shop_id, ApiCredential.provider == "ozon"))
    if credential is None or credential.status != "configured" or not credential.client_id_reference or not credential.encrypted_secret_placeholder:
        raise SyncConfigurationError("店铺尚未配置 Ozon 授权")
    try:
        return credential.client_id_reference, decrypt_secret(credential.encrypted_secret_placeholder)
    except CredentialEncryptionUnavailable as exc:
        raise SyncConfigurationError("店铺授权无法解密，请检查本地加密密钥") from exc


def _upsert_products(db: Session, shop_id: int, response: dict[str, Any]) -> tuple[int, int, str | None]:
    items = response.get("items", [])
    if not isinstance(items, list):
        raise ValueError("Ozon 商品响应格式错误")
    changed = 0
    for item in items:
        if not isinstance(item, dict) or item.get("product_id") is None:
            continue
        ozon_product_id = str(item["product_id"])
        offer_id = str(item.get("offer_id") or ozon_product_id)
        name = str(item.get("name") or item.get("title") or offer_id)
        product = db.scalar(select(ProductRecord).where(ProductRecord.shop_id == shop_id, ProductRecord.ozon_product_id == ozon_product_id))
        if product is None:
            product = ProductRecord(shop_id=shop_id, ozon_product_id=ozon_product_id, offer_id=offer_id, name=name)
            db.add(product)
        else:
            product.offer_id, product.name = offer_id, name
        product.raw_payload = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        db.flush()
        sku = db.scalar(select(SkuRecord).where(SkuRecord.shop_id == shop_id, SkuRecord.seller_sku == offer_id))
        if sku is None:
            db.add(SkuRecord(shop_id=shop_id, product_id=product.id, seller_sku=offer_id, title=name))
        else:
            sku.product_id, sku.title = product.id, name
        changed += 1
    return len(items), changed, str(response.get("last_id") or "") or None


def _upsert_postings(db: Session, shop_id: int, response: dict[str, Any]) -> tuple[int, int, str | None]:
    result = response.get("result", {})
    postings = result.get("postings", []) if isinstance(result, dict) else []
    if not isinstance(postings, list):
        raise ValueError("Ozon FBS 订单响应格式错误")
    changed = 0
    for posting in postings:
        if not isinstance(posting, dict) or not posting.get("posting_number"):
            continue
        number = str(posting["posting_number"])
        raw_status = str(posting.get("status") or "")
        record = db.scalar(select(FbsPostingRecord).where(FbsPostingRecord.shop_id == shop_id, FbsPostingRecord.posting_number == number))
        if record is None:
            record = FbsPostingRecord(shop_id=shop_id, posting_number=number, normalized_status=_normalize_status(raw_status))
            db.add(record)
            db.flush()
        record.raw_ozon_status = raw_status or None
        record.normalized_status = _normalize_status(raw_status)
        record.pack_by = _parse_ozon_time(posting.get("shipment_date") or posting.get("delivering_date"))
        record.raw_payload = json.dumps(posting, ensure_ascii=False, separators=(",", ":"))
        _replace_posting_lines(db, record.id, posting.get("products"))
        changed += 1
    return len(postings), changed, None


def _sync_posting_images(db: Session, shop_id: int, client: OzonSellerClient) -> tuple[int, int, str | None]:
    current = datetime.now(timezone.utc)
    stale_before = current - timedelta(hours=24)
    lines = list(db.scalars(
        select(FbsPostingLineRecord).join(FbsPostingRecord).where(
            FbsPostingRecord.shop_id == shop_id,
            or_(FbsPostingLineRecord.image_synced_at.is_(None), FbsPostingLineRecord.image_synced_at < stale_before),
        )
    ))
    product_ids = sorted({int(line.ozon_product_id) for line in lines if line.ozon_product_id and line.ozon_product_id.isdigit()})
    skus = sorted({int(line.ozon_sku) for line in lines if line.ozon_sku and line.ozon_sku.isdigit()})
    if not product_ids and not skus:
        return 0, 0, None
    image_by_product_id: dict[str, str] = {}
    image_by_sku: dict[str, str] = {}
    if product_ids:
        image_by_product_id = _image_map(client.get_product_info(product_ids=product_ids), "id")
    if skus:
        image_by_sku = _image_map(client.get_product_info(skus=skus), "sku")
    changed = 0
    for line in lines:
        image_url = image_by_product_id.get(line.ozon_product_id or "") or image_by_sku.get(line.ozon_sku or "")
        if image_url and line.image_url != image_url:
            line.image_url = image_url
            changed += 1
        line.image_synced_at = current
    return len(product_ids) + len(skus), changed, None


def _image_map(response: dict[str, Any], identifier_key: str) -> dict[str, str]:
    items = response.get("items", [])
    if not isinstance(items, list):
        raise ValueError("Ozon 商品图片响应格式错误")
    output: dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict) or item.get(identifier_key) is None:
            continue
        candidate = item.get("primary_image") or item.get("image")
        if isinstance(candidate, list):
            candidate = candidate[0] if candidate else None
        if not candidate and isinstance(item.get("images"), list) and item["images"]:
            candidate = item["images"][0]
        if isinstance(candidate, str) and candidate.startswith(("https://", "http://")):
            output[str(item[identifier_key])] = candidate
    return output


def _replace_category_cache(db: Session, shop_id: int, response: dict[str, Any]) -> tuple[int, int, str | None]:
    nodes = response.get("result", [])
    if not isinstance(nodes, list):
        raise ValueError("Ozon 类目树响应格式错误")
    db.query(OzonCategoryCacheRecord).filter(OzonCategoryCacheRecord.shop_id == shop_id).delete()

    def walk(items: Any, parent_category: str | None = None, parent_title: str | None = None) -> int:
        count = 0
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict) or item.get("disabled") is True:
                continue
            category_id = item.get("description_category_id")
            if category_id is not None:
                count += walk(item.get("children"), str(category_id), str(item.get("category_name") or "未命名类目"))
            elif item.get("type_id") is not None and parent_category:
                type_title = str(item.get("type_name") or "未命名类型")
                db.add(OzonCategoryCacheRecord(
                    shop_id=shop_id,
                    category_id=parent_category,
                    type_id=str(item["type_id"]),
                    title=f"{parent_title or ''} / {type_title}".strip(" /"),
                    parent_id=None,
                ))
                count += 1
        return count

    count = walk(nodes)
    return count, count, None


def _normalize_status(raw: str) -> str:
    value = raw.lower()
    if "awaiting_pack" in value or "packaging" in value: return "awaiting_packaging"
    if "awaiting_deliver" in value: return "awaiting_deliver"
    if "delivering" in value: return "delivering"
    if "delivered" in value: return "delivered"
    if "cancel" in value: return "cancelled"
    return "new"


def _replace_posting_lines(db: Session, posting_id: int, products: Any) -> None:
    if not isinstance(products, list):
        return
    existing = {
        line.offer_id: line
        for line in db.scalars(select(FbsPostingLineRecord).where(FbsPostingLineRecord.posting_id == posting_id))
    }
    seen: set[str] = set()
    for product in products:
        if not isinstance(product, dict):
            continue
        offer_id = str(product.get("offer_id") or product.get("sku") or product.get("product_id") or "")
        if not offer_id:
            continue
        seen.add(offer_id)
        quantity = product.get("quantity", 1)
        line = existing.get(offer_id)
        if line is None:
            line = FbsPostingLineRecord(posting_id=posting_id, offer_id=offer_id)
            db.add(line)
        line.ozon_product_id = str(product["product_id"]) if product.get("product_id") is not None else None
        line.ozon_sku = str(product["sku"]) if product.get("sku") is not None else None
        line.name = str(product.get("name")) if product.get("name") else None
        line.quantity = max(int(quantity), 1)
    for offer_id, line in existing.items():
        if offer_id not in seen:
            db.delete(line)


def _parse_ozon_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value: return None
    try: return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError: return None


def _to_ozon_timestamp(value: datetime) -> str:
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return aware.isoformat().replace("+00:00", "Z")


def _safe_error(exc: Exception) -> str:
    return str(exc)[:1000]
