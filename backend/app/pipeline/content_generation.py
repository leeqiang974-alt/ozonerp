from __future__ import annotations

import json
import re
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..erp_models import (
    OzonGlobalCategoryCacheRecord,
    PipelineProductRecord,
    SourceProductRecord,
    SourceVariantRecord,
)
from ..listing_cache_service import promote_legacy_listing_caches
from ..pricing import (
    CommissionSource,
    DimensionSource,
    PriceInput,
    PricingService,
    RiskCode,
)
from ..pricing_policy_service import domain_policy, get_pricing_policy
from .attribute_mapping import SYNONYM_TABLE
from ..ai_service import generate_description, translate_text

PRICING_RULE_VERSION = "2.0.0"

TITLE_MAX_LEN = 200
DESCRIPTION_MAX_LEN = 5000
_TECHNICAL_LATIN_TOKENS = {"usb", "led", "lcd", "oled", "3d", "4k", "hd", "hdmi", "wifi", "wi-fi", "type-c", "pvc", "abs", "pp", "eva", "pu"}
_CJK_TEXT_RE = re.compile(r"[\u4e00-\u9fff]")
_PROMPT_LEAK_TEXT_RE = re.compile(
    r"(?:我们需要|首先理解|规则[：:]|原(?:始)?标题|只返回|翻译成俄语|"
    r"let'?s\s+(?:analyze|translate)|as an ai)",
    re.IGNORECASE,
)


def _strip_supplier_brand_terms(text: str, source_brand: str = "") -> str:
    """Remove supplier/platform brand signals before they reach any LLM prompt.

    Source copy is evidence for product facts, not permission to advertise a
    brand. In addition to the structured brand field, strip platform Ozon and
    capitalised Latin proper names (for example ``Slipknot``), while keeping
    normal technical abbreviations such as USB or LED.
    """
    value = str(text or "")
    terms = {"ozon"}
    if source_brand:
        terms.add(source_brand.strip().lower())
    for token in re.findall(r"\b(?:[A-Z][a-z]{2,}|[A-Z]{2,})\b", value):
        if token.lower() not in _TECHNICAL_LATIN_TOKENS:
            terms.add(token.lower())
    for term in sorted((item for item in terms if len(item) >= 3), key=len, reverse=True):
        value = re.sub(rf"(?<!\w){re.escape(term)}(?!\w)", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"\s+", " ", value)
    return value.strip(" ,;:|-_")


def _remove_residual_chinese(text: str) -> str:
    """Enforce the Russian-only Ozon gate after any translator response."""
    import re
    cleaned = re.sub(r"[\u4e00-\u9fff]+", " ", text or "")
    return re.sub(r"[ \t]+", " ", cleaned).strip()


def _is_publishable_russian_text(
    text: str, *, minimum_cyrillic: int, single_line: bool = False,
) -> bool:
    """Return whether a generated field is safe to send to the Ozon gate.

    Removing Chinese characters is not enough: a failed LLM response can be a
    prompt fragment or mostly Latin text.  Keep this check intentionally small
    and factual so it can be used before persistence, rather than waiting for a
    later retry to discover a malformed response.
    """
    value = str(text or "").strip()
    if not value or _CJK_TEXT_RE.search(value) or _PROMPT_LEAK_TEXT_RE.search(value):
        return False
    if single_line and ("\n" in value or "\r" in value or "```" in value or "**" in value):
        return False
    letters = re.findall(r"[A-Za-zА-Яа-яЁё]", value)
    cyrillic = re.findall(r"[А-Яа-яЁё]", value)
    return len(cyrillic) >= minimum_cyrillic and len(cyrillic) / max(1, len(letters)) >= 0.55


def _safe_category_fallback(category_ru: str) -> tuple[str, str] | None:
    """Build minimal Russian content only when the AI provider returned junk.

    The fallback is constrained to the already-selected Ozon category title.
    It deliberately adds no brand, marketing wording or unsupported product
    features.  A category without a real Russian Ozon title remains blocked
    for review instead of being guessed.
    """
    raw_title = _clean(category_ru)
    if not _is_publishable_russian_text(raw_title, minimum_cyrillic=4):
        return None
    product_name = raw_title.rsplit("/", 1)[-1].strip(" -–—") or raw_title
    if not _is_publishable_russian_text(product_name, minimum_cyrillic=4):
        return None
    return product_name, f"{product_name}. Бижутерное украшение."


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



def _polish_ozon_title(title_ru: str, category_zh: str, material: str) -> dict | None:
    """检查俄文标题是否符合Ozon规范，不符合则重写。

    仅在以下情况重写：
    - 标题看起来是机器直译、语法不通顺
    - 包含无意义的字符或残词
    - 结构不符合Ozon商品标题规范

    规则：必须一次成型，不依赖后续修正。
    """
    if not title_ru or len(title_ru) < 5:
        return None

    try:
        result = generate_description(
            title=title_ru,
            source_description=f"任务：检查以下Ozon商品俄文标题是否符合规范。如果存在语法错误、无意义文字、不通顺的机器翻译、或不符合Ozon商品标题格式，请重写一个正确版本。如果已经合格，就原样返回。类目：{category_zh or '未知类目'}。材质：{material or ''}。原标题：{title_ru}。要求：1.俄语语法正确、通顺自然；2.包含商品核心关键词（类目名称、材质、核心特征）；3.不包含中文、无意义字符、机器翻译痕迹；4.长度50-120字符；5.格式：形容词特征+核心品类+材质+其他特征；6.不要营销广告语、不要оригинал原版等字样；7.绝不出现任何品牌、制造商、店铺、供应商或平台名称。只返回JSON格式：{{'needs_fix': true/false, 'reason': '问题简述', 'title': '修正后的标题'}}。",
            specs=[],
            target_lang="ru",
        )
        desc = result.get("description", "") if isinstance(result, dict) else str(result)
        m = re.search(r'\{[^{}]*"title"[^{}]*\}', desc, re.DOTALL)
        if m:
            import json as _json
            try:
                parsed = _json.loads(m.group())
                if parsed.get("needs_fix") and parsed.get("title"):
                    return {"title": parsed["title"], "reason": parsed.get("reason", "")}
            except (_json.JSONDecodeError, ValueError):
                pass
    except Exception:
        pass
    return None


def generate_content(db, shop_id, source_product_id):
    """Generate Russian title, description, specs and pricing (v2)."""
    promote_legacy_listing_caches(db)
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

    src_title = _strip_supplier_brand_terms(_clean(source.title), _clean(source.brand)) or "Product"
    material = _clean(source.material)

    # Get category title for context
    category_zh = ""
    category_ru = ""
    if pipeline.matched_category_id:
        category = db.scalar(select(OzonGlobalCategoryCacheRecord).where(
            OzonGlobalCategoryCacheRecord.category_id == pipeline.matched_category_id,
            OzonGlobalCategoryCacheRecord.type_id == (pipeline.matched_type_id or ""),
        ))
        if category:
            category_zh = _clean(category.title_zh) or _clean(category.title)
            category_ru = _clean(category.title)

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

    # Reuse the exact services used by the single-product editor. Batch mode
    # is orchestration only; it must not maintain a second prompt chain.
    title_result = translate_text(
        src_title,
        target_lang="ru",
        context=f"Ozon商品标题。类目：{category_zh or '未提供'}",
    )
    try:
        raw_source = json.loads(source.raw_json or "{}")
    except (TypeError, json.JSONDecodeError):
        raw_source = {}
    source_description = _strip_supplier_brand_terms(
        str(raw_source.get("source_description") or raw_source.get("description") or ""),
        _clean(source.brand),
    )
    description_result = generate_description(
        src_title,
        source_description=source_description,
        specs=specs,
        target_lang="ru",
    )
    title_ru = _remove_residual_chinese(title_result["translated"])[:TITLE_MAX_LEN]
    # 标题质量校验：如果翻译后语义不通顺/含无意义文字，调用AI按Ozon规范重写
    if title_ru and len(title_ru) >= 10:
        try:
            polish_result = _polish_ozon_title(title_ru, category_zh, material)
            if polish_result and polish_result.get("title"):
                title_ru = polish_result["title"][:TITLE_MAX_LEN]
        except Exception:
            pass  # 润色失败就用原文
    description_ru = _remove_residual_chinese(description_result["description"])[:DESCRIPTION_MAX_LEN]

    # The normal path remains one-shot AI generation.  This fallback is only
    # for provider corruption (Chinese reasoning/prompt leakage/non-Russian
    # output) and derives content solely from the selected Ozon category.
    fallback = _safe_category_fallback(category_ru)
    if fallback:
        fallback_title, fallback_description = fallback
        if not _is_publishable_russian_text(title_ru, minimum_cyrillic=4, single_line=True):
            title_ru = fallback_title
        if not _is_publishable_russian_text(description_ru, minimum_cyrillic=8):
            description_ru = fallback_description
    content_verified = (
        _is_publishable_russian_text(title_ru, minimum_cyrillic=4)
        and _is_publishable_russian_text(description_ru, minimum_cyrillic=8)
    )

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
        db, shop_id, source_product_id, variants,
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
        "translation_method": title_result["method"],
    }


def _compute_pricing(
    db, shop_id, source_product_id, variants,
    weight_g: Decimal | None = None,
    dims: tuple[Decimal, Decimal, Decimal] | None = None,
    dimension_source: DimensionSource = DimensionSource.DEFAULT_GUESS,
):
    """Compute CNY pricing for each variant using PricingService v2."""
    commission_source = CommissionSource.MANUAL_DEFAULT
    policy_record = get_pricing_policy(db)
    policy = domain_policy(policy_record, shop_id)
    service = PricingService()

    # Use provided weight/dimensions, or fall back to defaults
    w = weight_g or Decimal("500")
    l_mm = dims[0] if dims else Decimal("200")
    w_mm = dims[1] if dims else Decimal("150")
    h_mm = dims[2] if dims else Decimal("100")

    results = []
    for variant in variants:
        source_price = variant.price_cny or Decimal("10")
        purchase_cost = source_price + Decimal(policy_record.purchase_buffer_cny)
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
