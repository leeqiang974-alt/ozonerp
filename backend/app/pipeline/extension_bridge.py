"""Bridge between the Chrome extension and the P0-P7 pipeline.

Translates the extension's capture payload (manual_capture_v1 contract)
into the pipeline's SourceProductIngest format and ingests it idempotently.
Also provides the store-list and crawler-worker endpoints the extension
polls so it can operate without the legacy ERP on port 5178.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..erp_models import SourceProductRecord
from ..models import ApiCredential, Shop
from .ingestion_service import ingest_source_product


def translate_capture(payload: dict[str, Any], shop_id: int) -> dict[str, Any]:
    """Convert an extension capture payload to the pipeline ingest format."""
    offer_id = str(payload.get("offerId") or payload.get("source_product_id") or "").strip()
    if not offer_id:
        # Fall back to URL path extraction
        url = str(payload.get("url") or "")
        import re
        match = re.search(r"/offer/(\d+)", url)
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
    # Use supplier as brand fallback
    if not brand:
        brand = str(payload.get("supplier") or "").strip() or None
    # Images
    raw_images = payload.get("images") or []
    if isinstance(raw_images, list):
        image_urls = [str(url).strip() for url in raw_images if str(url).strip()]
    else:
        image_urls = []
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
            image_url = str(sv.get("image") or "").strip() or None
            variants_list.append({
                "source_sku": source_sku,
                "spec_name": spec_name,
                "price_cny": price_decimal,
                "stock": stock_int,
                "image_url": image_url,
            })
    if not variants_list:
        variants_list.append({
            "source_sku": "default",
            "spec_name": "default",
            "price_cny": None,
            "stock": 0,
            "image_url": None,
        })
    return {
        "source_platform": "1688",
        "source_product_id": offer_id,
        "title": title,
        "source_url": str(payload.get("url") or "").strip() or None,
        "main_image_url": main_image,
        "category_hint": category_hint or None,
        "brand": brand or None,
        "material": material or None,
        "variants": variants_list,
        "media": media_list,
    }


def ingest_capture(db: Session, shop_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Ingest an extension capture payload and return the extension-expected response."""
    translated = translate_capture(payload, shop_id)
    # Check for duplicate before ingesting
    existing = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.source_platform == "1688",
        SourceProductRecord.source_product_id == translated["source_product_id"],
        SourceProductRecord.shop_id == shop_id,
    ))
    record = ingest_source_product(db, shop_id, translated)
    return {
        "ok": True,
        "id": str(record.id),
        "duplicate": existing is not None,
        "duplicateMessage": "该 1688 商品已采集过，已更新为最新数据" if existing is not None else "",
        "title": record.title,
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
