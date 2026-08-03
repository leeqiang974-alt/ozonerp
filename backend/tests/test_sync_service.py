from datetime import datetime, timezone

from cryptography.fernet import Fernet
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.erp_models import FbsPostingLineRecord, FbsPostingRecord, OzonCategoryCacheRecord, ProductRecord, SyncRun
from app.models import ApiCredential, Shop
from app.security import encrypt_secret
from app.sync_service import sync_category_cache, sync_fbs_postings, sync_fbs_product_images, sync_products


class FakeOzonClient:
    product_info_calls = 0
    def __init__(self, **_: object) -> None: pass
    def __enter__(self): return self
    def __exit__(self, *_: object) -> None: pass
    def list_products(self, **_: object):
        return {"items": [{"product_id": 101, "offer_id": "sku-101", "name": "测试商品"}], "last_id": "next-page"}
    def list_fbs_postings(self, **_: object):
        return {"result": {"postings": [{"posting_number": "FBS-1", "status": "awaiting_packaging", "products": [{"offer_id": "sku-101", "product_id": 101, "name": "订单商品", "quantity": 2}]}]}}
    def get_product_info(self, **_: object):
        type(self).product_info_calls += 1
        return {"items": [{"id": 101, "primary_image": ["https://example.test/product.jpg"]}]}
    def get_category_tree(self):
        return {"result": [{"category_name": "服饰", "description_category_id": 10, "children": [{"type_id": 20, "type_name": "上衣", "children": []}]}]}


def test_product_sync_upserts_records_and_tracks_run(monkeypatch) -> None:
    monkeypatch.setenv("ERP_CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr("app.sync_service.OzonSellerClient", FakeOzonClient)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="测试店铺", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(ApiCredential(shop_id=shop.id, provider="ozon", client_id_reference="123", encrypted_secret_placeholder=encrypt_secret("x" * 30), status="configured"))
        db.commit()
        run = sync_products(db, shop.id, limit=100, last_id="")
        assert run.status == "succeeded"
        assert run.records_seen == 1 and run.cursor == "next-page"
        assert db.scalar(select(ProductRecord).where(ProductRecord.shop_id == shop.id)).name == "测试商品"
        assert db.scalar(select(SyncRun).where(SyncRun.id == run.id)).records_changed == 1


def test_fbs_sync_replaces_order_lines(monkeypatch) -> None:
    FakeOzonClient.product_info_calls = 0
    monkeypatch.setenv("ERP_CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr("app.sync_service.OzonSellerClient", FakeOzonClient)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="FBS测试店铺", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(ApiCredential(shop_id=shop.id, provider="ozon", client_id_reference="123", encrypted_secret_placeholder=encrypt_secret("x" * 30), status="configured"))
        db.commit()
        run = sync_fbs_postings(db, shop.id, since=datetime(2026, 8, 1, tzinfo=timezone.utc), to=datetime(2026, 8, 3, tzinfo=timezone.utc), limit=100, offset=0, status="")
        posting = db.scalar(select(FbsPostingRecord).where(FbsPostingRecord.shop_id == shop.id))
        line = db.scalar(select(FbsPostingLineRecord).where(FbsPostingLineRecord.posting_id == posting.id))
        assert run.status == "succeeded" and run.records_seen == 1
        assert posting.normalized_status == "awaiting_packaging"
        assert line.offer_id == "sku-101" and line.quantity == 2
        image_run = sync_fbs_product_images(db, shop.id)
        db.refresh(line)
        assert image_run.status == "succeeded" and image_run.records_seen == 1
        assert line.image_url == "https://example.test/product.jpg"
        first_image_sync_at = line.image_synced_at
        sync_fbs_postings(db, shop.id, since=datetime(2026, 8, 1, tzinfo=timezone.utc), to=datetime(2026, 8, 3, tzinfo=timezone.utc), limit=100, offset=0, status="")
        line = db.scalar(select(FbsPostingLineRecord).where(FbsPostingLineRecord.posting_id == posting.id))
        assert line.image_url == "https://example.test/product.jpg"
        assert line.image_synced_at == first_image_sync_at
        second_image_run = sync_fbs_product_images(db, shop.id)
        assert second_image_run.status == "succeeded" and second_image_run.records_seen == 0
        assert FakeOzonClient.product_info_calls == 1


def test_category_cache_sync_replaces_local_listing_types(monkeypatch) -> None:
    monkeypatch.setenv("ERP_CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr("app.sync_service.OzonSellerClient", FakeOzonClient)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="类目测试店铺", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(ApiCredential(shop_id=shop.id, provider="ozon", client_id_reference="123", encrypted_secret_placeholder=encrypt_secret("x" * 30), status="configured"))
        db.commit()

        run = sync_category_cache(db, shop.id)
        row = db.scalar(select(OzonCategoryCacheRecord).where(OzonCategoryCacheRecord.shop_id == shop.id))

        assert run.status == "succeeded" and run.records_changed == 1
        assert row.category_id == "10" and row.type_id == "20" and row.title == "服饰 / 上衣"
