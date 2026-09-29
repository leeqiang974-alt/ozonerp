from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import app.automation_scheduler as scheduler
from app.database import Base
from app.erp_models import BulkListingBatchItemRecord, BulkListingBatchRecord


def test_quota_waiting_batch_with_opt_in_starts_one_guarded_worker(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    started = []

    class ThreadStub:
        def __init__(self, **kwargs):
            started.append(kwargs)

        def start(self):
            return None

    monkeypatch.setattr(scheduler.threading, "Thread", ThreadStub)
    monkeypatch.setattr(scheduler, "_allow_external_writes", True)
    scheduler._bulk_auto_resume_not_before.clear()
    with Session(engine) as db:
        batch = BulkListingBatchRecord(
            name="待恢复批次", source_shop_key="source", status="waiting_quota",
            auto_continue_next_day=True,
        )
        db.add(batch)
        db.commit()
        db.add(BulkListingBatchItemRecord(
            batch_id=batch.id, source_product_id=1, assigned_shop_id=1,
            status="waiting_quota",
        ))
        db.commit()

        resumed = scheduler._resume_quota_waiting_bulk_batches(
            db, datetime(2026, 9, 30, 10, 0, tzinfo=ZoneInfo("Asia/Shanghai")),
        )

        assert resumed == 1
        assert db.get(BulkListingBatchRecord, batch.id).status == "running"
        assert len(started) == 1
        assert started[0]["args"] == (batch.id, 40, True, "system-auto-resume")


def test_quota_waiting_batch_does_not_resume_without_operator_opt_in(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(scheduler, "_allow_external_writes", True)
    scheduler._bulk_auto_resume_not_before.clear()
    with Session(engine) as db:
        batch = BulkListingBatchRecord(
            name="未授权自动继续", source_shop_key="source", status="waiting_quota",
            auto_continue_next_day=False,
        )
        db.add(batch)
        db.commit()
        db.add(BulkListingBatchItemRecord(
            batch_id=batch.id, source_product_id=1, assigned_shop_id=1,
            status="waiting_quota",
        ))
        db.commit()

        assert scheduler._resume_quota_waiting_bulk_batches(db) == 0
        assert db.get(BulkListingBatchRecord, batch.id).status == "waiting_quota"
