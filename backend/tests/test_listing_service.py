from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.erp_models import ListingDraftRecord, ListingVariantRecord
from app.listing_service import validate_listing_draft
from app.models import Shop


def test_listing_draft_validation_calculates_cny_prices() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="上架测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        draft = ListingDraftRecord(shop_id=shop.id, offer_id="DRAFT-1", title="测试商品", category_id="123", type_id="456", primary_image_url="https://example.test/main.jpg")
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
