"""Strong-identity duplicate checks for collected source products."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .erp_models import ListingDraftRecord, SourceProductRecord
from .models import Shop


PUBLISHED_DRAFT_STATUSES = {"submitted"}


def source_publication_status(
    db: Session, source_platform: str, source_product_id: str, *, current_shop_id: int | None = None,
) -> dict:
    source = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.source_platform == source_platform,
        SourceProductRecord.source_product_id == str(source_product_id),
    ))
    if source is None:
        return {
            "collected": False, "source_record_id": None, "current_shop_published": False,
            "other_shop_published": False, "published_shops": [],
        }
    shops = {shop.id: shop.name for shop in db.scalars(select(Shop))}
    published_shops: list[dict] = []
    for draft in db.scalars(select(ListingDraftRecord).where(
        ListingDraftRecord.source_product_id == source.id,
    ).order_by(ListingDraftRecord.id)):
        if draft.status not in PUBLISHED_DRAFT_STATUSES and not draft.import_task_id and not draft.ozon_product_id:
            continue
        published_shops.append({
            "shop_id": draft.shop_id,
            "shop_name": shops.get(draft.shop_id, f"店铺 {draft.shop_id}"),
            "draft_id": draft.id,
            "offer_id": draft.offer_id,
            "ozon_product_id": draft.ozon_product_id,
        })
    return {
        "collected": True,
        "source_record_id": source.id,
        "collected_shop_id": source.shop_id,
        "collected_shop_name": shops.get(source.shop_id, f"店铺 {source.shop_id}"),
        "current_shop_published": any(row["shop_id"] == current_shop_id for row in published_shops),
        "other_shop_published": any(row["shop_id"] != current_shop_id for row in published_shops),
        "published_shops": published_shops,
    }


def conflicting_published_shops(db: Session, draft: ListingDraftRecord) -> list[dict]:
    if not draft.source_product_id:
        return []
    source = db.get(SourceProductRecord, draft.source_product_id)
    if source is None:
        return []
    status = source_publication_status(
        db, source.source_platform, source.source_product_id, current_shop_id=draft.shop_id,
    )
    return [row for row in status["published_shops"] if row["shop_id"] != draft.shop_id]
