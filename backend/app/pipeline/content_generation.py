from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..erp_models import (
    OzonCategoryCacheRecord,
    PipelineProductRecord,
    SourceProductRecord,
    SourceVariantRecord,
)
from ..pricing import (
    CommissionSource,
    DimensionSource,
    PriceInput,
    PricePolicy,
    PricingService,
    RiskCode,
)
from .attribute_mapping import SYNONYM_TABLE
from .llm_translate import translate_product_content

PRICING_RULE_VERSION = "2.0.0"

TITLE_MAX_LEN = 200
DESCRIPTION_MAX_LEN = 5000


def _clean(value):
    if not value or not isinstance(value, str):
        return ""
    stripped = value.strip()
    if stripped.lower() in ("none", "null", "nan", ""):
        return ""
    return stripped


def _extract_weight_from_raw(raw_json: str | None) -> Decimal | None:
    """Try to extract weight (in grams) from the 1688 raw data."""
    if not raw_json:
        return None
    try:
        data = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
    except (json.JSONDecodeError, TypeError):
        return None
    # Check common fields in 1688 product data
    for key in ("weight", "weight_g", "毛重", "产品重量", "商品重量"):
        val = data.get(key)
        if val:
            try:
                return Decimal(str(val))
            except (ValueError, TypeError, Decimal.InvalidOperation):
                pass
    return None


def _extract_dimensions_from_raw(raw_json: str | None) -> tuple[Decimal, Decimal, Decimal] | None:
    """Try to extract LxWxH (in mm) from the 1688 raw data."""
    if not raw_json:
        return None
    try:
        data = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
    except (json.JSONDecodeError, TypeError):
        return None
    for key_set in (
        ("length_mm", "width_mm", "height_mm"),
        ("length", "width", "height"),
        ("包装长度", "包装宽度", "包装高度"),
        ("产品尺寸",),
    ):
        vals = [data.get(k) for k in key_set]
        if all(v is not None for v in vals):
            try:
                dims = [Decimal(str(v)) for v in vals]
                if len(dims) == 3:
                    return tuple(dims)
                # Single key "产品尺寸" might be "20x15x10" or "20*15*10"
                if len(dims) == 1 and isinstance(vals[0], str):
                    import re
                    parts = re.split(r"[xX*×]", str(vals[0]))
                    if len(parts) == 3:
                        return tuple(Decimal(p.strip()) for p in parts)
                return None
            except (ValueError, TypeError, Decimal.InvalidOperation):
                pass
    return None


def generate_content(db, shop_id, source_product_id):
    """Generate Russian title, description, specs and pricing (v2)."""
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found")
    source = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.id == source_product_id,
    ))
    if source is None:
        raise ValueError("source product not found")

    src_title = _clean(source.title) or "Product"
    material = _clean(source.material)
    brand = _clean(source.brand)

    # Get category title for context
    category_zh = ""
    if pipeline.matched_category_id:
        category = db.scalar(select(OzonCategoryCacheRecord).where(
            OzonCategoryCacheRecord.shop_id == shop_id,
            OzonCategoryCacheRecord.category_id == pipeline.matched_category_id,
            OzonCategoryCacheRecord.type_id == (pipeline.matched_type_id or ""),
        ))
        if category:
            category_zh = _clean(category.title_zh) or _clean(category.title)

    # Build specs from attribute mapping
    specs = []
    if pipeline.attribute_mapping_json:
        mapping = json.loads(pipeline.attribute_mapping_json)
        for item in mapping:
            if item.get("value_text"):
                specs.append({
                    "name": item["name"],
                    "value": item["value_text"],
                })

    # Translate using LLM (with dictionary fallback)
    translation = translate_product_content(
        src_title,
        material=material,
        brand=brand,
        category_zh=category_zh,
        specs=specs,
    )

    title_ru = translation["title_ru"][:TITLE_MAX_LEN]
    description_ru = translation["description_ru"][:DESCRIPTION_MAX_LEN]
    content_verified = translation["verified"]

    pipeline.generated_title_ru = title_ru
    pipeline.generated_description_ru = description_ru
    pipeline.generated_specs_json = json.dumps(specs, ensure_ascii=False)
    pipeline.content_verified = content_verified

    # Try to extract weight/dimensions from source raw_json
    raw_json = source.raw_json
    weight_g = _extract_weight_from_raw(raw_json)
    dims = _extract_dimensions_from_raw(raw_json)
    if weight_g and dims:
        dimension_source = DimensionSource.FROM_1688_PACKAGE
    elif weight_g or dims:
        dimension_source = DimensionSource.CAPTURE_HINT
    else:
        dimension_source = DimensionSource.DEFAULT_GUESS

    # Compute pricing per variant
    variants = list(db.scalars(select(SourceVariantRecord).where(
        SourceVariantRecord.source_product_id == source_product_id,
    )))
    pricing = _compute_pricing(
        shop_id, source_product_id, variants,
        weight_g=weight_g, dims=dims, dimension_source=dimension_source,
    )
    # Store extracted dimensions in pricing_json for downstream use
    pricing["_extracted_weight_g"] = float(weight_g) if weight_g else None
    pricing["_extracted_dimensions_mm"] = [float(d) for d in dims] if dims else None
    pipeline.pricing_json = json.dumps(pricing, ensure_ascii=False)
    return {
        "title_ru": title_ru,
        "description_ru": description_ru,
        "specs": specs,
        "pricing": pricing,
        "pricing_rule_version": PRICING_RULE_VERSION,
        "content_verified": content_verified,
        "translation_method": translation["method"],
    }


def _compute_pricing(
    shop_id, source_product_id, variants,
    weight_g: Decimal | None = None,
    dims: tuple[Decimal, Decimal, Decimal] | None = None,
    dimension_source: DimensionSource = DimensionSource.DEFAULT_GUESS,
):
    """Compute CNY pricing for each variant using PricingService v2."""
    commission_source = CommissionSource.MANUAL_DEFAULT
    policy = PricePolicy(shop_id=str(shop_id))
    service = PricingService()

    # Use provided weight/dimensions, or fall back to defaults
    w = weight_g or Decimal("500")
    l_mm = dims[0] if dims else Decimal("200")
    w_mm = dims[1] if dims else Decimal("150")
    h_mm = dims[2] if dims else Decimal("100")

    results = []
    for variant in variants:
        purchase_cost = variant.price_cny or Decimal("10")
        try:
            calc = service.calculate(PriceInput(
                purchase_cost=purchase_cost,
                weight_g=w,
                length_mm=l_mm,
                width_mm=w_mm,
                height_mm=h_mm,
                policy=policy,
                dimension_source=dimension_source,
                commission_source=commission_source,
            ))
            result = {
                "source_sku": variant.source_sku,
                "purchase_cost_cny": float(purchase_cost),
                "price_cny": float(calc.price),
                "min_price_cny": calc.min_price,
                "old_price_cny": float(calc.old_price),
                "profit_cny": float(calc.profit),
                "profit_rate": float(calc.profit_rate),
                "shipping_level": calc.shipping_level,
                "profit_status": calc.profit_status.value,
                "commission_source": calc.commission_source.value,
                "dimension_source": calc.dimension_source.value,
                "risk_codes": [r.value for r in calc.risk_codes],
            }
            results.append(result)
        except ValueError as exc:
            results.append({
                "source_sku": variant.source_sku,
                "purchase_cost_cny": float(purchase_cost),
                "error": str(exc),
                "risk_codes": ["PRICING_PACKAGE_MISSING"],
            })
    return {
        "rule_version": PRICING_RULE_VERSION,
        "variants": results,
    }
