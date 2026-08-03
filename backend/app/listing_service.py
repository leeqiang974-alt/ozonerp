"""Local-only listing draft validation; it never invokes an Ozon write API."""

from __future__ import annotations

import json
from decimal import Decimal

from sqlalchemy.orm import Session

from .erp_models import ListingDraftRecord
from .pricing import PriceInput, PricePolicy, PricingService


def validate_listing_draft(db: Session, draft: ListingDraftRecord) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    if not draft.category_id:
        issues.append({"field": "category_id", "message": "请选择 Ozon 末级类目后再进入发布审批。"})
    if not draft.type_id:
        issues.append({"field": "type_id", "message": "请选择 Ozon 商品类型后再进入发布审批。"})
    if not _is_http_url(draft.primary_image_url):
        issues.append({"field": "primary_image_url", "message": "请提供可访问的主图 URL。"})
    if not draft.variants:
        issues.append({"field": "variants", "message": "至少需要一个商品变体。"})
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
            variant.min_price_cny = calculation.min_price
            variant.old_price_cny = calculation.old_price
        except ValueError as exc:
            issues.append({"field": prefix, "message": f"CNY 核价未通过：{exc}"})
    draft.status = "ready_for_approval" if not issues else "validation_failed"
    draft.validation_json = json.dumps({"issues": issues}, ensure_ascii=False, separators=(",", ":"))
    db.commit()
    return issues


def _is_http_url(value: str | None) -> bool:
    return bool(value and value.startswith(("https://", "http://")))
