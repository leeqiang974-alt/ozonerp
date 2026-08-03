"""Pydantic contracts for the FBS fulfilment domain.

These are deliberately transport-agnostic; an API layer can expose them without
coupling the domain to FastAPI or to the Ozon Seller API.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

PositiveQuantity = Annotated[int, Field(gt=0)]
NonNegativeQuantity = Annotated[int, Field(ge=0)]
Money = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]


class FbsOrderStatus(StrEnum):
    NEW = "new"
    AWAITING_PACKAGING = "awaiting_packaging"
    AWAITING_DELIVER = "awaiting_deliver"
    DELIVERING = "delivering"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


class FulfillmentRisk(StrEnum):
    ON_TRACK = "on_track"
    AT_RISK = "at_risk"
    OVERDUE = "overdue"
    COMPLETED = "completed"


class ProductCreate(BaseModel):
    shop_id: UUID
    name: str = Field(min_length=1, max_length=500)
    external_product_id: str | None = Field(default=None, max_length=128)


class Product(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID = Field(default_factory=uuid4)
    shop_id: UUID
    name: str
    external_product_id: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class SkuCreate(BaseModel):
    product_id: UUID
    shop_id: UUID
    seller_sku: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=500)
    min_price: Money


class Sku(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID = Field(default_factory=uuid4)
    product_id: UUID
    shop_id: UUID
    seller_sku: str
    title: str
    min_price: Decimal
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class InventoryBalance(BaseModel):
    model_config = ConfigDict(frozen=True)

    shop_id: UUID
    warehouse_id: UUID
    sku_id: UUID
    on_hand: NonNegativeQuantity = 0
    reserved: NonNegativeQuantity = 0
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @property
    def available(self) -> int:
        return self.on_hand - self.reserved


class OrderLineCreate(BaseModel):
    sku_id: UUID
    quantity: PositiveQuantity


class FbsOrderCreate(BaseModel):
    shop_id: UUID
    warehouse_id: UUID
    external_posting_number: str = Field(min_length=1, max_length=128)
    lines: list[OrderLineCreate] = Field(min_length=1)
    pack_by: datetime | None = None
    raw_ozon_status: str | None = Field(default=None, max_length=128)


class OrderLine(BaseModel):
    model_config = ConfigDict(frozen=True)

    sku_id: UUID
    quantity: PositiveQuantity


class FbsOrder(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID = Field(default_factory=uuid4)
    shop_id: UUID
    warehouse_id: UUID
    external_posting_number: str
    lines: tuple[OrderLine, ...]
    status: FbsOrderStatus = FbsOrderStatus.NEW
    raw_ozon_status: str | None = None
    pack_by: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    cancelled_at: datetime | None = None


class RiskAssessment(BaseModel):
    order_id: UUID
    risk: FulfillmentRisk
    minutes_remaining: int | None
    evaluated_at: datetime
