"""P6: Quality workbench and pre-check.

Scores the pipeline product across category confidence, attribute coverage,
content completeness (including Russian language verification), image/SKU
compliance, and pricing profitability.  Generates a preview of the Ozon import
payload WITHOUT writing to Ozon.
"""

from __future__ import annotations

import json
import re
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..erp_models import PipelineProductRecord, SourceProductRecord
from .variant_mapping import check_media_compliance


def _has_cyrillic(text: str) -> bool:
    """Check if text contains Cyrillic characters (Russian)."""
    return bool(text and re.search(r"[\u0400-\u04FF]", text))


def _has_chinese(text: str) -> bool:
    """Check if text contains Chinese characters."""
    return bool(text and re.search(r"[\u4e00-\u9fff]", text))


def run_quality_check(db, shop_id, source_product_id):
    """Run the full P6 quality check and update the pipeline record."""
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found")
    issues = []
    scores = {}

    # Category confidence
    cat_conf = float(pipeline.category_confidence or 0)
    scores["category_confidence"] = min(100.0, cat_conf)
    if cat_conf == 0:
        issues.append({"field": "category", "message": "no category match found"})
    elif cat_conf < 50:
        issues.append({"field": "category", "message": f"low category confidence ({cat_conf:.0f}%), review recommended"})

    # Attribute coverage
    attr_coverage = float(pipeline.attribute_coverage or 0)
    scores["attribute_coverage"] = attr_coverage
    if pipeline.matched_category_id and pipeline.attribute_mapping_json:
        mapping = json.loads(pipeline.attribute_mapping_json)
        missing_required = [m for m in mapping if m.get("required") and not m.get("matched")]
        if missing_required:
            names = ", ".join(m["name"] for m in missing_required[:10])
            issues.append({"field": "attributes", "message": f"missing required attributes: {names}"})

    # Content completeness with language verification
    content_score = 0.0
    title_ru = pipeline.generated_title_ru or ""
    desc_ru = pipeline.generated_description_ru or ""

    # Title: must exist AND be in Russian (Cyrillic)
    if title_ru:
        if _has_cyrillic(title_ru):
            content_score += 25.0
        else:
            content_score += 5.0  # partial credit: exists but wrong language
            issues.append({"field": "title", "message": "title is not in Russian (no Cyrillic characters detected)"})
    else:
        issues.append({"field": "title", "message": "Russian title not generated"})

    # Title should not contain Chinese
    if _has_chinese(title_ru):
        issues.append({"field": "title", "message": "title contains Chinese characters — must be Russian only"})
        content_score = max(0, content_score - 10.0)

    # Description: must exist AND be in Russian
    if desc_ru:
        if _has_cyrillic(desc_ru):
            content_score += 25.0
        else:
            content_score += 5.0
            issues.append({"field": "description", "message": "description is not in Russian"})
    else:
        issues.append({"field": "description", "message": "Russian description not generated"})

    if _has_chinese(desc_ru):
        issues.append({"field": "description", "message": "description contains Chinese characters — must be Russian only"})
        content_score = max(0, content_score - 10.0)

    # Specs
    if pipeline.generated_specs_json:
        specs = json.loads(pipeline.generated_specs_json)
        if specs:
            content_score += 25.0
        else:
            issues.append({"field": "specs", "message": "no specification data generated"})
    else:
        issues.append({"field": "specs", "message": "no specification data generated"})

    # Pricing
    if pipeline.pricing_json:
        content_score += 25.0
    else:
        issues.append({"field": "pricing", "message": "pricing not computed"})

    scores["content_completeness"] = content_score

    # Content verification flag
    if pipeline.content_verified is False:
        issues.append({"field": "content", "message": "content not AI-verified (dictionary fallback used) — manual Russian review required"})
    elif pipeline.content_verified is None:
        issues.append({"field": "content", "message": "content verification status unknown"})

    # Image/SKU compliance
    variant_data = json.loads(pipeline.variant_mapping_json) if pipeline.variant_mapping_json else {}
    media_count = variant_data.get("media_count", 0)
    sku_count = variant_data.get("sku_count", 0) or len(variant_data.get("variants", []))
    media_issues = check_media_compliance(media_count)
    for mi in media_issues:
        issues.append({"field": "media", "message": mi})
    scores["media_compliance"] = 100.0 if not media_issues else 50.0

    if sku_count == 0:
        issues.append({"field": "variants", "message": "no variants mapped"})
    scores["sku_completeness"] = 100.0 if sku_count > 0 else 0.0

    # Pricing profit check
    pricing_score = 100.0
    if pipeline.pricing_json:
        pricing = json.loads(pipeline.pricing_json)
        for pv in pricing.get("variants", []):
            if pv.get("error"):
                pricing_score = 0.0
                issues.append({"field": f"pricing.{pv['source_sku']}", "message": pv["error"]})
            elif pv.get("profit_rate", 0) < 0:
                pricing_score = 0.0
                issues.append({"field": f"pricing.{pv['source_sku']}", "message": "negative profit rate"})
    scores["pricing_health"] = pricing_score

    # Overall score
    overall = sum(scores.values()) / len(scores) if scores else 0.0
    pipeline.quality_score = Decimal(str(round(overall, 2)))
    pipeline.quality_issues_json = json.dumps(issues, ensure_ascii=False)
    pipeline.pipeline_stage = "quality_checked"
    db.commit()

    return {
        "overall_score": round(overall, 2),
        "scores": scores,
        "issues": issues,
        "issue_count": len(issues),
        "blocking": len(issues) > 0,
    }


def preview_payload(db, shop_id, source_product_id):
    """Generate a preview of the Ozon /v3/product/import payload (no write)."""
    from .publish_service import build_import_payload
    payload = build_import_payload(db, shop_id, source_product_id)
    return {
        "items": payload["items"],
        "preview_only": True,
        "note": "This is a local preview. No data has been sent to Ozon.",
    }
