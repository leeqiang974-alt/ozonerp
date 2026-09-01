from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.erp_models import ListingDraftRecord, ListingVariantRecord
from app.listing_stock_monitor import _warehouse_id_for_variant, audit_shop_fbs_inventory, monitor_listing_stock
from app.models import Shop, Warehouse


class FakeOzonClient:
    products = []
    import_items = []
    info_items = []
    stock_products = []
    # Optional responses for the monitor's idempotent pre-read and
    # post-write readback.  A successful write test starts with no stock and
    # then exposes the target stock on the second read.
    stock_products_sequence = None
    updates = []
    update_result = None

    def __init__(self, **_kwargs):
        self.stock_read_calls = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def list_products(self, **_kwargs):
        return {"result": {"items": self.products, "last_id": ""}}

    def get_import_info(self, **_kwargs):
        return {"result": {"items": self.import_items}}

    def get_product_info(self, **_kwargs):
        return {"items": self.info_items}

    def update_stocks(self, *, stocks):
        self.updates.append(stocks)
        if self.update_result is not None:
            return self.update_result
        return {"result": [{"offer_id": row["offer_id"], "updated": True, "errors": []} for row in stocks]}

    def get_fbs_stocks_by_warehouse(self, **_kwargs):
        sequence = type(self).stock_products_sequence
        if sequence is not None:
            index = self.stock_read_calls
            self.stock_read_calls += 1
            products = sequence[min(index, len(sequence) - 1)]
            if self.stock_read_calls >= len(sequence):
                type(self).stock_products_sequence = None
            return {"products": products}
        return {"products": self.stock_products}


def _draft(db: Session) -> ListingDraftRecord:
    shop = Shop(name="monitor-test")
    db.add(shop)
    db.flush()
    db.add(Warehouse(shop_id=shop.id, name="cel extrasmall,0-500g,0-135", warehouse_id="12345"))
    draft = ListingDraftRecord(shop_id=shop.id, offer_id="KC000006", title="test", status="submitted", import_task_id="task-1")
    db.add(draft)
    db.flush()
    for suffix in ("A", "B"):
        db.add(ListingVariantRecord(
            draft_id=draft.id,
            seller_sku=f"KC000006-{suffix}",
            weight_g=Decimal("5"),
            length_mm=Decimal("150"),
            width_mm=Decimal("150"),
            height_mm=Decimal("150"),
            price_cny=Decimal("22.60"),
            stock=999,
        ))
    db.commit()
    db.refresh(draft)
    return draft


def _session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return Session(engine)


def test_warehouse_match_ignores_spaces_in_extra_small_label():
    variant = ListingVariantRecord(weight_g=150, price_cny=29)
    warehouse = Warehouse(
        name="extra small ECONOMING（超轻小件0.5kg-1500）",
        warehouse_id="1020002451261000",
    )
    assert _warehouse_id_for_variant(variant, [warehouse]) == 1020002451261000


def test_monitor_waits_until_all_skus_exist(monkeypatch):
    FakeOzonClient.updates = []
    FakeOzonClient.products = [{"offer_id": "KC000006-A", "product_id": 1}]
    FakeOzonClient.import_items = [
        {"offer_id": "KC000006-A", "product_id": 1, "status": "imported", "errors": []},
        {"offer_id": "KC000006-B", "product_id": 2, "status": "imported", "errors": []},
    ]
    FakeOzonClient.info_items = []
    FakeOzonClient.stock_products = []
    monkeypatch.setattr("app.listing_stock_monitor.OzonSellerClient", FakeOzonClient)
    monkeypatch.setattr("app.listing_stock_monitor._credentials", lambda *_args: ("id", "key"))
    with _session() as db:
        draft = _draft(db)
        result = monitor_listing_stock(db, draft)
        assert result == {"status": "waiting_product", "found": 1, "expected": 2}
        assert FakeOzonClient.updates == []


def test_monitor_writes_variant_stock_and_requires_readback(monkeypatch):
    FakeOzonClient.updates = []
    FakeOzonClient.products = [
        {"offer_id": "KC000006-A", "product_id": 1},
        {"offer_id": "KC000006-B", "product_id": 2},
    ]
    FakeOzonClient.import_items = [
        {"offer_id": "KC000006-A", "product_id": 1, "status": "imported", "errors": []},
        {"offer_id": "KC000006-B", "product_id": 2, "status": "imported", "errors": []},
    ]
    FakeOzonClient.info_items = [
        {"id": 1, "offer_id": "KC000006-A", "statuses": {"status": "price_sent"}},
        {"id": 2, "offer_id": "KC000006-B", "statuses": {"status": "price_sent"}},
    ]
    FakeOzonClient.stock_products = [
        {"offer_id": "KC000006-A", "warehouse_id": 12345, "present": 999},
        {"offer_id": "KC000006-B", "warehouse_id": 12345, "present": 999},
    ]
    FakeOzonClient.stock_products_sequence = [
        [],
        FakeOzonClient.stock_products,
    ]
    monkeypatch.setattr("app.listing_stock_monitor.OzonSellerClient", FakeOzonClient)
    monkeypatch.setattr("app.listing_stock_monitor._credentials", lambda *_args: ("id", "key"))
    with _session() as db:
        draft = _draft(db)
        result = monitor_listing_stock(db, draft)
        assert result == {"status": "completed", "confirmed": 2}
        assert FakeOzonClient.updates == [[
            {"offer_id": "KC000006-A", "stock": 999, "warehouse_id": 12345},
            {"offer_id": "KC000006-B", "stock": 999, "warehouse_id": 12345},
        ]]
        assert draft.stock_sync_status == "completed"
        assert draft.stock_synced_at is not None


def test_monitor_allows_ozon_warning_and_still_confirms_stock(monkeypatch):
    """Ozon can correct an attribute while still importing the SKU successfully."""
    FakeOzonClient.updates = []
    FakeOzonClient.products = [
        {"offer_id": "KC000006-A", "product_id": 1},
        {"offer_id": "KC000006-B", "product_id": 2},
    ]
    warning = {
        "code": "erased_attribute_value",
        "level": "warning",
        "description": "Ozon corrected a single-value attribute",
    }
    FakeOzonClient.import_items = [
        {"offer_id": "KC000006-A", "product_id": 1, "status": "imported", "errors": [warning]},
        {"offer_id": "KC000006-B", "product_id": 2, "status": "imported", "errors": [warning]},
    ]
    FakeOzonClient.info_items = [
        {"id": 1, "offer_id": "KC000006-A", "statuses": {"status": "price_sent"}},
        {"id": 2, "offer_id": "KC000006-B", "statuses": {"status": "price_sent"}},
    ]
    FakeOzonClient.stock_products = [
        {"offer_id": "KC000006-A", "warehouse_id": 12345, "present": 999},
        {"offer_id": "KC000006-B", "warehouse_id": 12345, "present": 999},
    ]
    FakeOzonClient.stock_products_sequence = [
        [],
        FakeOzonClient.stock_products,
    ]
    monkeypatch.setattr("app.listing_stock_monitor.OzonSellerClient", FakeOzonClient)
    monkeypatch.setattr("app.listing_stock_monitor._credentials", lambda *_args: ("id", "key"))
    with _session() as db:
        draft = _draft(db)
        result = monitor_listing_stock(db, draft)
        assert result == {"status": "completed", "confirmed": 2}
        assert len(FakeOzonClient.updates) == 1


def test_monitor_syncs_successful_skus_when_one_import_row_failed(monkeypatch):
    FakeOzonClient.updates = []
    FakeOzonClient.products = [
        {"offer_id": "KC000006-A", "product_id": 1},
        {"offer_id": "KC000006-B", "product_id": 2},
    ]
    FakeOzonClient.import_items = [
        {"offer_id": "KC000006-A", "product_id": 1, "status": "imported", "errors": []},
        {"offer_id": "KC000006-B", "product_id": 2, "status": "failed", "errors": [{"code": "bad"}]},
    ]
    FakeOzonClient.info_items = [
        {"id": 1, "offer_id": "KC000006-A", "statuses": {"status": "price_sent"}},
    ]
    FakeOzonClient.stock_products = [
        {"offer_id": "KC000006-A", "warehouse_id": 12345, "present": 999},
    ]
    FakeOzonClient.stock_products_sequence = [
        [],
        FakeOzonClient.stock_products,
    ]
    monkeypatch.setattr("app.listing_stock_monitor.OzonSellerClient", FakeOzonClient)
    monkeypatch.setattr("app.listing_stock_monitor._credentials", lambda *_args: ("id", "key"))
    with _session() as db:
        draft = _draft(db)
        result = monitor_listing_stock(db, draft)
        assert result == {"status": "partial", "confirmed": 1, "pending": 1}
        assert draft.stock_sync_status == "partial"
        assert draft.stock_sync_next_at is None
        assert "bad" in draft.ozon_issues_json
        assert FakeOzonClient.updates == [[
            {"offer_id": "KC000006-A", "stock": 999, "warehouse_id": 12345},
        ]]


def test_monitor_syncs_imported_skus_from_mixed_quota_task(monkeypatch):
    FakeOzonClient.updates = []
    FakeOzonClient.products = [{"offer_id": "KC000006-A", "product_id": 1}]
    FakeOzonClient.import_items = [
        {"offer_id": "KC000006-A", "product_id": 1, "status": "imported", "errors": []},
        {"offer_id": "KC000006-B", "product_id": 0, "status": "failed", "errors": [{
            "code": "periodic_limit_exceeded", "level": "error", "description": "su ri xian"
        }]},
    ]
    FakeOzonClient.info_items = [
        {"id": 1, "offer_id": "KC000006-A", "statuses": {"status": "price_sent"}},
    ]
    FakeOzonClient.stock_products = [
        {"offer_id": "KC000006-A", "warehouse_id": 12345, "present": 999},
    ]
    FakeOzonClient.stock_products_sequence = [
        [],
        FakeOzonClient.stock_products,
    ]
    monkeypatch.setattr("app.listing_stock_monitor.OzonSellerClient", FakeOzonClient)
    monkeypatch.setattr("app.listing_stock_monitor._credentials", lambda *_args: ("id", "key"))
    with _session() as db:
        draft = _draft(db)
        result = monitor_listing_stock(db, draft)
        assert result == {"status": "partial", "confirmed": 1, "pending": 1}
        assert draft.stock_sync_status == "partial"
        assert FakeOzonClient.updates == [[
            {"offer_id": "KC000006-A", "stock": 999, "warehouse_id": 12345},
        ]]


def test_monitor_marks_daily_create_limit_as_quota_not_stock_failure(monkeypatch):
    FakeOzonClient.updates = []
    FakeOzonClient.import_items = [{
        "offer_id": "KC000006-A", "status": "failed",
        "errors": [{"code": "periodic_limit_exceeded", "level": "error", "description": "суточный лимит"}],
    }]
    monkeypatch.setattr("app.listing_stock_monitor.OzonSellerClient", FakeOzonClient)
    monkeypatch.setattr("app.listing_stock_monitor._credentials", lambda *_args: ("id", "key"))
    with _session() as db:
        draft = _draft(db)
        result = monitor_listing_stock(db, draft)
        assert result["status"] == "waiting_quota"
        assert draft.stock_sync_status == "waiting_quota"
        assert draft.stock_sync_next_at is None
        assert FakeOzonClient.updates == []


def test_completed_stock_monitor_never_writes_a_second_time(monkeypatch):
    FakeOzonClient.updates = []
    with _session() as db:
        draft = _draft(db)
        draft.stock_sync_status = "completed"
        from datetime import datetime
        draft.stock_synced_at = datetime.utcnow()
        db.commit()
        result = monitor_listing_stock(db, draft)
        assert result["status"] == "completed"
        assert FakeOzonClient.updates == []


def test_shop_inventory_audit_reads_legacy_ozon_offer_without_local_draft(monkeypatch):
    """The shop audit starts from Ozon, not listing_drafts."""
    FakeOzonClient.products = [
        {"offer_id": "OZE66808F4F5", "product_id": 71},
        {"offer_id": "OZE-IN-STOCK", "product_id": 72},
    ]
    FakeOzonClient.info_items = [
        {"id": 71, "offer_id": "OZE66808F4F5", "statuses": {"status": "price_sent"}},
        {"id": 72, "offer_id": "OZE-IN-STOCK", "statuses": {"status": "price_sent"}},
    ]
    FakeOzonClient.stock_products = [
        {"offer_id": "OZE-IN-STOCK", "warehouse_id": 12345, "present": 12},
    ]
    monkeypatch.setattr("app.listing_stock_monitor.OzonSellerClient", FakeOzonClient)
    monkeypatch.setattr("app.listing_stock_monitor._credentials", lambda *_args: ("id", "key"))
    with _session() as db:
        shop = Shop(name="audit-test")
        db.add(shop)
        db.commit()
        result = audit_shop_fbs_inventory(db, shop.id)
        assert result["summary"]["ozon_product_count"] == 2
        assert result["summary"]["price_sent_count"] == 2
        assert result["summary"]["missing_fbs_stock_record_count"] == 1
        assert result["summary"]["positive_fbs_stock_count"] == 1
        assert result["summary"]["price_sent_missing_fbs_stock_record_count"] == 1
        assert result["summary"]["price_sent_positive_fbs_stock_count"] == 1
        assert result["summary"]["stock_repair_plan_count"] == 0
        assert result["summary"]["stock_repair_missing_local_evidence_count"] == 1
        assert result["issues"] == [{
            "offer_id": "OZE66808F4F5", "product_id": 71,
            "status": "price_sent", "fbs_present": None, "state": "无 FBS 库存记录",
            "stock_repair_candidate": False,
        }]


def test_monitor_delays_tag_validation_failure_instead_of_fast_retry(monkeypatch):
    FakeOzonClient.updates = []
    FakeOzonClient.products = [
        {"offer_id": "KC000006-A", "product_id": 1},
        {"offer_id": "KC000006-B", "product_id": 2},
    ]
    FakeOzonClient.import_items = [
        {"offer_id": "KC000006-A", "product_id": 1, "status": "imported", "errors": []},
        {"offer_id": "KC000006-B", "product_id": 2, "status": "imported", "errors": []},
    ]
    FakeOzonClient.info_items = [
        {"id": 1, "offer_id": "KC000006-A", "statuses": {"status": "price_sent"}},
        {"id": 2, "offer_id": "KC000006-B", "statuses": {"status": "price_sent"}},
    ]
    FakeOzonClient.update_result = {"result": [
        {"offer_id": "KC000006-A", "updated": False, "errors": [{"code": "PRODUCT_HAS_NOT_BEEN_TAGGED_YET"}]},
        {"offer_id": "KC000006-B", "updated": False, "errors": [{"code": "PRODUCT_HAS_NOT_BEEN_TAGGED_YET"}]},
    ]}
    monkeypatch.setattr("app.listing_stock_monitor.OzonSellerClient", FakeOzonClient)
    monkeypatch.setattr("app.listing_stock_monitor._credentials", lambda *_args: ("id", "key"))
    with _session() as db:
        draft = _draft(db)
        result = monitor_listing_stock(db, draft)
        assert result["status"] == "waiting_tag"
        assert draft.stock_sync_status == "waiting_tag"
        assert draft.stock_sync_next_at is not None
    FakeOzonClient.update_result = None
