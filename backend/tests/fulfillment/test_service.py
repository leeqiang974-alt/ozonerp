from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.fulfillment import FulfillmentService, InMemoryFulfillmentRepository
from app.fulfillment.schemas import FbsOrderCreate, FbsOrderStatus, FulfillmentRisk, OrderLineCreate, ProductCreate, SkuCreate
from app.fulfillment.service import FulfillmentError, InsufficientInventoryError


@pytest.fixture
def prepared():
    service = FulfillmentService(InMemoryFulfillmentRepository(), at_risk_minutes=120)
    shop_id, warehouse_id = uuid4(), uuid4()
    product = service.create_product(ProductCreate(shop_id=shop_id, name="Travel mug"))
    sku = service.create_sku(SkuCreate(product_id=product.id, shop_id=shop_id, seller_sku="MUG-BLK", title="Black travel mug", min_price=Decimal("99.00")))
    service.set_on_hand(shop_id, warehouse_id, sku.id, 10)
    return service, shop_id, warehouse_id, sku


def test_inventory_reservation_and_release(prepared):
    service, shop_id, warehouse_id, sku = prepared
    reserved = service.reserve_inventory(shop_id, warehouse_id, sku.id, 4)
    assert (reserved.on_hand, reserved.reserved, reserved.available) == (10, 4, 6)
    assert service.release_inventory(shop_id, warehouse_id, sku.id, 2).available == 8
    with pytest.raises(InsufficientInventoryError):
        service.reserve_inventory(shop_id, warehouse_id, sku.id, 9)


def test_order_state_machine_and_cancel_releases_reservation(prepared):
    service, shop_id, warehouse_id, sku = prepared
    order = service.create_order(FbsOrderCreate(shop_id=shop_id, warehouse_id=warehouse_id, external_posting_number="123", lines=[OrderLineCreate(sku_id=sku.id, quantity=3)]))
    assert service.repository.get_inventory(shop_id, warehouse_id, sku.id).reserved == 3
    order = service.transition_order(order.id, FbsOrderStatus.AWAITING_PACKAGING)
    assert order.status == FbsOrderStatus.AWAITING_PACKAGING
    assert service.cancel_order(order.id).status == FbsOrderStatus.CANCELLED
    assert service.repository.get_inventory(shop_id, warehouse_id, sku.id).available == 10


def test_invalid_cancel_and_transition_are_rejected(prepared):
    service, shop_id, warehouse_id, sku = prepared
    order = service.create_order(FbsOrderCreate(shop_id=shop_id, warehouse_id=warehouse_id, external_posting_number="124", lines=[OrderLineCreate(sku_id=sku.id, quantity=1)]))
    with pytest.raises(FulfillmentError):
        service.transition_order(order.id, FbsOrderStatus.DELIVERING)
    for state in (FbsOrderStatus.AWAITING_PACKAGING, FbsOrderStatus.AWAITING_DELIVER, FbsOrderStatus.DELIVERING):
        order = service.transition_order(order.id, state)
    with pytest.raises(FulfillmentError):
        service.cancel_order(order.id)


def test_timeout_risk(prepared):
    service, shop_id, warehouse_id, sku = prepared
    now = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
    order = service.create_order(FbsOrderCreate(shop_id=shop_id, warehouse_id=warehouse_id, external_posting_number="125", lines=[OrderLineCreate(sku_id=sku.id, quantity=1)], pack_by=now + timedelta(minutes=90)))
    assert service.assess_timeout_risk(order.id, now).risk == FulfillmentRisk.AT_RISK
    assert service.assess_timeout_risk(order.id, now + timedelta(minutes=91)).risk == FulfillmentRisk.OVERDUE
