"""Database-backed freshness decisions for read-only Ozon correction jobs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import SessionLocal
from .erp_models import SyncState
from .models import Shop
from .sync_service import sync_category_cache, sync_fbs_postings, sync_fbs_product_images, sync_products

FRESH_FOR = timedelta(minutes=5)
LEASE_FOR = timedelta(minutes=5)
RESOURCE_FRESH_FOR = {"categories": timedelta(hours=24)}

AUTO_SYNC_VIEW_RESOURCES: dict[str, tuple[str, ...]] = {
    "dashboard": ("products", "fbs_postings"),
    "orders": ("fbs_postings", "fbs_product_images"),
    "products": ("products",),
    "listing": ("categories",),
    "shops": (),
    "pricing": (),
    "sync": (),
}


class UnknownAutoSyncView(ValueError):
    pass


class AutoSyncShopNotFound(ValueError):
    pass


def request_auto_sync(db: Session, shop_id: int, view: str, *, now: datetime | None = None) -> list[dict[str, str | None]]:
    if view not in AUTO_SYNC_VIEW_RESOURCES:
        raise UnknownAutoSyncView("未知功能页面")
    if db.get(Shop, shop_id) is None:
        raise AutoSyncShopNotFound("店铺不存在")
    current = _as_utc(now or datetime.now(timezone.utc))
    decisions: list[dict[str, str | None]] = []
    for resource in AUTO_SYNC_VIEW_RESOURCES[view]:
        statement = select(SyncState).where(SyncState.shop_id == shop_id, SyncState.resource == resource)
        if db.bind is not None and db.bind.dialect.name == "postgresql":
            statement = statement.with_for_update()
        state = db.scalar(statement)
        if state is None:
            state = SyncState(shop_id=shop_id, resource=resource)
            db.add(state)
            db.flush()
        freshness = RESOURCE_FRESH_FOR.get(resource, FRESH_FOR)
        if state.last_success_at and current - _as_utc(state.last_success_at) < freshness:
            decisions.append(_decision(resource, "fresh"))
            continue
        if state.lease_owner and state.lease_expires_at and _as_utc(state.lease_expires_at) > current:
            decisions.append(_decision(resource, "already_running"))
            continue
        owner = uuid4().hex
        state.lease_owner = owner
        state.lease_expires_at = current + LEASE_FOR
        decisions.append(_decision(resource, "started", owner))
    db.commit()
    return decisions


def run_auto_sync_resource(
    shop_id: int,
    resource: str,
    lease_owner: str,
    *,
    now: datetime | None = None,
    session_factory=None,
) -> None:
    """Run one leased correction with an independent database session."""
    current = _as_utc(now or datetime.now(timezone.utc))
    factory = session_factory or SessionLocal
    with factory() as db:
        state = db.scalar(select(SyncState).where(SyncState.shop_id == shop_id, SyncState.resource == resource))
        if state is None or state.lease_owner != lease_owner:
            return
        try:
            if resource == "products":
                run = sync_products(db, shop_id, limit=100, last_id=state.cursor or "")
            elif resource == "fbs_postings":
                previous_end = _as_utc(state.window_end_at) if state.window_end_at else current - timedelta(days=7)
                run = sync_fbs_postings(
                    db,
                    shop_id,
                    since=previous_end - timedelta(minutes=10) if state.window_end_at else previous_end,
                    to=current,
                    limit=100,
                    offset=0,
                    status="",
                )
            elif resource == "fbs_product_images":
                run = sync_fbs_product_images(db, shop_id)
            elif resource == "categories":
                run = sync_category_cache(db, shop_id)
            else:
                raise ValueError(f"不支持的自动同步资源：{resource}")

            db.refresh(state)
            if state.lease_owner != lease_owner:
                return
            if run.status == "succeeded":
                state.last_success_at = current
                state.last_error = None
                if resource == "products":
                    state.cursor = run.cursor
                elif resource == "fbs_postings":
                    state.window_end_at = current
            else:
                state.last_error = str(run.error_summary or "同步失败")[:1000]
        except Exception as exc:
            db.rollback()
            state = db.scalar(select(SyncState).where(SyncState.shop_id == shop_id, SyncState.resource == resource))
            if state is None or state.lease_owner != lease_owner:
                return
            state.last_error = str(exc)[:1000]
        finally:
            if state is not None and state.lease_owner == lease_owner:
                state.lease_owner = None
                state.lease_expires_at = None
                db.commit()


def _decision(resource: str, status: str, lease_owner: str | None = None) -> dict[str, str | None]:
    return {"resource": resource, "status": status, "lease_owner": lease_owner}


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
