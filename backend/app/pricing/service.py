"""Pricing calculation and promotion eligibility services."""

from __future__ import annotations

from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP

from .models import (
    AuditEvent,
    CalculationStep,
    PriceCalculation,
    PriceInput,
    PricePolicy,
    PromotionDecision,
    PromotionRequest,
    PromotionStatus,
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
    """Calculates a listing price using the shared RMB shipping-level rules."""

    def calculate(self, data: PriceInput) -> PriceCalculation:
        self._validate(data)
        policy = data.policy
        estimate = data.purchase_cost * (Decimal("1") + policy.target_profit_rate) + policy.fixed_misc_fee
        steps: list[CalculationStep] = []

        for iteration in range(1, policy.max_iterations + 1):
            level, logistics = self._shipping_fee(data, estimate)
            commission = estimate * policy.commission_rate
            misc = estimate * policy.misc_fee_rate + policy.fixed_misc_fee
            base_cost = data.purchase_cost + commission + logistics + misc
            next_price = base_cost * (Decimal("1") + policy.target_profit_rate)
            steps.append(CalculationStep(iteration, _money(estimate), _money(logistics), _money(commission), _money(misc), _money(next_price), level))
            if abs(next_price - estimate) < CENT:
                estimate = next_price
                break
            estimate = next_price
        else:
            raise ValueError("Price calculation did not converge")

        level, logistics = self._shipping_fee(data, estimate)
        commission = estimate * policy.commission_rate
        misc = estimate * policy.misc_fee_rate + policy.fixed_misc_fee
        base_cost = data.purchase_cost + commission + logistics + misc
        # Never round a protected selling price down: a one-cent shortfall can
        # make the configured target profit unreachable.
        price = estimate.quantize(CENT, rounding=ROUND_CEILING)
        profit = _money(price - base_cost)
        return PriceCalculation(
            shop_id=policy.shop_id,
            price=price,
            min_price=min_price_from_price(price),
            old_price=_money(price * Decimal("2")),
            base_cost=_money(base_cost),
            profit=profit,
            # The shared listing formula defines target profit as a markup on
            # total cost (price = base_cost * (1 + target_profit_rate)).
            profit_rate=(profit / base_cost if base_cost else Decimal("0")),
            logistics_fee=_money(logistics),
            commission=_money(commission),
            misc_fee=_money(misc),
            shipping_level=level,
            steps=tuple(steps),
        )

    @staticmethod
    def _validate(data: PriceInput) -> None:
        if data.purchase_cost < 0 or data.weight_g <= 0:
            raise ValueError("purchase_cost must be non-negative and weight_g must be positive")
        if min(data.length_mm, data.width_mm, data.height_mm) <= 0:
            raise ValueError("package dimensions must be positive")
        if not Decimal("0") <= data.policy.target_profit_rate < Decimal("1"):
            raise ValueError("target_profit_rate must be between 0 and 1")

    @staticmethod
    def _shipping_fee(data: PriceInput, price: Decimal) -> tuple[str, Decimal]:
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
        raise ValueError("No shipping level matches package dimensions, weight and price")


class PromotionService:
    """Evaluates promotion pricing and produces immutable audit payloads."""

    def __init__(self, policy: PricePolicy) -> None:
        self.policy = policy

    def evaluate(self, request: PromotionRequest) -> tuple[PromotionDecision, AuditEvent]:
        if request.shop_id != self.policy.shop_id or request.calculation.shop_id != self.policy.shop_id:
            raise ValueError("Promotion request must belong to the policy shop")
        price = request.proposed_price
        calculation = request.calculation
        min_allowed = Decimal(calculation.min_price) if calculation.min_price else Decimal("0")
        variable_cost = calculation.commission + calculation.misc_fee
        # Recalculate percentage fees at the proposed sale price; shipping stays per matched level.
        projected_cost = (
            calculation.base_cost
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
        approved = PromotionDecision(decision.request, status, decision.reason, decision.projected_profit, decision.projected_profit_rate, approver_id)
        audit = AuditEvent(approved.request.shop_id, "promotion_approved", approver_id, "promotion_request", approved.request.promotion_id, {"status": status.value, "override": str(override).lower()})
        return approved, audit
