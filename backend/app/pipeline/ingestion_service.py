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

from ..erp_models import SourceMediaRecord, SourceProductRecord, SourceVariantRecord
from .contract import normalize_snapshot, validate_or_raise


def ingest_source_product(db: Session, shop_id: int, snapshot: dict[str, Any]) -> SourceProductRecord:
    """Validate, normalise, and upsert a 1688 product snapshot."""
    validate_or_raise(snapshot)
    data = normalize_snapshot(snapshot)
    platform = data["source_platform"]
    source_pid = data["source_product_id"]
    existing = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.source_platform == platform,
        SourceProductRecord.source_product_id == source_pid,
        SourceProductRecord.shop_id == shop_id,
    ))
    if existing is None:
        record = SourceProductRecord(
            shop_id=shop_id,
            source_platform=platform,
            source_product_id=source_pid,
            source_url=data["source_url"],
            title=data["title"],
            raw_json=json.dumps(snapshot, ensure_ascii=False),
            main_image_url=data["main_image_url"],
            category_hint=data["category_hint"],
            brand=data["brand"],
            material=data["material"],
            ingestion_status="ingested",
        )
        db.add(record)
    else:
        record = existing
        record.source_url = data["source_url"]
        record.title = data["title"]
        record.raw_json = json.dumps(snapshot, ensure_ascii=False)
        record.main_image_url = data["main_image_url"]
        record.category_hint = data["category_hint"]
        record.brand = data["brand"]
        record.material = data["material"]
        record.ingestion_status = "updated"
        db.query(SourceVariantRecord).filter(SourceVariantRecord.source_product_id == record.id).delete()
        db.query(SourceMediaRecord).filter(SourceMediaRecord.source_product_id == record.id).delete()
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
    for media_data in data["media"]:
        db.add(SourceMediaRecord(
            source_product_id=record.id,
            media_type=media_data["media_type"],
            url=media_data["url"],
            sort_order=media_data["sort_order"],
            is_primary=media_data["is_primary"],
        ))
    db.commit()
    db.refresh(record)
    return record


def list_source_products(db: Session, shop_id: int, limit: int = 200) -> list[SourceProductRecord]:
    return list(db.scalars(select(SourceProductRecord).where(
        SourceProductRecord.shop_id == shop_id,
    ).order_by(SourceProductRecord.id.desc()).limit(limit)))


def get_source_product(db: Session, shop_id: int, source_product_id: int) -> SourceProductRecord:
    record = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.id == source_product_id,
        SourceProductRecord.shop_id == shop_id,
    ))
    if record is None:
        raise ValueError("source product not found")
    return record
