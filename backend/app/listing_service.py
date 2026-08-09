"""Local-only listing draft validation; it never invokes an Ozon write API."""

from __future__ import annotations

import json
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .erp_models import ListingDraftRecord, OzonAttributeCacheRecord, OzonAttributeDictionaryValueRecord
from .pricing import PriceInput, PricePolicy, PricingService


def validate_listing_draft(db: Session, draft: ListingDraftRecord) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    if not draft.category_id:
        issues.append({"field": "category_id", "message": "请选择 Ozon 末级类目后再进入发布审批。"})
    if not draft.type_id:
        issues.append({"field": "type_id", "message": "请选择 Ozon 商品类型后再进入发布审批。"})
    if draft.category_id and draft.type_id:
        attribute_templates = list(db.scalars(select(OzonAttributeCacheRecord).where(
            OzonAttributeCacheRecord.shop_id == draft.shop_id,
            OzonAttributeCacheRecord.category_id == draft.category_id,
            OzonAttributeCacheRecord.type_id == draft.type_id,
        )))
        if not attribute_templates:
            issues.append({"field": "attributes", "message": "当前类目的 Ozon 属性模板尚未缓存，请重新选择类目后再预检。"})
        required_attributes = [attribute for attribute in attribute_templates if attribute.required]
        values_by_attribute = {value.attribute_id: value for value in draft.attribute_values}
        for attribute in required_attributes:
            value = values_by_attribute.get(attribute.attribute_id)
            has_value = bool(value and ((value.value_id or "").strip() if attribute.dictionary_id else (value.value_text or "").strip()))
            if has_value and attribute.dictionary_id:
                cached_value = db.scalar(select(OzonAttributeDictionaryValueRecord).where(
                    OzonAttributeDictionaryValueRecord.shop_id == draft.shop_id,
                    OzonAttributeDictionaryValueRecord.category_id == draft.category_id,
                    OzonAttributeDictionaryValueRecord.type_id == draft.type_id,
                    OzonAttributeDictionaryValueRecord.attribute_id == attribute.attribute_id,
                    OzonAttributeDictionaryValueRecord.value_id == value.value_id,
                ))
                has_value = bool(cached_value and (not value.value_text or cached_value.value == value.value_text))
            if not has_value:
                issues.append({"field": f"attributes.{attribute.attribute_id}", "message": f"请填写 Ozon 必填属性：{attribute.name}。"})
    if not _is_http_url(draft.primary_image_url):
        issues.append({"field": "primary_image_url", "message": "请提供可访问的主图 URL。"})
    if not draft.variants:
        issues.append({"field": "variants", "message": "至少需要一个商品变体。"})
    all_risk_codes: list[str] = []
    for variant in draft.variants:
        prefix = f"variants.{variant.seller_sku}"
        values = (variant.purchase_cost_cny, variant.weight_g, variant.length_mm, variant.width_mm, variant.height_mm)
        if any(value is None for value in values):
            issues.append({"field": prefix, "message": "请补全采购成本、重量和包装尺寸（CNY / g / mm）。"})
            continue
        try:
            calculation = PricingService().calculate(PriceInput(
                purchase_cost=Decimal(variant.purchase_cost_cny), weight_g=Decimal(variant.weight_g),
                length_mm=Decimal(variant.length_mm), width_mm=Decimal(variant.width_mm), height_mm=Decimal(variant.height_mm),
                policy=PricePolicy(shop_id=str(draft.shop_id)),
            ))
            variant.calculated_price_cny = calculation.price
            all_risk_codes = [r.value for r in calculation.risk_codes]
            # User pricing rules: if price_cny is manually set, derive old_price and min_price from it
            # old_price = price * 2; min_price = floor(price), if integer then -1
            if variant.price_cny:
                from decimal import ROUND_FLOOR
                _p = Decimal(str(variant.price_cny))
                variant.old_price_cny = str(_p * Decimal("2"))
                _whole = _p.to_integral_value(rounding=ROUND_FLOOR)
                if _whole == _p:
                    variant.min_price_cny = str(_whole - Decimal("1"))
                else:
                    variant.min_price_cny = str(_whole)
            else:
                variant.min_price_cny = calculation.min_price
                variant.old_price_cny = calculation.old_price
        except ValueError as exc:
            issues.append({"field": prefix, "message": f"CNY 核价未通过：{exc}"})
    draft.status = "ready_for_approval" if not issues else "validation_failed"
    risk_data = {"issues": issues}
    if all_risk_codes:
        risk_data["risk_codes"] = all_risk_codes
    draft.validation_json = json.dumps(risk_data, ensure_ascii=False, separators=(",", ":"))
    db.commit()
    return issues


def _is_http_url(value: str | None) -> bool:
    return bool(value and value.startswith(("https://", "http://")))
