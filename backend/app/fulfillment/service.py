"""Business rules for products, sellable inventory and FBS posting fulfilment."""

from __future__ import annotations

from datetime import UTC, datetime, timezone
from uuid import UUID

from .repository import FulfillmentRepository
from .schemas import (
    FbsOrder,
    FbsOrderCreate,
    FbsOrderStatus,
    FulfillmentRisk,
    InventoryBalance,
    OrderLine,
    Product,
    ProductCreate,
    RiskAssessment,
    Sku,
    SkuCreate,
)


class FulfillmentError(ValueError):
    """Raised when a domain invariant would be violated."""


class NotFoundError(FulfillmentError):
    pass


class InsufficientInventoryError(FulfillmentError):
    pass


_FORWARD_TRANSITIONS = {
    FbsOrderStatus.NEW: FbsOrderStatus.AWAITING_PACKAGING,
    FbsOrderStatus.AWAITING_PACKAGING: FbsOrderStatus.AWAITING_DELIVER,
    FbsOrderStatus.AWAITING_DELIVER: FbsOrderStatus.DELIVERING,
    FbsOrderStatus.DELIVERING: FbsOrderStatus.DELIVERED,
}
_CANCELLABLE = {
    FbsOrderStatus.NEW,
    FbsOrderStatus.AWAITING_PACKAGING,
    FbsOrderStatus.AWAITING_DELIVER,
}


class FulfillmentService:
    def __init__(self, repository: FulfillmentRepository, at_risk_minutes: int = 120) -> None:
        if at_risk_minutes < 0:
            raise ValueError("at_risk_minutes must be non-negative")
        self.repository = repository
        self.at_risk_minutes = at_risk_minutes

    def create_product(self, data: ProductCreate) -> Product:
        return self.repository.save_product(Product(**data.model_dump()))

    def create_sku(self, data: SkuCreate) -> Sku:
        product = self.repository.get_product(data.product_id)
        if product is None:
            raise NotFoundError("product not found")
        if product.shop_id != data.shop_id:
            raise FulfillmentError("SKU shop must match its product shop")
        return self.repository.save_sku(Sku(**data.model_dump()))

    def set_on_hand(self, shop_id: UUID, warehouse_id: UUID, sku_id: UUID, on_hand: int) -> InventoryBalance:
        if on_hand < 0:
            raise FulfillmentError("on_hand cannot be negative")
        self._assert_sku_shop(sku_id, shop_id)
        existing = self.repository.get_inventory(shop_id, warehouse_id, sku_id)
        reserved = existing.reserved if existing else 0
        if on_hand < reserved:
            raise FulfillmentError("on_hand cannot be below reserved quantity")
        return self.repository.save_inventory(InventoryBalance(
            shop_id=shop_id, warehouse_id=warehouse_id, sku_id=sku_id,
            on_hand=on_hand, reserved=reserved,
        ))

    def reserve_inventory(self, shop_id: UUID, warehouse_id: UUID, sku_id: UUID, quantity: int) -> InventoryBalance:
        if quantity <= 0:
            raise FulfillmentError("reserve quantity must be positive")
        balance = self._inventory_or_error(shop_id, warehouse_id, sku_id)
        if balance.available < quantity:
            raise InsufficientInventoryError("insufficient sellable inventory")
        return self.repository.save_inventory(balance.model_copy(update={"reserved": balance.reserved + quantity, "updated_at": datetime.now(UTC)}))

    def release_inventory(self, shop_id: UUID, warehouse_id: UUID, sku_id: UUID, quantity: int) -> InventoryBalance:
        if quantity <= 0:
            raise FulfillmentError("release quantity must be positive")
        balance = self._inventory_or_error(shop_id, warehouse_id, sku_id)
        if balance.reserved < quantity:
            raise FulfillmentError("cannot release more than reserved quantity")
        return self.repository.save_inventory(balance.model_copy(update={"reserved": balance.reserved - quantity, "updated_at": datetime.now(UTC)}))

    def create_order(self, data: FbsOrderCreate) -> FbsOrder:
        combined: dict[UUID, int] = {}
        for line in data.lines:
            self._assert_sku_shop(line.sku_id, data.shop_id)
            combined[line.sku_id] = combined.get(line.sku_id, 0) + line.quantity
        for sku_id, quantity in combined.items():
            self.reserve_inventory(data.shop_id, data.warehouse_id, sku_id, quantity)
        order = FbsOrder(**data.model_dump(exclude={"lines"}), lines=tuple(OrderLine(sku_id=k, quantity=v) for k, v in combined.items()))
        return self.repository.save_order(order)

    def transition_order(self, order_id: UUID, next_status: FbsOrderStatus) -> FbsOrder:
        order = self._order_or_error(order_id)
        expected = _FORWARD_TRANSITIONS.get(order.status)
        if expected != next_status:
            raise FulfillmentError(f"invalid transition {order.status} -> {next_status}")
        return self.repository.save_order(order.model_copy(update={"status": next_status, "updated_at": datetime.now(UTC)}))

    def cancel_order(self, order_id: UUID) -> FbsOrder:
        order = self._order_or_error(order_id)
        if order.status not in _CANCELLABLE:
            raise FulfillmentError(f"order in {order.status} cannot be cancelled")
        for line in order.lines:
            self.release_inventory(order.shop_id, order.warehouse_id, line.sku_id, line.quantity)
        cancelled_at = datetime.now(UTC)
        return self.repository.save_order(order.model_copy(update={"status": FbsOrderStatus.CANCELLED, "cancelled_at": cancelled_at, "updated_at": cancelled_at}))

    def assess_timeout_risk(self, order_id: UUID, now: datetime | None = None) -> RiskAssessment:
        order = self._order_or_error(order_id)
        evaluated_at = now or datetime.now(timezone.utc)
        if order.status in {FbsOrderStatus.DELIVERED, FbsOrderStatus.CANCELLED}:
            return RiskAssessment(order_id=order.id, risk=FulfillmentRisk.COMPLETED, minutes_remaining=None, evaluated_at=evaluated_at)
        if order.pack_by is None:
            return RiskAssessment(order_id=order.id, risk=FulfillmentRisk.ON_TRACK, minutes_remaining=None, evaluated_at=evaluated_at)
        deadline = self._as_aware(order.pack_by)
        current = self._as_aware(evaluated_at)
        minutes = int((deadline - current).total_seconds() // 60)
        risk = FulfillmentRisk.OVERDUE if minutes < 0 else (FulfillmentRisk.AT_RISK if minutes <= self.at_risk_minutes else FulfillmentRisk.ON_TRACK)
        return RiskAssessment(order_id=order.id, risk=risk, minutes_remaining=minutes, evaluated_at=evaluated_at)

    def _assert_sku_shop(self, sku_id: UUID, shop_id: UUID) -> Sku:
        sku = self.repository.get_sku(sku_id)
        if sku is None:
            raise NotFoundError("SKU not found")
        if sku.shop_id != shop_id:
            raise FulfillmentError("SKU does not belong to shop")
        return sku

    def _inventory_or_error(self, shop_id: UUID, warehouse_id: UUID, sku_id: UUID) -> InventoryBalance:
        self._assert_sku_shop(sku_id, shop_id)
        balance = self.repository.get_inventory(shop_id, warehouse_id, sku_id)
        if balance is None:
            raise NotFoundError("inventory balance not found")
        return balance

    def _order_or_error(self, order_id: UUID) -> FbsOrder:
        order = self.repository.get_order(order_id)
        if order is None:
            raise NotFoundError("order not found")
        return order

    @staticmethod
    def _as_aware(value: datetime) -> datetime:
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
