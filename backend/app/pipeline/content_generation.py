"""P5: Content generation (Russian) and per-SKU CNY pricing.

Generates Russian title, description, and specification blocks from mapped
product data using LLM translation (with dictionary fallback).  Computes CNY
pricing per SKU using the existing PricingService.  The pricing rules are
versioned and auditable.
"""

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
from ..pricing import PriceInput, PricePolicy, PricingService
from .attribute_mapping import SYNONYM_TABLE
from .llm_translate import translate_product_content

PRICING_RULE_VERSION = "1.0.0"

TITLE_MAX_LEN = 200
DESCRIPTION_MAX_LEN = 5000


def _clean(value):
    if not value or not isinstance(value, str):
        return ""
    stripped = value.strip()
    if stripped.lower() in ("none", "null", "nan", ""):
        return ""
    return stripped


def generate_content(db, shop_id, source_product_id):
    """Generate Russian title, description, specs and pricing."""
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

    # Compute pricing per variant
    variants = list(db.scalars(select(SourceVariantRecord).where(
        SourceVariantRecord.source_product_id == source_product_id,
    )))
    pricing = _compute_pricing(db, shop_id, source_product_id, variants)
    pipeline.pricing_json = json.dumps(pricing, ensure_ascii=False)
    pipeline.pipeline_stage = "content_generated"
    db.commit()

    return {
        "title_ru": title_ru,
        "description_ru": description_ru,
        "specs": specs,
        "pricing": pricing,
        "pricing_rule_version": PRICING_RULE_VERSION,
        "content_verified": content_verified,
        "translation_method": translation["method"],
    }


def _compute_pricing(db, shop_id, source_product_id, variants):
    """Compute CNY pricing for each variant using PricingService."""
    policy = PricePolicy(shop_id=str(shop_id))
    service = PricingService()
    results = []
    for variant in variants:
        purchase_cost = variant.price_cny or Decimal("10")
        weight_g = Decimal("500")
        length_mm = Decimal("200")
        width_mm = Decimal("150")
        height_mm = Decimal("100")
        try:
            calc = service.calculate(PriceInput(
                purchase_cost=purchase_cost,
                weight_g=weight_g,
                length_mm=length_mm,
                width_mm=width_mm,
                height_mm=height_mm,
                policy=policy,
            ))
            results.append({
                "source_sku": variant.source_sku,
                "purchase_cost_cny": float(purchase_cost),
                "price_cny": float(calc.price),
                "min_price_cny": calc.min_price,
                "old_price_cny": float(calc.old_price),
                "profit_cny": float(calc.profit),
                "profit_rate": float(calc.profit_rate),
                "shipping_level": calc.shipping_level,
            })
        except ValueError as exc:
            results.append({
                "source_sku": variant.source_sku,
                "purchase_cost_cny": float(purchase_cost),
                "error": str(exc),
            })
    return {
        "rule_version": PRICING_RULE_VERSION,
        "variants": results,
    }
