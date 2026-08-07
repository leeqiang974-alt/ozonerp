"""Three-layer funnel auto-fill service for Ozon product attributes.

Layer 1: Hardcoded defaults (brand, country, model name, marking code)
Layer 2: Hard match - search Ozon dictionary with Chinese 1688 values
Layer 3: AI fallback - send dictionary options to AI for semantic matching
"""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy.orm import Session

from .listing_metadata_service import get_category_attributes, search_category_attribute_values
from .ai_service import suggest_attribute_value, _chat


# ── 1688 attribute name -> Ozon attribute name keywords mapping ──────────────
ATTR_MAPPING: dict[str, list[str]] = {
    "材质": ["材料", "материал"],
    "材料": ["材料", "материал"],
    "颜色": ["颜色", "цвет"],
    "产品颜色": ["颜色", "цвет"],
    "用途": ["用途", "назначение"],
    "适用场景": ["目标受众", "аудитория"],
    "适用人群": ["目标受众", "аудитория"],
    "风格": ["主题", "тема"],
    "形状": ["形状", "форма"],
}

# ── Attributes to skip entirely ──────────────────────────────────────────────
SKIP_COMPLEX_IDS = {"100001", "100002"}  # Video attributes
SKIP_NAME_KEYWORDS = ["视频", "видео", "PDF", "pdf", "组合成类似", "объединить в похожие"]


def _should_skip(attr: dict) -> bool:
    """Check if an attribute should be skipped (video, PDF, etc.)."""
    if attr.get("complex_id") in SKIP_COMPLEX_IDS:
        return True
    name = (attr.get("name") or "").lower()
    return any(kw.lower() in name for kw in SKIP_NAME_KEYWORDS)


def _is_hardcoded(attr: dict) -> dict | None:
    """Layer 1: Return hardcoded value if this attribute has a fixed default."""
    name = attr.get("name", "")
    name_lower = name.lower()
    attr_id = str(attr.get("id", ""))

    # 品牌 -> Нет бренда (dictionary search needed)
    if any(kw in name for kw in ["品牌", "Бренд", "бренд"]) or attr_id == "85":
        return {"value_text": "Нет бренда", "method": "hardcoded", "search_dict": True, "dict_query": "Нет бренда"}

    # 原产国 -> 中国 (dictionary search needed)
    if any(kw in name for kw in ["原产国", "Страна", "страна"]) or attr_id == "4389":
        return {"value_text": "中国", "method": "hardcoded", "search_dict": True, "dict_query": "中国"}

    # 型号名称 -> Offer ID (free text, filled by frontend)
    if any(kw in name for kw in ["型号名称", "Название модели"]) or attr_id == "9048":
        return {"value_text": None, "method": "hardcoded", "from_offer_id": True}

    # 卖家代码 -> Offer ID (free text)
    if any(kw in name for kw in ["卖家代码", "Артикул"]) and "модел" not in name_lower:
        return {"value_text": None, "method": "hardcoded", "from_offer_id": True}

    # 需要标记代码 -> false (Boolean)
    if any(kw in name for kw in ["标记代码", "код маркировки"]) or attr_id == "23536":
        return {"value_text": "false", "method": "hardcoded", "is_boolean": True}

    # #主题标签 -> AI generate (handled by frontend separately)
    if "#" in name or "主题标签" in name or "Хештеги" in name:
        return {"value_text": None, "method": "ai_generate_hashtags"}

    # JSON富内容 -> auto-generate (handled by frontend separately)
    if "JSON" in name or "富内容" in name or "rich" in name_lower:
        return {"value_text": None, "method": "skip_rich_content"}

    # 简介 -> AI generate description (handled by frontend separately)
    if name == "简介" or "Описание" in name and "JSON" not in name:
        return {"value_text": None, "method": "ai_generate_description"}

    # 名称 -> AI generate (handled by frontend separately)
    if name == "名称" or "Название" == name.strip():
        return {"value_text": None, "method": "ai_generate_name"}

    return None


def _find_1688_value(attr: dict, source_attrs: list[dict]) -> str | None:
    """Find a matching 1688 attribute value for an Ozon attribute."""
    ozon_name = attr.get("name", "")

    for src_name, ozon_keywords in ATTR_MAPPING.items():
        if any(kw in ozon_name for kw in ozon_keywords):
            for sa in source_attrs:
                sa_name = sa.get("name", "")
                if src_name in sa_name or sa_name in src_name:
                    return sa.get("value")

    # Also try direct name match
    for sa in source_attrs:
        sa_name = sa.get("name", "")
        if sa_name and sa_name in ozon_name:
            return sa.get("value")

    return None


def _extract_search_keywords(title: str, description: str = "", variant_specs: list[str] = None) -> list[str]:
    """Extract search keywords from title, description, and variant specs.
    Returns prioritized 2-4 char Chinese keywords for dictionary matching.
    Max 10 keywords to avoid excessive API calls.
    """
    import re as _re
    texts = [title, description]
    if variant_specs:
        texts.extend(variant_specs)
    combined = " ".join(t for t in texts if t)
    
    # Extract all Chinese character sequences
    chinese_seqs = _re.findall(r"[\u4e00-\u9fff]+", combined)
    
    # Generate 3-char and 2-char keywords from each sequence
    # Prioritize 3-char (more specific) over 2-char
    keywords_3 = []
    keywords_2 = []
    for seq in chinese_seqs:
        if len(seq) >= 4:
            keywords_3.append(seq[:4])
        if len(seq) >= 3:
            keywords_3.append(seq[:3])
        if len(seq) >= 2:
            keywords_2.append(seq[:2])
    
    # Deduplicate, 3-char first then 2-char, limit to 10 total
    seen = set()
    unique = []
    for k in keywords_3 + keywords_2:
        if k not in seen:
            seen.add(k)
            unique.append(k)
            if len(unique) >= 10:
                break
    return unique


def auto_fill_attributes(
    db: Session,
    shop_id: int,
    category_id: str,
    type_id: str,
    source_product: dict | None = None,
    offer_id: str = "",
) -> list[dict]:
    """Run the three-layer funnel and return fillable attribute values.

    Returns list of:
      {attribute_id, name, value_id, value_text, method, required}
    method is one of: hardcoded, hard_match, ai_match, manual, skip
    """
    # Get all Ozon attributes for the category
    attributes = get_category_attributes(db, shop_id, category_id, type_id)

    # Extract 1688 source data
    source_attrs = []
    source_title = ""
    source_desc = ""
    if source_product:
        raw = source_product.get("raw_json")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                raw = {}
        if isinstance(raw, dict):
            source_attrs = raw.get("attributes", [])
            source_title = source_product.get("title", "") or raw.get("title", "")
            source_desc = raw.get("source_description", "") or ""

    results = []
    for attr in attributes:
        attr_id = str(attr["id"])
        attr_name = attr.get("name", "")
        is_required = attr.get("required", False)
        dict_id = attr.get("dictionary_id", "")

        # Skip video, PDF, etc.
        if _should_skip(attr):
            results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": None, "method": "skip", "required": is_required})
            continue

        # Layer 1: Hardcoded defaults
        hardcoded = _is_hardcoded(attr)
        if hardcoded:
            if hardcoded.get("from_offer_id"):
                results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": offer_id, "method": "hardcoded", "required": is_required})
            elif hardcoded.get("search_dict"):
                # Search dictionary for the hardcoded value (e.g. "Нет бренда", "中国")
                try:
                    vals = search_category_attribute_values(db, shop_id, category_id, type_id, attr_id, hardcoded["dict_query"], limit=5)
                    if vals:
                        results.append({"attribute_id": attr_id, "name": attr_name, "value_id": vals[0]["id"], "value_text": vals[0]["value"], "method": "hardcoded", "required": is_required})
                    else:
                        results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": hardcoded["value_text"], "method": "hardcoded", "required": is_required})
                except Exception:
                    results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": hardcoded["value_text"], "method": "hardcoded", "required": is_required})
            elif hardcoded.get("is_boolean"):
                results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": "false", "method": "hardcoded", "required": is_required})
            elif hardcoded.get("method") in ("ai_generate_hashtags", "ai_generate_description", "ai_generate_name", "skip_rich_content"):
                results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": None, "method": hardcoded["method"], "required": is_required})
            else:
                results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": hardcoded.get("value_text"), "method": "hardcoded", "required": is_required})
            continue

        # Layer 2: Hard match - find 1688 value and search Ozon dictionary
        value_1688 = _find_1688_value(attr, source_attrs)

        # Special case: 类型 (required) - reverse match: get all dict values, check against product text
        if is_required and dict_id and not value_1688:
            if "类型" in attr_name or "Тип" in attr_name:
                combined_text = source_title + " " + source_desc
                if source_product and isinstance(source_product.get("raw_json"), dict):
                    for v in source_product["raw_json"].get("variants", []):
                        combined_text += " " + str(v.get("spec_name", ""))
                matched = False
                try:
                    all_type_vals = search_category_attribute_values(db, shop_id, category_id, type_id, attr_id, "", limit=50)
                    for v in all_type_vals:
                        vtext = v.get("value", "")
                        if not vtext:
                            continue
                        if vtext in combined_text:
                            results.append({"attribute_id": attr_id, "name": attr_name, "value_id": v["id"], "value_text": vtext, "method": "hard_match", "required": is_required})
                            matched = True
                            break
                        import re as _re2
                        zh_seqs = _re2.findall(r"[\u4e00-\u9fff]+", vtext)
                        for seq in zh_seqs:
                            cands = [seq]
                            if len(seq) > 3: cands.append(seq[:3])
                            if len(seq) > 2: cands.append(seq[:2])
                            if len(seq) > 3: cands.append(seq[-2:])
                            for cand in cands:
                                if len(cand) >= 2 and cand in combined_text:
                                    results.append({"attribute_id": attr_id, "name": attr_name, "value_id": v["id"], "value_text": vtext, "method": "hard_match", "required": is_required})
                                    matched = True
                                    break
                            if matched:
                                break
                        if matched:
                            break
                except Exception:
                    pass
                if not matched:
                    results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": None, "method": "manual", "required": is_required})
                continue

        # Layer 2: Hard match - search Ozon dictionary with 1688 value
        if value_1688 and dict_id:
            try:
                vals = search_category_attribute_values(db, shop_id, category_id, type_id, attr_id, value_1688, limit=5)
                if vals:
                    results.append({"attribute_id": attr_id, "name": attr_name, "value_id": vals[0]["id"], "value_text": vals[0]["value"], "method": "hard_match", "required": is_required})
                    continue
            except Exception:
                pass

            # Layer 3: AI fallback - get all dictionary options and let AI pick
            try:
                all_vals = search_category_attribute_values(db, shop_id, category_id, type_id, attr_id, "", limit=50)
                if all_vals:
                    ai_result = suggest_attribute_value(
                        attr_name, attr.get("description", ""),
                        source_title, source_desc,
                        dictionary_options=all_vals[:30],
                    )
                    vid = ai_result.get("value_id")
                    vtext = ai_result.get("value", "")
                    if vid and str(vid) != "None":
                        results.append({"attribute_id": attr_id, "name": attr_name, "value_id": str(vid), "value_text": vtext, "method": "ai_match", "required": is_required})
                        continue
                    elif vtext:
                        results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": vtext, "method": "ai_match", "required": is_required})
                        continue
            except Exception as e:
                import sys
                print(f"AI match failed for {attr_name}: {e}", file=sys.stderr)

            results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": None, "method": "manual", "required": is_required})
            continue

        # Free-text attributes with 1688 value but no dictionary
        if value_1688 and not dict_id:
            results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": value_1688, "method": "hard_match", "required": is_required})
            continue

        # 元件数量 - infer from SKU count
        if "元件数量" in attr_name or "Количество элементов" in attr_name:
            sku_count = len(source_product.get("variants", [])) if source_product else 0
            if sku_count:
                results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": str(sku_count), "method": "inferred", "required": is_required})
                continue

        # Everything else is manual
        results.append({"attribute_id": attr_id, "name": attr_name, "value_id": None, "value_text": None, "method": "manual", "required": is_required})

    return results
