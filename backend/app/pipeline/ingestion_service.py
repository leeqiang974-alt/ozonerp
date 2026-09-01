"""P1: Source ingestion and normalisation.

Takes validated 1688 snapshots and persists them into source_products /
source_variants / source_media with idempotent upsert semantics: re-importing
the same source_product_id updates the record instead of creating a duplicate.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..erp_models import SourceMediaRecord, SourceProductRecord, SourceProductShopRecord, SourceVariantRecord
from .contract import normalize_snapshot, validate_or_raise


def _filter_media_urls(media_list: list[dict]) -> list[dict]:
    """Keep supplier detail media, removing only provable duplicate/thumbnail URLs."""
    seen = set()
    result = []
    for m in media_list:
        url = m.get("url", "")
        if not url:
            continue
        # Skip trailing-underscore duplicates (1688 scraper artifact)
        if url.endswith(".jpg_") or url.endswith(".png_"):
            continue
        # Skip tiny thumbnails by URL pattern
        if any(s in url for s in ["_60x60", "_50x50", "_40x40", "_30x30", "_20x20"]):
            continue
        # Deduplicate (case-insensitive, normalize trailing underscore)
        key = url.lower().rstrip("_")
        if key in seen:
            continue
        seen.add(key)
        result.append(m)
    return result


def ingest_source_product(db: Session, shop_id: int, snapshot: dict[str, Any]) -> SourceProductRecord:
    """Validate, normalise, and upsert a 1688 product snapshot."""
    validate_or_raise(snapshot)
    data = normalize_snapshot(snapshot)
    platform = data["source_platform"]
    source_pid = data["source_product_id"]
    existing = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.source_platform == platform,
        SourceProductRecord.source_product_id == source_pid,
    ))
    if existing is None:
        record = SourceProductRecord(
            shop_id=shop_id,
            source_platform=platform,
            source_product_id=source_pid,
            source_url=data["source_url"],
            source_shop_name=data["source_shop_name"],
            source_shop_key=data["source_shop_key"],
            title=data["title"],
            raw_json=json.dumps(snapshot, ensure_ascii=False),
            main_image_url=data["main_image_url"],
            category_hint=data["category_hint"],
            brand=data["brand"],
            material=data["material"],
            ingestion_status="ingested",
        )
        db.add(record)
    elif existing.shop_id == shop_id:
        record = existing
        record.source_url = data["source_url"]
        record.source_shop_name = data["source_shop_name"] or record.source_shop_name
        record.source_shop_key = data["source_shop_key"] or record.source_shop_key
        record.title = data["title"]
        record.raw_json = json.dumps(snapshot, ensure_ascii=False)
        record.main_image_url = data["main_image_url"]
        record.category_hint = data["category_hint"]
        record.brand = data["brand"]
        record.material = data["material"]
        record.ingestion_status = "updated"
        db.query(SourceVariantRecord).filter(SourceVariantRecord.source_product_id == record.id).delete()
        # Re-captures are evidence refreshes, not replacements. Keep media
        # already collected from the detail page and merge newly discovered
        # URLs below; otherwise a second capture containing only the currently
        # visible five thumbnails would erase the original gallery.
    else:
        # One immutable source identity is shared across shops. Do not reassign or
        # overwrite another shop's evidence snapshot merely because it was captured again.
        record = existing
    # A newly created source needs its database identity before the per-shop
    # inbox link can reference it. Bulk automation reaches this path before
    # any incidental query/autoflush, unlike some interactive flows.
    if record.id is None:
        db.flush()
    if db.scalar(select(SourceProductShopRecord.id).where(
        SourceProductShopRecord.source_product_id == record.id,
        SourceProductShopRecord.shop_id == shop_id,
        SourceProductShopRecord.is_deleted.is_(False),
    )) is None:
        existing_link = db.scalar(select(SourceProductShopRecord).where(
            SourceProductShopRecord.source_product_id == record.id,
            SourceProductShopRecord.shop_id == shop_id,
        ))
        if existing_link is None:
            db.add(SourceProductShopRecord(source_product_id=record.id, shop_id=shop_id))
    if existing is not None and existing.shop_id != shop_id:
        db.commit()
        db.refresh(record)
        return record
    db.flush()
    for variant_data in data["variants"]:
        db.add(SourceVariantRecord(
            source_product_id=record.id,
            source_sku=variant_data["source_sku"],
            spec_name=variant_data["spec_name"],
            price_cny=variant_data["price_cny"],
            stock=variant_data["stock"],
            image_url=variant_data["image_url"],
            raw_json=variant_data["raw_json"],
        ))
    incoming_media = _filter_media_urls(data["media"])
    if existing is not None and data.get("media_complete"):
        # A complete structured capture contains gallery + SKU + fetched detail
        # media. Replace legacy blind-DOM results so old page icons and badges do
        # not survive forever after a corrected recapture.
        db.query(SourceMediaRecord).filter(SourceMediaRecord.source_product_id == record.id).delete()
        db.flush()
    existing_media = list(db.scalars(select(SourceMediaRecord).where(
        SourceMediaRecord.source_product_id == record.id,
    )))
    existing_keys = {(str(row.media_type or "image"), str(row.url or "").lower().rstrip("_")) for row in existing_media}
    next_sort_order = (max((int(row.sort_order or 0) for row in existing_media), default=-1) + 1)
    for media_data in incoming_media:
        media_type = str(media_data.get("media_type") or "image")
        url = str(media_data.get("url") or "").strip()
        key = (media_type, url.lower().rstrip("_"))
        if not url or key in existing_keys:
            continue
        db.add(SourceMediaRecord(
            source_product_id=record.id,
            media_type=media_type,
            url=url,
            sort_order=next_sort_order,
            is_primary=bool(media_data.get("is_primary")) and not existing_media,
        ))
        existing_keys.add(key)
        next_sort_order += 1
    db.commit()
    db.refresh(record)
    return record


def list_source_products(db: Session, shop_id: int, limit: int = 200) -> list[SourceProductRecord]:
    return list(db.scalars(select(SourceProductRecord).join(
        SourceProductShopRecord, SourceProductShopRecord.source_product_id == SourceProductRecord.id,
    ).where(
        SourceProductShopRecord.shop_id == shop_id,
        SourceProductShopRecord.is_deleted.is_(False),
    ).order_by(SourceProductRecord.id.desc()).limit(limit)))


def get_source_product(db: Session, shop_id: int, source_product_id: int) -> SourceProductRecord:
    record = db.scalar(select(SourceProductRecord).join(
        SourceProductShopRecord, SourceProductShopRecord.source_product_id == SourceProductRecord.id,
    ).where(SourceProductRecord.id == source_product_id, SourceProductShopRecord.shop_id == shop_id, SourceProductShopRecord.is_deleted.is_(False)))
    if record is None:
        raise ValueError("source product not found")
    return record
