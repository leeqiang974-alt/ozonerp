"""Domain models for price calculation and controlled promotions.

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


class PromotionStatus(str, Enum):
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    OVERRIDDEN = "overridden"


@dataclass(frozen=True)
class PricePolicy:
    shop_id: str
    commission_rate: Decimal = Decimal("0.15")
    misc_fee_rate: Decimal = Decimal("0.02")
    fixed_misc_fee: Decimal = Decimal("2")
    target_profit_rate: Decimal = Decimal("0.30")
    max_iterations: int = 40


@dataclass(frozen=True)
class PriceInput:
    purchase_cost: Decimal
    weight_g: Decimal
    length_mm: Decimal
    width_mm: Decimal
    height_mm: Decimal
    policy: PricePolicy


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
