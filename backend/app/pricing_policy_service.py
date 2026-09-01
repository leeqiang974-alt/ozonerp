"""Persistent ERP-wide pricing policy and source-SKU price quotes."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from .erp_models import PricingPolicyRecord
from .pricing import DimensionSource, PriceInput, PricePolicy, PricingService


POLICY_FIELDS = (
    "purchase_buffer_cny",
    "commission_rate",
    "misc_fee_rate",
    "fixed_misc_fee",
    "target_profit_rate",
    "old_price_multiplier",
    "listing_price_floor_cny",
    "minimum_profit_rate",
    "minimum_profit_cny",
    "logistics_ratio_warn",
    "max_iterations",
)


def get_pricing_policy(db: Session) -> PricingPolicyRecord:
    record = db.get(PricingPolicyRecord, 1)
    if record is None:
        record = PricingPolicyRecord(id=1)
        db.add(record)
        db.commit()
        db.refresh(record)
    return record


def update_pricing_policy(db: Session, values: dict) -> PricingPolicyRecord:
    record = get_pricing_policy(db)
    for field in POLICY_FIELDS:
        if field in values and values[field] is not None:
            setattr(record, field, values[field])
    if values.get("updated_by"):
        record.updated_by = str(values["updated_by"])
    db.commit()
    db.refresh(record)
    return record


def domain_policy(record: PricingPolicyRecord, shop_id: int | str) -> PricePolicy:
    return PricePolicy(
        shop_id=str(shop_id),
        commission_rate=Decimal(record.commission_rate),
        misc_fee_rate=Decimal(record.misc_fee_rate),
        fixed_misc_fee=Decimal(record.fixed_misc_fee),
        target_profit_rate=Decimal(record.target_profit_rate),
        max_iterations=int(record.max_iterations),
        old_price_multiplier=Decimal(record.old_price_multiplier),
        listing_price_floor_cny=Decimal(record.listing_price_floor_cny),
        minimum_profit_rate=Decimal(record.minimum_profit_rate),
        minimum_profit_cny=Decimal(record.minimum_profit_cny),
        logistics_ratio_warn=Decimal(record.logistics_ratio_warn),
    )


def domain_policy_from_values(values: dict, shop_id: int | str) -> PricePolicy:
    return PricePolicy(
        shop_id=str(shop_id),
        commission_rate=Decimal(values["commission_rate"]),
        misc_fee_rate=Decimal(values["misc_fee_rate"]),
        fixed_misc_fee=Decimal(values["fixed_misc_fee"]),
        target_profit_rate=Decimal(values["target_profit_rate"]),
        max_iterations=int(values["max_iterations"]),
        old_price_multiplier=Decimal(values["old_price_multiplier"]),
        listing_price_floor_cny=Decimal(values["listing_price_floor_cny"]),
        minimum_profit_rate=Decimal(values["minimum_profit_rate"]),
        minimum_profit_cny=Decimal(values["minimum_profit_cny"]),
        logistics_ratio_warn=Decimal(values["logistics_ratio_warn"]),
    )


def policy_dict(record: PricingPolicyRecord) -> dict:
    result = {field: getattr(record, field) for field in POLICY_FIELDS}
    result.update({
        "scope": "all_shops",
        "updated_by": record.updated_by,
        "updated_at": record.updated_at,
        "formula_version": PricingService.RULE_VERSION,
    })
    return result


def quote_source_price(
    db: Session,
    *,
    shop_id: int,
    source_price_cny: Decimal,
    weight_g: Decimal,
    length_mm: Decimal,
    width_mm: Decimal,
    height_mm: Decimal,
    policy_values: dict | None = None,
) -> dict:
    record = get_pricing_policy(db)
    purchase_buffer = Decimal(policy_values["purchase_buffer_cny"]) if policy_values else Decimal(record.purchase_buffer_cny)
    selected_policy = domain_policy_from_values(policy_values, shop_id) if policy_values else domain_policy(record, shop_id)
    purchase_cost = (source_price_cny + purchase_buffer).quantize(Decimal("0.01"))
    calculation = PricingService().calculate(PriceInput(
        purchase_cost=purchase_cost,
        weight_g=weight_g,
        length_mm=length_mm,
        width_mm=width_mm,
        height_mm=height_mm,
        policy=selected_policy,
        dimension_source=DimensionSource.FROM_1688_PACKAGE,
    ))
    return {
        "source_price_cny": source_price_cny,
        "purchase_cost_cny": purchase_cost,
        "price_cny": calculation.price,
        "old_price_cny": calculation.old_price,
        "min_price_cny": calculation.min_price,
        "shipping_level": calculation.shipping_level,
        "logistics_fee_cny": calculation.logistics_fee,
        "commission_cny": calculation.commission,
        "misc_fee_cny": calculation.misc_fee,
        "base_cost_cny": calculation.base_cost,
        "profit_cny": calculation.profit,
        "profit_rate": calculation.profit_rate,
        "risk_codes": [risk.value for risk in calculation.risk_codes],
        "steps": [
            {
                "iteration": step.iteration,
                "estimated_price": step.estimated_price,
                "logistics_fee": step.logistics_fee,
                "commission": step.commission,
                "misc_fee": step.misc_fee,
                "next_price": step.next_price,
                "shipping_level": step.shipping_level,
            }
            for step in calculation.steps
        ],
    }
