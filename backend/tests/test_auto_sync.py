from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.auto_sync import AUTO_SYNC_VIEW_RESOURCES, UnknownAutoSyncView, request_auto_sync, run_auto_sync_resource
from app.database import Base
from app.erp_models import SyncState
from app.models import Shop


def make_db() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    return Session(engine)


def add_shop(db: Session) -> Shop:
    shop = Shop(name="自动同步测试店铺", currency="CNY")
    db.add(shop)
    db.commit()
    db.refresh(shop)
    return shop


def test_view_resource_mapping_is_server_controlled() -> None:
    assert AUTO_SYNC_VIEW_RESOURCES["orders"] == ("fbs_postings", "fbs_product_images")
    assert AUTO_SYNC_VIEW_RESOURCES["products"] == ("products",)
    assert AUTO_SYNC_VIEW_RESOURCES["dashboard"] == ("products", "fbs_postings")
    assert AUTO_SYNC_VIEW_RESOURCES["listing"] == ("categories",)


def test_first_request_starts_and_concurrent_request_reuses_lease() -> None:
    now = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)
    with make_db() as db:
        shop = add_shop(db)
        first = request_auto_sync(db, shop.id, "products", now=now)
        second = request_auto_sync(db, shop.id, "products", now=now + timedelta(seconds=1))
        state = db.scalar(select(SyncState).where(SyncState.shop_id == shop.id, SyncState.resource == "products"))

        assert first[0]["status"] == "started"
        assert first[0]["lease_owner"]
        assert second == [{"resource": "products", "status": "already_running", "lease_owner": None}]
        assert state.lease_owner == first[0]["lease_owner"]


def test_success_inside_five_minutes_is_fresh_and_expired_lease_restarts() -> None:
    now = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)
    with make_db() as db:
        shop = add_shop(db)
        db.add(SyncState(shop_id=shop.id, resource="products", last_success_at=now - timedelta(minutes=4)))
        db.add(SyncState(shop_id=shop.id, resource="fbs_postings", lease_owner="old", lease_expires_at=now - timedelta(seconds=1)))
        db.commit()

        fresh = request_auto_sync(db, shop.id, "products", now=now)
        restarted = request_auto_sync(db, shop.id, "orders", now=now)

        assert fresh == [{"resource": "products", "status": "fresh", "lease_owner": None}]
        assert restarted[0]["resource"] == "fbs_postings"
        assert restarted[0]["status"] == "started"
        assert restarted[0]["lease_owner"] != "old"


def test_category_cache_remains_fresh_for_twenty_four_hours() -> None:
    now = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)
    with make_db() as db:
        shop = add_shop(db)
        db.add(SyncState(shop_id=shop.id, resource="categories", last_success_at=now - timedelta(hours=23)))
        db.commit()
        assert request_auto_sync(db, shop.id, "listing", now=now) == [
            {"resource": "categories", "status": "fresh", "lease_owner": None}
        ]


def test_unknown_view_is_rejected() -> None:
    with make_db() as db:
        shop = add_shop(db)
        with pytest.raises(UnknownAutoSyncView):
            request_auto_sync(db, shop.id, "unknown", now=datetime.now(timezone.utc))


def test_product_worker_uses_and_advances_persistent_cursor(monkeypatch) -> None:
    now = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = add_shop(db)
        shop_id = shop.id
        db.add(SyncState(shop_id=shop.id, resource="products", cursor="stored-cursor", lease_owner="lease-1", lease_expires_at=now + timedelta(minutes=5)))
        db.commit()

    calls = []

    def fake_sync(db, shop_id, *, limit, last_id):
        calls.append((shop_id, limit, last_id))
        return type("Run", (), {"status": "succeeded", "cursor": "next-cursor", "error_summary": None})()

    monkeypatch.setattr("app.auto_sync.sync_products", fake_sync)
    run_auto_sync_resource(shop_id, "products", "lease-1", now=now, session_factory=lambda: Session(engine))

    with Session(engine) as db:
        state = db.scalar(select(SyncState).where(SyncState.shop_id == shop_id, SyncState.resource == "products"))
        assert calls == [(shop_id, 100, "stored-cursor")]
        assert state.cursor == "next-cursor"
        assert state.last_success_at == now.replace(tzinfo=None)
        assert state.lease_owner is None and state.lease_expires_at is None


def test_fbs_worker_uses_overlap_window_and_advances_only_on_success(monkeypatch) -> None:
    now = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)
    previous_end = now - timedelta(hours=1)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = add_shop(db)
        shop_id = shop.id
        db.add(SyncState(shop_id=shop.id, resource="fbs_postings", window_end_at=previous_end, lease_owner="lease-2", lease_expires_at=now + timedelta(minutes=5)))
        db.commit()

    calls = []

    def fake_sync(db, shop_id, **kwargs):
        calls.append(kwargs)
        return type("Run", (), {"status": "succeeded", "cursor": None, "error_summary": None})()

    monkeypatch.setattr("app.auto_sync.sync_fbs_postings", fake_sync)
    run_auto_sync_resource(shop_id, "fbs_postings", "lease-2", now=now, session_factory=lambda: Session(engine))

    with Session(engine) as db:
        state = db.scalar(select(SyncState).where(SyncState.shop_id == shop_id, SyncState.resource == "fbs_postings"))
        assert calls[0]["since"] == previous_end - timedelta(minutes=10)
        assert calls[0]["to"] == now
        assert state.window_end_at == now.replace(tzinfo=None)
        assert state.last_success_at == now.replace(tzinfo=None)


def test_worker_failure_preserves_checkpoint_and_releases_lease(monkeypatch) -> None:
    now = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)
    old_success = now - timedelta(hours=2)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = add_shop(db)
        shop_id = shop.id
        db.add(SyncState(shop_id=shop.id, resource="products", cursor="keep-me", last_success_at=old_success, lease_owner="lease-3", lease_expires_at=now + timedelta(minutes=5)))
        db.commit()

    monkeypatch.setattr(
        "app.auto_sync.sync_products",
        lambda *args, **kwargs: type("Run", (), {"status": "failed", "cursor": "discard-me", "error_summary": "safe failure"})(),
    )
    run_auto_sync_resource(shop_id, "products", "lease-3", now=now, session_factory=lambda: Session(engine))

    with Session(engine) as db:
        state = db.scalar(select(SyncState).where(SyncState.shop_id == shop_id, SyncState.resource == "products"))
        assert state.cursor == "keep-me"
        assert state.last_success_at == old_success.replace(tzinfo=None)
        assert state.last_error == "safe failure"
        assert state.lease_owner is None and state.lease_expires_at is None


def test_auto_sync_endpoint_queues_started_resources_and_validates_view(monkeypatch) -> None:
    from app.database import get_db
    from app.main import app

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = add_shop(db)
        shop_id = shop.id

    def override_db():
        with Session(engine) as db:
            yield db

    queued = []
    monkeypatch.setattr("app.main.run_auto_sync_resource", lambda shop_id, resource, owner: queued.append((shop_id, resource, owner)))
    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            response = client.post(f"/api/v1/shops/{shop_id}/auto-sync", json={"view": "products"})
            invalid = client.post(f"/api/v1/shops/{shop_id}/auto-sync", json={"view": "not-a-view"})
            missing = client.post("/api/v1/shops/999/auto-sync", json={"view": "products"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 202
    assert response.json() == [{"resource": "products", "status": "started"}]
    assert len(queued) == 1 and queued[0][:2] == (shop_id, "products") and queued[0][2]
    assert invalid.status_code == 422
    assert missing.status_code == 404
