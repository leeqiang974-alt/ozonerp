from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.pricing import PriceInput, PricePolicy, Promotion, PromotionRequest, PricingService, PromotionService
from app.pricing.service import min_price_from_price


def policy() -> PricePolicy:
    return PricePolicy(shop_id="shop-1", target_profit_rate=Decimal("0.30"))


def calculation():
    return PricingService().calculate(PriceInput(Decimal("50"), Decimal("400"), Decimal("200"), Decimal("150"), Decimal("100"), policy()))


@pytest.mark.parametrize(("price", "expected"), [(Decimal("25.2"), "25"), (Decimal("25"), "24"), (Decimal("1"), "1"), (Decimal("0"), "")])
def test_min_price_boundary(price, expected):
    assert min_price_from_price(price) == expected


def test_calculation_protects_price_above_min_price():
    result = calculation()
    assert result.price > Decimal(result.min_price)
    assert result.old_price == result.price * 2
    assert result.profit > 0


def test_listing_price_floor_is_26_99_and_min_price_keeps_integer_rule():
    low_cost = PricingService().calculate(PriceInput(
        Decimal("1"), Decimal("10"), Decimal("50"), Decimal("50"), Decimal("20"), policy(),
    ))
    assert low_cost.price == Decimal("26.99")
    assert low_cost.min_price == "26"
    assert low_cost.old_price == Decimal("53.98")


def test_configurable_listing_price_floor_is_applied_before_old_and_min_price():
    custom = PricePolicy(
        shop_id="shop-1", target_profit_rate=Decimal("0.30"),
        listing_price_floor_cny=Decimal("30.00"), old_price_multiplier=Decimal("2"),
    )
    result = PricingService().calculate(PriceInput(
        Decimal("1"), Decimal("10"), Decimal("50"), Decimal("50"), Decimal("20"), custom,
    ))
    assert result.price == Decimal("30.00")
    assert result.min_price == "29"
    assert result.old_price == Decimal("60.00")


def test_rejects_promotion_below_min_price():
    result = calculation()
    request = PromotionRequest("shop-1", "sku-1", "promo-1", Decimal(result.min_price) - 1, result, "operator-1")
    decision, audit = PromotionService(policy()).evaluate(request)
    assert decision.status.value == "rejected"
    assert "min_price" in decision.reason
    assert audit.details["status"] == "rejected"


def test_rejects_promotion_with_low_profit_even_when_above_min_price():
    result = calculation()
    proposed = Decimal(result.min_price)
    request = PromotionRequest("shop-1", "sku-1", "promo-1", proposed, result, "operator-1")
    strict_policy = PricePolicy(shop_id="shop-1", target_profit_rate=Decimal("0.80"))
    decision, _ = PromotionService(strict_policy).evaluate(request)
    assert decision.status.value == "rejected"
    assert "profit" in decision.reason.lower()


def test_approval_is_audited():
    result = calculation()
    request = PromotionRequest("shop-1", "sku-1", "promo-1", result.price, result, "operator-1")
    decision, _ = PromotionService(policy()).evaluate(request)
    approved, audit = PromotionService(policy()).approve(decision, "manager-1")
    assert approved.status.value == "approved"
    assert audit.actor_id == "manager-1"
