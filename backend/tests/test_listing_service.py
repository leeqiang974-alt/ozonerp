from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.erp_models import ListingAttributeValueRecord, ListingDraftRecord, ListingVariantRecord, OzonAttributeCacheRecord, OzonAttributeDictionaryValueRecord, OzonCategoryCacheRecord
from app.listing_service import validate_listing_draft
from app.main import create_listing_draft
from app.models import Shop
from app.schemas import ListingDraftCreate


def test_listing_draft_validation_calculates_cny_prices() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="上架测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        draft = ListingDraftRecord(shop_id=shop.id, offer_id="DRAFT-1", title="测试商品", category_id="123", type_id="456", primary_image_url="https://example.test/main.jpg")
        db.add(OzonAttributeCacheRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="999", name="可选属性", required=False, dictionary_id="", value_type="String"))
        draft.variants.append(ListingVariantRecord(seller_sku="DRAFT-1-RED", purchase_cost_cny=Decimal("20"), weight_g=Decimal("300"), length_mm=Decimal("100"), width_mm=Decimal("100"), height_mm=Decimal("100")))
        db.add(draft); db.commit()
        issues = validate_listing_draft(db, draft)
        assert issues == [] and draft.status == "ready_for_approval"
        assert draft.variants[0].calculated_price_cny is not None
        assert Decimal(draft.variants[0].min_price_cny) < draft.variants[0].calculated_price_cny


def test_listing_draft_validation_blocks_missing_media_and_dimensions() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="上架错误测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        draft = ListingDraftRecord(shop_id=shop.id, offer_id="DRAFT-2", title="测试商品")
        draft.variants.append(ListingVariantRecord(seller_sku="DRAFT-2-ONE"))
        db.add(draft); db.commit()
        issues = validate_listing_draft(db, draft)
        assert draft.status == "validation_failed"
        assert {issue["field"] for issue in issues} >= {"category_id", "type_id", "primary_image_url", "variants.DRAFT-2-ONE"}


def test_listing_validation_requires_current_category_attributes() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="属性预检测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(OzonAttributeCacheRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="85", name="品牌", required=True, dictionary_id="1", value_type="String"))
        draft = ListingDraftRecord(shop_id=shop.id, offer_id="ATTR-1", title="属性测试商品", category_id="123", type_id="456", primary_image_url="https://example.test/main.jpg")
        draft.variants.append(ListingVariantRecord(seller_sku="ATTR-1-ONE", purchase_cost_cny=Decimal("20"), weight_g=Decimal("300"), length_mm=Decimal("100"), width_mm=Decimal("100"), height_mm=Decimal("100")))
        db.add(draft); db.commit()

        issues = validate_listing_draft(db, draft)
        assert {issue["field"] for issue in issues} == {"attributes.85"}

        draft.attribute_values.append(ListingAttributeValueRecord(attribute_id="85", name="品牌", value_text="仅文本品牌"))
        db.commit()
        assert {issue["field"] for issue in validate_listing_draft(db, draft)} == {"attributes.85"}
        draft.attribute_values[0].value_id = "970718"
        draft.attribute_values[0].value_text = "测试品牌"
        db.commit()
        assert {issue["field"] for issue in validate_listing_draft(db, draft)} == {"attributes.85"}
        db.add(OzonAttributeDictionaryValueRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="85", value_id="970718", value="测试品牌"))
        db.commit()
        assert validate_listing_draft(db, draft) == []


def test_create_listing_draft_persists_attribute_values() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="草稿属性保存店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(OzonCategoryCacheRecord(shop_id=shop.id, category_id="123", type_id="456", title="测试类目"))
        db.add(OzonAttributeCacheRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="85", name="品牌", required=True, dictionary_id="1", value_type="String"))
        db.add(OzonAttributeDictionaryValueRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="85", value_id="970718", value="测试品牌"))
        db.commit()
        payload = ListingDraftCreate.model_validate({
            "offer_id": "SAVE-ATTR-1",
            "title": "保存属性测试",
            "category_id": "123",
            "type_id": "456",
            "primary_image_url": "https://example.test/main.jpg",
            "attributes": [{"attribute_id": "85", "name": "品牌", "value_id": "970718", "value_text": "测试品牌"}],
            "variants": [{"seller_sku": "SAVE-ATTR-1-ONE", "purchase_cost_cny": 20, "weight_g": 300, "length_mm": 100, "width_mm": 100, "height_mm": 100}],
        })

        draft = create_listing_draft(shop.id, payload, db)
        assert len(draft.attribute_values) == 1
        assert draft.attribute_values[0].attribute_id == "85"
        assert draft.attribute_values[0].value_id == "970718"


def test_create_listing_draft_rejects_category_from_another_shop() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        first = Shop(name="类目来源店", currency="CNY")
        second = Shop(name="草稿目标店", currency="CNY")
        db.add_all([first, second]); db.commit(); db.refresh(first); db.refresh(second)
        db.add(OzonCategoryCacheRecord(shop_id=first.id, category_id="123", type_id="456", title="其他店铺类目"))
        db.commit()
        payload = ListingDraftCreate.model_validate({
            "offer_id": "CROSS-SHOP-1", "title": "跨店类目测试", "category_id": "123", "type_id": "456",
            "variants": [{"seller_sku": "CROSS-SHOP-1-ONE"}],
        })
        with pytest.raises(HTTPException) as error:
            create_listing_draft(second.id, payload, db)
        assert error.value.status_code == 422
