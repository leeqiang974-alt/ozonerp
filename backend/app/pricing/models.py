"""Domain models for price calculation, commission evidence, risk codes, and promotions.

All values are Decimal so money is never calculated with binary floats.  These
models intentionally contain no API credential or Ozon transport concerns.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Optional
from uuid import uuid4


@dataclass(frozen=True)
class PricePolicy:
    shop_id: str
    commission_rate: Decimal = Decimal("0.15")
    misc_fee_rate: Decimal = Decimal("0.02")
    fixed_misc_fee: Decimal = Decimal("2")
    target_profit_rate: Decimal = Decimal("0.30")
    max_iterations: int = 40
    old_price_multiplier: Decimal = Decimal("2")
    minimum_profit_rate: Decimal = Decimal("0.08")
    minimum_profit_cny: Decimal = Decimal("3")
    logistics_ratio_warn: Decimal = Decimal("0.35")


class CommissionSource(str, Enum):
    """Evidence tier for commission rate — see ozon-product-pricing-rules skill §5."""
    OZON_SETTLEMENT = "ozon_settlement"
    OZON_CATEGORY = "ozon_category"
    LEARNED_PRODUCT = "learned_product"
    MANUAL_DEFAULT = "manual_default"


class ProfitStatus(str, Enum):
    """Whether the profit figure is usable for business decisions."""
    UNKNOWN = "unknown"
    ESTIMATE = "estimate"
    VERIFIED = "verified"


class RiskCode(str, Enum):
    """Structured risk codes — see ozon-product-pricing-rules skill §7."""
    PRICING_PROCUREMENT_EVIDENCE_MISSING = "PRICING_PROCUREMENT_EVIDENCE_MISSING"
    PRICING_PACKAGE_MISSING = "PRICING_PACKAGE_MISSING"
    PRICING_SHIPPING_LEVEL_MISSING = "PRICING_SHIPPING_LEVEL_MISSING"
    PRICING_NOT_CONVERGED = "PRICING_NOT_CONVERGED"
    PRICING_MIN_PRICE_INVALID = "PRICING_MIN_PRICE_INVALID"
    PRICING_PROFIT_LOW = "PRICING_PROFIT_LOW"
    PRICING_LOGISTICS_RATIO_HIGH = "PRICING_LOGISTICS_RATIO_HIGH"


class DimensionSource(str, Enum):
    """Evidence level for weight/dimensions — see ozon-logistics-shipping-rules skill §6."""
    FROM_1688_PACKAGE = "1688_package"
    MANUAL_MEASURED = "manual_measured"
    CAPTURE_HINT = "capture_hint"
    DEFAULT_GUESS = "default_guess"


@dataclass(frozen=True)
class PriceInput:
    purchase_cost: Decimal
    weight_g: Decimal
    length_mm: Decimal
    width_mm: Decimal
    height_mm: Decimal
    policy: PricePolicy
    dimension_source: DimensionSource = DimensionSource.DEFAULT_GUESS
    commission_source: CommissionSource = CommissionSource.MANUAL_DEFAULT


@dataclass(frozen=True)
class CalculationStep:
    iteration: int
    estimated_price: Decimal
    logistics_fee: Decimal
    commission: Decimal
    misc_fee: Decimal
    next_price: Decimal
    shipping_level: str


@dataclass(frozen=True)
class PriceCalculation:
    shop_id: str
    price: Decimal
    min_price: str
    old_price: Decimal
    base_cost: Decimal
    profit: Decimal
    profit_rate: Decimal
    logistics_fee: Decimal
    commission: Decimal
    misc_fee: Decimal
    shipping_level: str
    steps: tuple[CalculationStep, ...]
    risk_codes: tuple[RiskCode, ...] = ()
    profit_status: ProfitStatus = ProfitStatus.UNKNOWN
    commission_source: CommissionSource = CommissionSource.MANUAL_DEFAULT
    dimension_source: DimensionSource = DimensionSource.DEFAULT_GUESS
    pricing_rule_version: str = "2.0.0"


class PromotionStatus(str, Enum):
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    OVERRIDDEN = "overridden"


@dataclass(frozen=True)
class Promotion:
    shop_id: str
    name: str
    starts_at: datetime
    ends_at: datetime
    promotion_id: str = field(default_factory=lambda: str(uuid4()))


@dataclass(frozen=True)
class PromotionRequest:
    shop_id: str
    sku_id: str
    promotion_id: str
    proposed_price: Decimal
    calculation: PriceCalculation
    requested_by: str


@dataclass(frozen=True)
class PromotionDecision:
    request: PromotionRequest
    status: PromotionStatus
    reason: str
    projected_profit: Decimal
    projected_profit_rate: Decimal
    approver: Optional[str] = None
    decided_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass(frozen=True)
class AuditEvent:
    shop_id: str
    action: str
    actor_id: str
    entity_type: str
    entity_id: str
    details: dict[str, str]
    occurred_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    event_id: str = field(default_factory=lambda: str(uuid4()))
