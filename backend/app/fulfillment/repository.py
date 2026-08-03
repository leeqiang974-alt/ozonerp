"""Repository seam for FBS. Replace this implementation with SQLAlchemy storage."""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from .schemas import FbsOrder, InventoryBalance, Product, Sku


class FulfillmentRepository(Protocol):
    def save_product(self, product: Product) -> Product: ...
    def get_product(self, product_id: UUID) -> Product | None: ...
    def save_sku(self, sku: Sku) -> Sku: ...
    def get_sku(self, sku_id: UUID) -> Sku | None: ...
    def save_inventory(self, balance: InventoryBalance) -> InventoryBalance: ...
    def get_inventory(self, shop_id: UUID, warehouse_id: UUID, sku_id: UUID) -> InventoryBalance | None: ...
    def save_order(self, order: FbsOrder) -> FbsOrder: ...
    def get_order(self, order_id: UUID) -> FbsOrder | None: ...


class InMemoryFulfillmentRepository:
    """Deterministic development/test repository with the production repository API."""

    def __init__(self) -> None:
        self.products: dict[UUID, Product] = {}
        self.skus: dict[UUID, Sku] = {}
        self.inventory: dict[tuple[UUID, UUID, UUID], InventoryBalance] = {}
        self.orders: dict[UUID, FbsOrder] = {}

    def save_product(self, product: Product) -> Product:
        self.products[product.id] = product
        return product

    def get_product(self, product_id: UUID) -> Product | None:
        return self.products.get(product_id)

    def save_sku(self, sku: Sku) -> Sku:
        self.skus[sku.id] = sku
        return sku

    def get_sku(self, sku_id: UUID) -> Sku | None:
        return self.skus.get(sku_id)

    def save_inventory(self, balance: InventoryBalance) -> InventoryBalance:
        self.inventory[(balance.shop_id, balance.warehouse_id, balance.sku_id)] = balance
        return balance

    def get_inventory(self, shop_id: UUID, warehouse_id: UUID, sku_id: UUID) -> InventoryBalance | None:
        return self.inventory.get((shop_id, warehouse_id, sku_id))

    def save_order(self, order: FbsOrder) -> FbsOrder:
        self.orders[order.id] = order
        return order

    def get_order(self, order_id: UUID) -> FbsOrder | None:
        return self.orders.get(order_id)
