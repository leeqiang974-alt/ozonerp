from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.erp_models import (
    OzonAttributeCacheRecord,
    OzonAttributeDictionaryValueRecord,
    OzonCategoryCacheRecord,
    OzonGlobalAttributeCacheRecord,
    OzonGlobalCategoryCacheRecord,
    OzonGlobalDictValueRecord,
)
from app.models import Shop
from app.listing_cache_service import promote_legacy_listing_caches


def test_legacy_shop_rows_are_promoted_once_to_global_cache() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        first = Shop(name="店铺 A", currency="CNY")
        second = Shop(name="店铺 B", currency="CNY")
        db.add_all([first, second])
        db.commit()
        db.refresh(first)
        db.refresh(second)
        db.add_all([
            OzonCategoryCacheRecord(shop_id=first.id, category_id="10", type_id="20", title="家居 / 收纳"),
            OzonCategoryCacheRecord(shop_id=second.id, category_id="10", type_id="20", title="家居 / 收纳"),
            OzonAttributeCacheRecord(
                shop_id=first.id, category_id="10", type_id="20", attribute_id="10096",
                name="颜色", dictionary_id="1", value_type="String",
            ),
            OzonAttributeDictionaryValueRecord(
                shop_id=first.id, category_id="10", type_id="20", attribute_id="10096",
                value_id="61574", value="黑色",
            ),
        ])
        db.commit()

        promote_legacy_listing_caches(db)
        db.commit()
        promote_legacy_listing_caches(db)

        assert len(db.scalars(select(OzonGlobalCategoryCacheRecord)).all()) == 1
        assert len(db.scalars(select(OzonGlobalAttributeCacheRecord)).all()) == 1
        assert len(db.scalars(select(OzonGlobalDictValueRecord)).all()) == 1


def test_global_cache_is_independent_of_requesting_shop() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        first = Shop(name="已有缓存店", currency="CNY")
        second = Shop(name="新店", currency="CNY")
        db.add_all([first, second])
        db.commit()
        db.add(OzonGlobalCategoryCacheRecord(category_id="10", type_id="20", title="家居 / 收纳"))
        db.add(OzonGlobalAttributeCacheRecord(
            category_id="10", type_id="20", attribute_id="10001", name="材质",
            dictionary_id="", value_type="String",
        ))
        db.commit()

        # No shop-level rows exist for either shop; the same global snapshot is
        # directly addressable for the newly connected shop.
        category = db.scalar(select(OzonGlobalCategoryCacheRecord).where(
            OzonGlobalCategoryCacheRecord.category_id == "10",
            OzonGlobalCategoryCacheRecord.type_id == "20",
        ))
        attributes = db.scalars(select(OzonGlobalAttributeCacheRecord).where(
            OzonGlobalAttributeCacheRecord.category_id == "10",
            OzonGlobalAttributeCacheRecord.type_id == "20",
        )).all()
        assert category is not None and category.title == "家居 / 收纳"
        assert [row.attribute_id for row in attributes] == ["10001"]
