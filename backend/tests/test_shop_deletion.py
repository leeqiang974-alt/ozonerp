import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.erp_models import OzonAttributeCacheRecord, OzonAttributeDictionaryQueryCacheRecord, OzonAttributeDictionaryValueRecord, ProductRecord, SyncRun, SyncState
from app.main import delete_shop
from app.models import Shop


def test_incomplete_shop_can_be_deleted() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="未完成店铺", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        response = delete_shop(shop.id, db)
        assert response.status_code == 204
        assert db.get(Shop, shop.id) is None


def test_shop_with_only_failed_sync_history_can_be_deleted() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="已有数据店铺", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(SyncRun(shop_id=shop.id, resource="products", status="succeeded")); db.commit()
        assert delete_shop(shop.id, db).status_code == 204


def test_shop_with_only_auto_sync_state_can_be_deleted() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="自动同步未完成店铺", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(SyncState(shop_id=shop.id, resource="products", last_error="授权未配置")); db.commit()
        assert delete_shop(shop.id, db).status_code == 204


def test_shop_with_only_listing_metadata_cache_can_be_deleted() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="只有上架缓存的店铺", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(OzonAttributeCacheRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="85", name="品牌", required=True, dictionary_id="1", value_type="String"))
        db.add(OzonAttributeDictionaryValueRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="85", value_id="1", value="测试品牌"))
        db.add(OzonAttributeDictionaryQueryCacheRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="85", query_key="测试", result_limit=50, result_json="[]"))
        db.commit()
        assert delete_shop(shop.id, db).status_code == 204


def test_shop_with_business_data_cannot_be_deleted() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="已有业务店铺", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(ProductRecord(shop_id=shop.id, ozon_product_id="1", name="已同步商品")); db.commit()
        with pytest.raises(HTTPException) as error:
            delete_shop(shop.id, db)
        assert error.value.status_code == 409
