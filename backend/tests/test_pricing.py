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
    decision, _ = PromotionService(policy()).evaluate(request)
    assert decision.status.value == "rejected"
    assert "profit" in decision.reason.lower()


def test_approval_is_audited():
    result = calculation()
    request = PromotionRequest("shop-1", "sku-1", "promo-1", result.price, result, "operator-1")
    decision, _ = PromotionService(policy()).evaluate(request)
    approved, audit = PromotionService(policy()).approve(decision, "manager-1")
    assert approved.status.value == "approved"
    assert audit.actor_id == "manager-1"
