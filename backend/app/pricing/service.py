"""Pricing calculation with evidence tiers, risk codes, and promotion eligibility.

Follows the ozon-product-pricing-rules skill for all core formulas.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP

from .models import (
    AuditEvent,
    CalculationStep,
    CommissionSource,
    DimensionSource,
    PriceCalculation,
    PriceInput,
    PricePolicy,
    ProfitStatus,
    PromotionDecision,
    PromotionRequest,
    PromotionStatus,
    RiskCode,
)

CENT = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def min_price_from_price(price: Decimal) -> str:
    """Return Ozon-safe min_price: integer prices are reduced by one."""
    if price <= 0:
        return ""
    whole = price.to_integral_value(rounding=ROUND_FLOOR)
    if price == whole:
        whole -= 1
    return str(max(Decimal("1"), whole))


class PricingService:
    """Calculates listing price with evidence-graded risk reporting.

    Formulas follow ozon-product-pricing-rules skill §2 (strict iteration),
    §3 (old_price), §4 (min_price), §7 (risk codes).
    """

    RULE_VERSION = "2.0.0"

    def calculate(self, data: PriceInput) -> PriceCalculation:
        risk_codes: list[RiskCode] = []
        self._validate(data, risk_codes)

        policy = data.policy

        # --- §2.2 Step 1: initial estimate ---
        estimate = data.purchase_cost * (Decimal("1") + policy.target_profit_rate) + policy.fixed_misc_fee
        steps: list[CalculationStep] = []

        # --- §2.2 Steps 2-4: iterate until convergence ---
        for iteration in range(1, policy.max_iterations + 1):
            level, logistics = self._shipping_fee(data, estimate, risk_codes)
            commission = estimate * policy.commission_rate
            misc = estimate * policy.misc_fee_rate + policy.fixed_misc_fee
            base_cost = data.purchase_cost + commission + logistics + misc
            # §2.2 Step 3: strict formula  baseCost / (1 - profitRate)
            next_price = base_cost / (Decimal("1") - policy.target_profit_rate)
            steps.append(CalculationStep(
                iteration, _money(estimate), _money(logistics),
                _money(commission), _money(misc), _money(next_price), level,
            ))
            if abs(next_price - estimate) < CENT:
                estimate = next_price
                break
            estimate = next_price
        else:
            # §7.1 blocked
            risk_codes.append(RiskCode.PRICING_NOT_CONVERGED)
            estimate = next_price

        # Final calculation
        level, logistics = self._shipping_fee(data, estimate, risk_codes)
        commission = estimate * policy.commission_rate
        misc = estimate * policy.misc_fee_rate + policy.fixed_misc_fee
        base_cost = data.purchase_cost + commission + logistics + misc
        calculated_price = estimate.quantize(CENT, rounding=ROUND_CEILING)
        price = max(calculated_price, policy.listing_price_floor_cny.quantize(CENT, rounding=ROUND_CEILING))
        # The floor changes the actual sale price, so recompute all price-based
        # amounts from the final price rather than reporting pre-floor values.
        level, logistics = self._shipping_fee(data, price, risk_codes)
        commission = price * policy.commission_rate
        misc = price * policy.misc_fee_rate + policy.fixed_misc_fee
        base_cost = data.purchase_cost + commission + logistics + misc
        profit = _money(price - base_cost)
        profit_rate = profit / base_cost if base_cost else Decimal("0")

        # --- §3: old_price ---
        old_price = _money(price * policy.old_price_multiplier)

        # --- §4: Ozon minimum price follows the operator's integer rule ---
        min_price = min_price_from_price(price)

        # --- §7.2: manual_review checks ---
        self._check_manual_review(price, logistics, profit_rate, policy, risk_codes)

        # --- §5: profit status from commission evidence ---
        profit_status = self._profit_status(data.commission_source)

        return PriceCalculation(
            shop_id=policy.shop_id,
            price=price,
            min_price=min_price,
            old_price=old_price,
            base_cost=_money(base_cost),
            profit=profit,
            profit_rate=profit_rate,
            logistics_fee=_money(logistics),
            commission=_money(commission),
            misc_fee=_money(misc),
            shipping_level=level,
            steps=tuple(steps),
            risk_codes=tuple(risk_codes),
            profit_status=profit_status,
            commission_source=data.commission_source,
            dimension_source=data.dimension_source,
            pricing_rule_version=self.RULE_VERSION,
        )

    # ---- helpers -----------------------------------------------------------

    @staticmethod
    def _validate(data: PriceInput, risk_codes: list[RiskCode]) -> None:
        if data.purchase_cost < 0:
            risk_codes.append(RiskCode.PRICING_PROCUREMENT_EVIDENCE_MISSING)
        if data.weight_g <= 0 or min(data.length_mm, data.width_mm, data.height_mm) <= 0:
            risk_codes.append(RiskCode.PRICING_PACKAGE_MISSING)
        if data.dimension_source == DimensionSource.DEFAULT_GUESS:
            risk_codes.append(RiskCode.PRICING_PACKAGE_MISSING)

    @staticmethod
    def _shipping_fee(data: PriceInput, price: Decimal, risk_codes: list[RiskCode]) -> tuple[str, Decimal]:
        weight = data.weight_g
        sides_cm = [data.length_mm / 10, data.width_mm / 10, data.height_mm / 10]
        perimeter = sum(sides_cm)
        max_side = max(sides_cm)
        if weight <= 500 and price <= 135 and perimeter <= 90:
            return "extra_small", Decimal("25") * (weight / 1000) + Decimal("3")
        if weight <= 30000 and price <= 135 and perimeter <= 150 and max_side <= 80:
            return "budget", Decimal("17") * (weight / 1000) + Decimal("23")
        if weight <= 2000 and price > 135 and price <= 635 and perimeter <= 150 and max_side <= 80:
            return "small", Decimal("25") * (weight / 1000) + Decimal("16")
        if weight <= 30000 and price > 135 and price <= 635 and perimeter <= 250 and max_side <= 150:
            return "big", Decimal("17") * (weight / 1000) + Decimal("36")
        risk_codes.append(RiskCode.PRICING_SHIPPING_LEVEL_MISSING)
        return "unknown", Decimal("0")

    @staticmethod
    def _check_manual_review(
        price: Decimal, logistics: Decimal, profit_rate: Decimal, policy: PricePolicy, risk_codes: list[RiskCode],
    ) -> None:
        if price > 0 and logistics / price > policy.logistics_ratio_warn:
            risk_codes.append(RiskCode.PRICING_LOGISTICS_RATIO_HIGH)
        if profit_rate < policy.minimum_profit_rate:
            risk_codes.append(RiskCode.PRICING_PROFIT_LOW)

    @staticmethod
    def _profit_status(source: CommissionSource) -> ProfitStatus:
        if source == CommissionSource.OZON_SETTLEMENT:
            return ProfitStatus.VERIFIED
        if source in (CommissionSource.OZON_CATEGORY, CommissionSource.LEARNED_PRODUCT):
            return ProfitStatus.ESTIMATE
        return ProfitStatus.UNKNOWN


class PromotionService:
    """Evaluates promotion pricing and produces immutable audit payloads."""

    def __init__(self, policy: PricePolicy) -> None:
        self.policy = policy

    def evaluate(self, request: PromotionRequest) -> tuple[PromotionDecision, AuditEvent]:
        if request.shop_id != self.policy.shop_id or request.calculation.shop_id != self.policy.shop_id:
            raise ValueError("Promotion request must belong to the policy shop")
        price = request.proposed_price
        calc = request.calculation
        min_allowed = Decimal(calc.min_price) if calc.min_price else Decimal("0")
        variable_cost = calc.commission + calc.misc_fee
        projected_cost = (
            calc.base_cost
            - variable_cost
            + price * (self.policy.commission_rate + self.policy.misc_fee_rate)
            + self.policy.fixed_misc_fee
        )
        profit = _money(price - projected_cost)
        profit_rate = profit / projected_cost if projected_cost > 0 else Decimal("-1")

        if price < min_allowed:
            status, reason = PromotionStatus.REJECTED, "Proposed price is below min_price"
        elif profit_rate < self.policy.target_profit_rate:
            status, reason = PromotionStatus.REJECTED, "Projected profit rate is below shop target"
        else:
            status, reason = PromotionStatus.PENDING_APPROVAL, "Promotion meets price and profit guardrails"
        decision = PromotionDecision(request, status, reason, profit, profit_rate)
        audit = AuditEvent(
            shop_id=request.shop_id,
            action="promotion_evaluated",
            actor_id=request.requested_by,
            entity_type="promotion_request",
            entity_id=request.promotion_id,
            details={"status": status.value, "reason": reason, "proposed_price": str(price)},
        )
        return decision, audit

    def approve(self, decision: PromotionDecision, approver_id: str, *, override: bool = False) -> tuple[PromotionDecision, AuditEvent]:
        if decision.status == PromotionStatus.REJECTED and not override:
            raise ValueError("Rejected promotion requires an explicit override")
        status = PromotionStatus.OVERRIDDEN if override else PromotionStatus.APPROVED
        approved = PromotionDecision(
            decision.request, status, decision.reason,
            decision.projected_profit, decision.projected_profit_rate, approver_id,
        )
        audit = AuditEvent(
            approved.request.shop_id, "promotion_approved", approver_id,
            "promotion_request", approved.request.promotion_id,
            {"status": status.value, "override": str(override).lower()},
        )
        return approved, audit
