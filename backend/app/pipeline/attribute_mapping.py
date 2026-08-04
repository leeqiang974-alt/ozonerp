"""P3: Attribute auto-fill.

Maps extracted product facts and 1688 spec data to Ozon category attributes
using deterministic rules first, then synonym matching.  Dictionary attributes
are searched and value_id persisted; free-text attributes get value_text only.
"""

from __future__ import annotations

import json
import re
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..erp_models import (
    PipelineProductRecord,
    SourceProductRecord,
    SourceVariantRecord,
)
from ..listing_metadata_service import get_category_attributes, search_category_attribute_values
from .fact_extraction import ProductFacts


# Deterministic mapping: 1688/material fact -> Ozon attribute name fragment (Russian or English)
ATTRIBUTE_MAPPING_RULES: dict[str, list[str]] = {
    "material": ["material", "materyal", " ", "sostav"],
    "usage": ["类型", "用途", "naznachenie", "primenenie", "tip"],
    "form": ["forma", "vid"],
    "brand": ["品牌", "brend", "proizvoditel", "brand"],
    "color": ["cvet", "color", "tsvet"],
    "size": ["razmer", "size", "obem"],
    "weight": ["ves", "weight"],
    "model": ["型号", "model", "модель"],
    "product_type": ["类型", "type", "tip"],
}

# Chinese-to-Russian synonym table for common attribute values
SYNONYM_TABLE: dict[str, str] = {
    "不锈钢": "nerzhaveyushchaya stal",
    "塑料": "plastik",
    "硅胶": "silikon",
    "陶瓷": "keramika",
    "玻璃": "steklo",
    "木质": "derevo",
    "竹制": "bambuk",
    "棉": "khlopok",
    "涤纶": "poliester",
    "尼龙": "neylon",
    "铝合金": "alyuminiy",
    "铸铁": "chugun",
    "红色": "krasnyy",
    "蓝色": "siniy",
    "绿色": "zelenyy",
    "黑色": "chernyy",
    "白色": "belyy",
    "黄色": "zheltyy",
    "紫色": "fioletovyy",
    "橙色": "oranzhevyy",
    "粉色": "rozovyy",
    "灰色": "seryy",
    "圆形": "kruglyy",
    "方形": "kvadratnyy",
    "长方形": "pryamougolnyy",
    "折叠": "skladnoy",
    "壁挂": "nastennyy",
    "立式": "napolnyy",
    "手持": "ruchnoy",
}


def map_attributes(
    db: Session,
    shop_id: int,
    source_product_id: int,
    facts: ProductFacts | None = None,
) -> dict[str, Any]:
    """Map product facts to Ozon attributes for the locked category.

    Returns a dict with coverage stats and the mapping itself.
    """
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None or not pipeline.matched_category_id:
        raise ValueError("P2 category matching must be completed before attribute mapping")
    source = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.id == source_product_id,
    ))
    if source is None:
        raise ValueError("source product not found")
    if facts is None:
        from .fact_extraction import extract_facts
        facts = extract_facts(source)
    category_id = pipeline.matched_category_id
    type_id = pipeline.matched_type_id or ""
    # Load all Ozon attributes for this category/type via read-through cache.
    # This triggers a live API call (language=ZH_HANS) if the cache is empty/stale.
    attributes = get_category_attributes(db, shop_id, category_id, type_id)
    # Build fact lookup
    fact_values: dict[str, str] = {
        "material": facts.material or source.material or "",
        "model": facts.model or "",
        "product_type": facts.product_type or "",
        "usage": facts.usage or "",
        "form": facts.form or "",
        "brand": source.brand or facts.core_product or "",
    }
    # Extract color/size from variant spec names
    variant_specs = list(db.scalars(select(SourceVariantRecord).where(
        SourceVariantRecord.source_product_id == source_product_id,
    )))
    for vspec in variant_specs:
        spec = vspec.spec_name or ""
        for cn, _ in SYNONYM_TABLE.items():
            if cn in spec:
                if "color" not in fact_values:
                    fact_values["color"] = cn
                if "razmer" not in spec.lower() and "size" not in spec.lower():
                    if "size" not in fact_values:
                        fact_values["size"] = spec
    # Match facts to attributes
    mapping: list[dict[str, Any]] = []
    matched_count = 0
    required_count = 0
    required_matched = 0
    for attr in attributes:
        attr_name_lower = attr["name"].lower()
        matched = False
        matched_source = ""
        value_id = None
        value_text = None
        # Try deterministic rules
        for fact_key, name_fragments in ATTRIBUTE_MAPPING_RULES.items():
            fact_value = fact_values.get(fact_key, "")
            if not fact_value:
                continue
            # Match fragment as a standalone word/component, not substring
            # e.g. "类型" should match "类型" but not "噪声吸收类型"
            matched_fragment = False
            for fragment in name_fragments:
                if fragment == attr_name_lower:
                    matched_fragment = True
                    break
                # Check if fragment appears as a distinct component
                # or at the start of a component
                parts = re.split(r"[,，、\s()（）]+", attr_name_lower)
                for part in parts:
                    if fragment == part or part.startswith(fragment):
                        matched_fragment = True
                        break
                if matched_fragment:
                    break
            if matched_fragment:
                # Translate Chinese to Russian if possible
                translated = SYNONYM_TABLE.get(fact_value, fact_value)
                value_text = translated
                matched = True
                matched_source = f"rule:{fact_key}"
                break
        # Try synonym matching on attribute name
        if not matched:
            for cn, ru in SYNONYM_TABLE.items():
                if cn in attr["name"] or ru.lower() in attr_name_lower:
                    # Check if any fact value matches
                    for fv in fact_values.values():
                        if fv and (cn in fv or ru.lower() in fv.lower()):
                            value_text = ru
                            matched = True
                            matched_source = "synonym"
                            break
                    if matched:
                        break
        # If dictionary attribute, search for value_id
        if matched and attr["dictionary_id"] and value_text:
            try:
                results = _search_dict_progressive(
                    db, shop_id, category_id, type_id, attr["id"], value_text
                )
                if results:
                    value_id = results["id"]
                    value_text = results["value"]
                else:
                    # No dictionary match found -- clear the value
                    value_id = None
                    value_text = None
                    matched = False
                    matched_source = ""
            except Exception:
                pass  # dictionary search is best-effort
        if attr["required"]:
            required_count += 1
            if matched:
                required_matched += 1
        if matched:
            matched_count += 1
        mapping.append({
            "attribute_id": attr["id"],
            "name": attr["name"],
            "required": attr["required"],
            "dictionary_id": attr["dictionary_id"],
            "value_id": value_id,
            "value_text": value_text,
            "matched": matched,
            "source": matched_source,
        })
    coverage = Decimal(str(round(matched_count / len(attributes) * 100, 2))) if attributes else Decimal("0")
    pipeline.attribute_mapping_json = json.dumps(mapping, ensure_ascii=False)
    pipeline.attribute_coverage = coverage
    pipeline.pipeline_stage = "attributes_mapped"
    db.commit()
    return {
        "mapping": mapping,
        "total_attributes": len(attributes),
        "matched": matched_count,
        "required_total": required_count,
        "required_matched": required_matched,
        "coverage_percent": float(coverage),
    }


def _search_dict_progressive(
    db: Session, shop_id: int, category_id: str, type_id: str,
    attribute_id: str, value: str, limit: int = 10,
) -> dict | None:
    """Search dictionary with fallback to no-brand."""
    results = search_category_attribute_values(
        db, shop_id, category_id, type_id, attribute_id, value, limit=limit
    )
    if results:
        best = _best_dictionary_match(value, results)
        if best:
            return best
    # Fallback: try "无品牌" for brand-like attributes
    for fallback in ("No brand", "Без бренда", "no brand"):
        results = search_category_attribute_values(
            db, shop_id, category_id, type_id, attribute_id, fallback, limit=limit
        )
        if results:
            return results[0]
    return None


def _best_dictionary_match(target: str, results: list[dict]) -> dict | None:
    """Find the best matching dictionary value by case-insensitive contains."""
    target_lower = target.lower()
    for result in results:
        if target_lower in (result.get("value") or "").lower():
            return result
    return results[0] if results else None
