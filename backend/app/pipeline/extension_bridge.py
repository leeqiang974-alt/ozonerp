"""Bridge between the Chrome extension and the P0-P7 pipeline.

Translates the extension's capture payload (manual_capture_v1 contract)
into the pipeline's SourceProductIngest format and ingests it idempotently.
Also provides the store-list and crawler-worker endpoints the extension
polls so it can operate without the legacy ERP on port 5178.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..erp_models import SourceMediaRecord, SourceProductRecord
from ..models import ApiCredential, Shop
from .ingestion_service import ingest_source_product
from ..source_duplicate_service import source_publication_status


MEDIA_PROXY_BASE = "https://media.woxq.cn/proxy?url="


def _media_proxy_url(url: str) -> str:
    """Convert a third-party media URL to the project's durable media proxy."""
    value = str(url or "").strip()
    if not value or value.startswith(MEDIA_PROXY_BASE):
        return value
    if not value.lower().startswith(("http://", "https://")):
        return value
    return MEDIA_PROXY_BASE + quote(value, safe="")


def translate_capture(payload: dict[str, Any], shop_id: int, *, source_platform: str = "1688") -> dict[str, Any]:
    """Convert an extension capture payload to the pipeline ingest format."""
    offer_id = str(payload.get("offerId") or payload.get("source_product_id") or payload.get("productId") or payload.get("sku") or "").strip()
    if not offer_id:
        # Fall back to URL path extraction
        url = str(payload.get("url") or "")
        import re
        # 1688: /offer/xxx.html or /offer/xxx/yyy.html
        # Ozon: /product/name-123456789/ or /product/123456789/
        match = (
            re.search(r"/offer/(\d+)", url)
            or re.search(r"/product/[^/]*?-(\d+)/?", url)
            or re.search(r"/product/(\d+)/", url)
            or re.search(r"/product/[^/]+/(\d+)", url)
        )
        offer_id = match.group(1) if match else ""
    title = str(payload.get("title") or "").strip()[:500]
    if not title:
        raise ValueError("capture payload missing title")
    # Extract material/brand from attributes
    attributes = payload.get("attributes") or []
    material = ""
    brand = ""
    category_hint = ""
    for attr in attributes:
        if not isinstance(attr, dict):
            continue
        name = str(attr.get("name") or "").lower()
        value = str(attr.get("value") or "").strip()
        if not value:
            continue
        if "material" in name or "材质" in name:
            material = value
        elif "brand" in name or "品牌" in name:
            brand = value
        elif "category" in name or "类目" in name or "分类" in name:
            category_hint = value
    # Shangpinbang supplement: extract category/brand from its panel
    spb = payload.get("shangpinbang") or {}
    if isinstance(spb, dict):
        if not brand and spb.get("brand"):
            brand = str(spb["brand"]).strip() or None
        if not category_hint and spb.get("category"):
            category_hint = str(spb["category"]).strip()[:500]
    # Use supplier as brand fallback
    if not brand:
        brand = str(payload.get("supplier") or "").strip() or None
    source_shop_name = str(payload.get("sourceShopName") or payload.get("supplier") or "").strip()[:300] or None
    source_shop_key = str(payload.get("sourceShopKey") or "").strip()[:180] or None
    # Images
    raw_images = payload.get("images") or []
    if isinstance(raw_images, list):
        image_urls = [str(url).strip() for url in raw_images if str(url).strip()]
    else:
        image_urls = []
    # Ozon capture sends a single primary image as "image"
    single_image = str(payload.get("image") or "").strip()
    if single_image and single_image not in image_urls:
        image_urls.insert(0, single_image)
    main_image = image_urls[0] if image_urls else None
    # Media
    media_list = []
    for i, url in enumerate(image_urls):
        media_list.append({
            "url": url,
            "media_type": "image",
            "sort_order": i,
            "is_primary": i == 0,
        })
    # Add detail images
    detail_images = payload.get("detailImages") or []
    if isinstance(detail_images, list):
        for url in detail_images:
            url = str(url).strip()
            if url and url not in image_urls:
                media_list.append({
                    "url": url,
                    "media_type": "image",
                    "sort_order": len(media_list),
                    "is_primary": False,
                })
    # The extension returns one optional product video as `video`.  It must be
    # persisted as source media instead of being left in the raw capture only,
    # otherwise the collection box and listing editor cannot display it.
    video = payload.get("video")
    if isinstance(video, dict):
        video_url = str(video.get("url") or "").strip()
        if video_url:
            media_list.append({
                "url": _media_proxy_url(video_url),
                "media_type": "video",
                "sort_order": len(media_list),
                "is_primary": False,
            })
    # Variants
    raw_variants = payload.get("skuVariants") or []
    variants_list = []
    if isinstance(raw_variants, list):
        for i, sv in enumerate(raw_variants):
            if not isinstance(sv, dict):
                continue
            source_sku = str(sv.get("skuId") or sv.get("spec") or f"var{i}").strip()
            spec_name = str(sv.get("spec") or sv.get("specName") or source_sku).strip()
            price = sv.get("price")
            try:
                price_decimal = float(price) if price is not None else None
            except (TypeError, ValueError):
                price_decimal = None
            stock = sv.get("stock")
            try:
                stock_int = int(stock) if stock is not None else 0
            except (TypeError, ValueError):
                stock_int = 0
            image_url = str(sv.get("image") or sv.get("skuImageUrl") or sv.get("sku_image_url") or "").strip() or None
            # Preserve per-SKU weight/dimensions from extension
            sku_pkg = {}
            for dim_key in ("weightG", "lengthMm", "widthMm", "heightMm"):
                val = sv.get(dim_key)
                if val:
                    sku_pkg[dim_key] = str(val)
            variants_list.append({
                "source_sku": source_sku,
                "spec_name": spec_name,
                "price_cny": price_decimal,
                "stock": stock_int,
                "image_url": image_url,
                **sku_pkg,
            })
    if not variants_list:
        variants_list.append({
            "source_sku": "default",
            "spec_name": "default",
            "price_cny": None,
            "stock": 0,
            "image_url": None,
        })
    # Keep SKU-specific images on their variant rows only.  Public gallery
    # images are subject to Ozon's product-level cap; mixing variant images
    # here would make a public-gallery trim silently remove SKU evidence.
    # Preserve source tracking and supplement data in raw_json for audit
    extra = {}
    # Preserve full attributes list and description for AI description generation
    if attributes:
        extra["attributes"] = attributes
    if payload.get("description"):
        extra["source_description"] = str(payload["description"]).strip()[:10000]
    if payload.get("sources"):
        extra["sources"] = payload["sources"]
    if payload.get("shangpinbang"):
        extra["shangpinbang"] = payload["shangpinbang"]
    if payload.get("price") is not None:
        extra["list_price_rub"] = payload["price"]
    if payload.get("oldPrice") is not None:
        extra["list_old_price_rub"] = payload["oldPrice"]
    if payload.get("rating") is not None:
        extra["rating"] = payload["rating"]
    if payload.get("reviewCount") is not None:
        extra["review_count"] = payload["reviewCount"]
    if payload.get("image"):
        extra["primary_image_url"] = payload["image"]
    extra["media_complete"] = bool(payload.get("mediaComplete"))
    if isinstance(video, dict):
        extra["video"] = {
            "url": _media_proxy_url(str(video.get("url") or "").strip()),
            "sourceUrl": str(video.get("url") or "").strip(),
            "coverUrl": _media_proxy_url(str(video.get("coverUrl") or "").strip()),
            "title": str(video.get("title") or "").strip()[:500],
            "videoId": str(video.get("videoId") or "").strip()[:200],
        }
    # Preserve packageInfo (weightG, lengthMm, widthMm, heightMm) for variant auto-fill
    pkg = payload.get("packageInfo")
    if isinstance(pkg, dict) and (pkg.get("weightG") or pkg.get("lengthMm")):
        extra["packageInfo"] = {
            "weightG": str(pkg.get("weightG") or ""),
            "lengthMm": str(pkg.get("lengthMm") or ""),
            "widthMm": str(pkg.get("widthMm") or ""),
            "heightMm": str(pkg.get("heightMm") or ""),
        }
    return {
        "source_platform": source_platform,
        "source_product_id": offer_id,
        "title": title,
        "source_url": str(payload.get("url") or "").strip() or None,
        "source_shop_name": source_shop_name,
        "source_shop_key": source_shop_key,
        "main_image_url": main_image,
        "category_hint": category_hint or None,
        "brand": brand or None,
        "material": material or None,
        "variants": variants_list,
        "media": media_list,
        **extra,
    }


def ingest_capture(db: Session, shop_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Ingest an extension capture payload and return the extension-expected response."""
    translated = translate_capture(payload, shop_id)
    # Check for duplicate before ingesting
    existing = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.source_platform == "1688",
        SourceProductRecord.source_product_id == translated["source_product_id"],
    ))
    record = ingest_source_product(db, shop_id, translated)
    image_count = sum(1 for media in db.scalars(select(SourceMediaRecord).where(
        SourceMediaRecord.source_product_id == record.id,
        SourceMediaRecord.media_type == "image",
    )))
    duplicate_status = source_publication_status(db, "1688", translated["source_product_id"], current_shop_id=shop_id)
    published_names = "、".join(row["shop_name"] for row in duplicate_status["published_shops"])
    return {
        "ok": True,
        "id": str(record.id),
        "duplicate": existing is not None,
        "duplicateMessage": (
            f"该 1688 商品已发布到：{published_names}" if published_names
            else "该 1688 商品已采集过，ERP 已保留原记录"
        ) if existing is not None else "",
        "duplicateStatus": duplicate_status,
        "title": record.title,
        "receivedAt": record.updated_at.isoformat() if record.updated_at else "",
        "imageCount": image_count,
    }


def capture_status(db: Session, shop_id: int, source_platform: str, offer_id: str) -> dict[str, Any]:
    return source_publication_status(db, source_platform, offer_id, current_shop_id=shop_id)


def ingest_ozon_capture(db: Session, shop_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Ingest a public Ozon detail-page snapshot as a rework source.

    Public-page price is intentionally kept only in raw_json: it is normally
    RUB and must never be treated as the ERP's CNY procurement cost.
    """
    translated = translate_capture(payload, shop_id, source_platform="ozon_public")
    existing = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.source_platform == "ozon_public",
        SourceProductRecord.source_product_id == translated["source_product_id"],
        SourceProductRecord.shop_id == shop_id,
    ))
    record = ingest_source_product(db, shop_id, translated)
    return {
        "ok": True,
        "id": str(record.id),
        "duplicate": existing is not None,
        "duplicateMessage": "该 Ozon 商品已采集过，已更新最新快照" if existing is not None else "",
        "title": record.title,
        "source_platform": record.source_platform,
        "receivedAt": record.updated_at.isoformat() if record.updated_at else "",
    }


def stores_for_extension(db: Session) -> dict[str, Any]:
    """Return shops in the format the extension's popup expects."""
    shops = list(db.scalars(select(Shop).where(Shop.is_active).order_by(Shop.id)))
    stores = []
    for shop in shops:
        cred = db.scalar(select(ApiCredential).where(
            ApiCredential.shop_id == shop.id,
            ApiCredential.provider == "ozon",
        ))
        stores.append({
            "id": str(shop.id),
            "name": shop.name,
            "clientId": cred.client_id_reference if cred else "",
        })
    return {"stores": stores}
