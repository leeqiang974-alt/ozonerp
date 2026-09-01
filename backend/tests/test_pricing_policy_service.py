from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app import models  # noqa: F401 - registers shops/warehouses FK targets
from app.erp_models import PricingPolicyRecord
from app.pricing_policy_service import (
    get_pricing_policy,
    quote_source_price,
    update_pricing_policy,
)


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_policy_updates_are_persisted_and_reloaded() -> None:
    with _session() as db:
        record = update_pricing_policy(db, {
            "purchase_buffer_cny": Decimal("8"),
            "commission_rate": Decimal("0.18"),
            "misc_fee_rate": Decimal("0.03"),
            "fixed_misc_fee": Decimal("2.5"),
            "target_profit_rate": Decimal("0.25"),
            "old_price_multiplier": Decimal("2.2"),
            "listing_price_floor_cny": Decimal("26.99"),
            "minimum_profit_rate": Decimal("0.08"),
            "minimum_profit_cny": Decimal("3"),
            "logistics_ratio_warn": Decimal("0.35"),
            "max_iterations": 40,
        })
        assert record.id == 1
        assert get_pricing_policy(db).purchase_buffer_cny == Decimal("8.00")
        assert get_pricing_policy(db).listing_price_floor_cny == Decimal("26.99")
        assert db.query(PricingPolicyRecord).count() == 1


def test_quote_uses_saved_purchase_buffer_and_policy() -> None:
    with _session() as db:
        update_pricing_policy(db, {"purchase_buffer_cny": Decimal("8")})
        quote = quote_source_price(
            db,
            shop_id=1,
            source_price_cny=Decimal("10"),
            weight_g=Decimal("100"),
            length_mm=Decimal("100"),
            width_mm=Decimal("80"),
            height_mm=Decimal("50"),
        )
        assert quote["purchase_cost_cny"] == Decimal("18.00")
        assert quote["price_cny"] > quote["purchase_cost_cny"]
        assert quote["old_price_cny"] == quote["price_cny"] * Decimal("2.00")
        assert quote["shipping_level"] == "extra_small"


def test_quote_applies_saved_listing_price_floor_and_integer_min_price_rule() -> None:
    with _session() as db:
        update_pricing_policy(db, {
            "purchase_buffer_cny": Decimal("0"),
            "listing_price_floor_cny": Decimal("26.99"),
        })
        quote = quote_source_price(
            db, shop_id=1, source_price_cny=Decimal("1"), weight_g=Decimal("10"),
            length_mm=Decimal("50"), width_mm=Decimal("50"), height_mm=Decimal("20"),
        )
        assert quote["price_cny"] == Decimal("26.99")
        assert quote["min_price_cny"] == "26"
        assert quote["old_price_cny"] == Decimal("53.98")
