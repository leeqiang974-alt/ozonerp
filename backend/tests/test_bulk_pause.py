import json

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.erp_models import AuditEventRecord, BulkListingBatchRecord
from app.main import app
from app.models import Shop


def test_bulk_listing_pause_is_persisted_and_idempotent():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    def override_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    try:
        with Session(engine) as db:
            shop = Shop(name="暂停测试店", currency="CNY", timezone="Asia/Shanghai", is_active=True)
            db.add(shop)
            db.commit()
            db.refresh(shop)
            batch = BulkListingBatchRecord(
                name="暂停测试批次",
                source_shop_key="test-shop",
                target_shop_ids_json=json.dumps([shop.id]),
                status="running",
                total_count=1,
            )
            db.add(batch)
            db.commit()
            db.refresh(batch)
            batch_id = batch.id

        client = TestClient(app)
        first = client.post(f"/api/v1/automation/bulk-listing-batches/{batch_id}/pause")
        assert first.status_code == 200
        assert first.json()["status"] == "paused"

        second = client.post(f"/api/v1/automation/bulk-listing-batches/{batch_id}/pause")
        assert second.status_code == 200
        assert second.json()["status"] == "paused"

        with Session(engine) as db:
            saved = db.get(BulkListingBatchRecord, batch_id)
            assert saved.status == "paused"
            actions = db.scalars(select(AuditEventRecord.action)).all()
            assert actions == ["bulk_listing_batch_paused"]
    finally:
        app.dependency_overrides.clear()
