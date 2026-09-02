"""
Ozon 上架质量预检 + 自动修复服务

批量提交前自动检查已知 Ozon 错误类型，
命中可自动修复的直接改草稿，命中不可自动修的记录到错误日志。

规则来源: ozon_error_patterns 表
修复动作:
  - clean_original_words: 清理标题/描述/简介/富内容中的 "原版/оригинал" 字样
  - clean_marketing_tags: 清理主题标签中的营销/广告语/礼物相关词
  - clean_brand_hashtags: 清理主题标签中疑似品牌词
  - rewrite_title_if_nonsense: 标题无意义/语法错误时重新生成
  - dedupe_variant_colors: 变体颜色与同店其他商品撞车时差异化
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .ai_service import sanitize_hashtags
from .erp_models import (
    AuditEventRecord,
    ListingDraftRecord,
    SourceProductRecord,
)


# ── 修复动作实现 ────────────────────────────────────────────────

def _clean_original_words(draft: ListingDraftRecord) -> list[str]:
    """清理所有文本字段中的 оригинал/原版 相关词。"""
    fixed_fields = []
    pattern = re.compile(r"[Оо]ригинальн[а-я]*[.,]?\s*")

    # 标题
    if draft.title and pattern.search(draft.title):
        new_title = pattern.sub("", draft.title).strip()
        new_title = re.sub(r"\s+", " ", new_title)
        new_title = re.sub(r",\s*,", ",", new_title)
        new_title = re.sub(r"^,\s*", "", new_title)
        if new_title and new_title != draft.title:
            draft.title = new_title
            fixed_fields.append("title")

    # 描述
    if draft.description and pattern.search(draft.description):
        new_desc = pattern.sub("", draft.description)
        # 句首大写
        if new_desc and new_desc[0].islower():
            new_desc = new_desc[0].upper() + new_desc[1:]
        draft.description = new_desc
        fixed_fields.append("description")

    # 属性
    for attr in draft.attribute_values:
        if str(attr.attribute_id) == "4191" and attr.value_text and pattern.search(attr.value_text):
            new_val = pattern.sub("", attr.value_text)
            if new_val and new_val[0].islower():
                new_val = new_val[0].upper() + new_val[1:]
            attr.value_text = new_val
            fixed_fields.append("attr_4191")

        elif str(attr.attribute_id) == "11254" and attr.value_text and pattern.search(attr.value_text):
            try:
                fc = json.loads(attr.value_text)
                changed = False
                for block in fc.get("content", []):
                    if block.get("type") == "text":
                        for b in block.get("blocks", []):
                            text = b.get("text", "")
                            if text and pattern.search(text):
                                b["text"] = pattern.sub("", text)
                                changed = True
                if changed:
                    attr.value_text = json.dumps(fc, ensure_ascii=False)
                    fixed_fields.append("attr_11254")
            except (json.JSONDecodeError, TypeError):
                pass

        elif str(attr.attribute_id) == "23171" and attr.value_text:
            tags = attr.value_text.split()
            new_tags = [t for t in tags if not pattern.search(t)]
            if len(new_tags) != len(tags):
                attr.value_text = " ".join(new_tags)
                fixed_fields.append("tags_23171")

    return fixed_fields


def _clean_marketing_tags(draft: ListingDraftRecord) -> list[str]:
    """强制清理主题标签：单项≤30字符、俄文格式、无营销/批发词。"""
    for attr in draft.attribute_values:
        if str(attr.attribute_id) != "23171":
            continue
        if not attr.value_text:
            continue
        cleaned = " ".join(sanitize_hashtags(attr.value_text, max_count=30))
        if cleaned != attr.value_text:
            attr.value_text = cleaned
            return ["tags_23171_normalized"]
    return []


def _clean_advertising_title(draft: ListingDraftRecord) -> list[str]:
    """Remove retail/wholesale/claim language Ozon rejects in the product name."""
    if not draft.title:
        return []
    marketing = re.compile(
        r"\b(?:модн\w*|стильн\w*|популярн\w*|эксклюзивн\w*|премиальн\w*|"
        r"выгодн\w*|лучши\w*|дешев\w*|новинк\w*|хит\w*|оптом|в\s+розницу|"
        r"акци\w*|распродаж\w*|скидк\w*|рекламн\w*|продаж\w*|покупк\w*|"
        r"закаж\w*|подарочн\w*|идеальн\w*|уникальн\w*|универсальн\w*|"
        r"креативн\w*|вдохновляющ\w*|мотивирующ\w*|оригинальн\w*|"
        r"надёжн\w*|компактн\w*|лёгк\w*|ярк\w*|позитивн\w*|весёл\w*|забавн\w*)\b",
        re.IGNORECASE,
    )
    title = marketing.sub("", draft.title)
    title = re.sub(r"\s+", " ", title)
    title = re.sub(r"\s*,\s*,+", ", ", title)
    title = re.sub(r"(?:^|,)\s*(?:и|для)?\s*,", ",", title)
    title = title.strip(" ,;:-")
    if title:
        title = title[0].upper() + title[1:]
    if title and title != draft.title:
        draft.title = title
        return ["title"]
    return []


def _clean_title_special_symbols(draft: ListingDraftRecord) -> list[str]:
    """Make a title safe for Ozon's ``many special characters`` moderation.

    Keep letters, digits, spaces, commas and a single ordinary hyphen only.
    Supplier pages and failed model prompts sometimes leak CJK punctuation,
    markdown, slash-separated alternatives and repeated separators into the
    Russian title; those are not product facts and Ozon rejects the card.
    """
    if not draft.title:
        return []
    original = draft.title
    title = re.sub(r"[^0-9A-Za-zА-Яа-яЁё\s,\-]", " ", original)
    title = re.sub(r"\s*[,\-]\s*[,\-]+\s*", " ", title)
    title = re.sub(r"\s+", " ", title)
    title = re.sub(r"\s*,\s*", ", ", title).strip(" ,-")
    if title and title != original:
        draft.title = title[:255]
        return ["title"]
    return []


def _title_quality_issues(title: str) -> list[str]:
    """Return submission-blocking title defects after automatic cleaning."""
    value = str(title or "").strip()
    issues: list[str] = []
    if not value:
        return ["标题为空"]
    if len(value) > 255:
        issues.append("标题超过 Ozon 255 字符限制")
    if re.search(r"[\u4e00-\u9fff]", value) or re.search(r"(?:我们需要|首先理解|规则[：:]|只返回|翻译成俄语|let'?s\s+(?:analyze|translate))", value, re.I):
        issues.append("标题包含 AI 提示词或非俄文内容")
    letters = re.findall(r"[A-Za-zА-Яа-яЁё]", value)
    cyrillic = re.findall(r"[А-Яа-яЁё]", value)
    if len(cyrillic) < 4 or len(cyrillic) / max(1, len(letters)) < 0.55:
        issues.append("标题不是可发布的俄文商品名称")
    words = re.findall(r"[А-Яа-яЁёA-Za-z]+", value.lower())
    ignored = {"для", "и", "с", "в", "на", "по", "из", "без"}
    repeated = sorted({word for word in words if len(word) > 2 and word not in ignored and words.count(word) > 1})
    if repeated:
        issues.append("标题有重复词：" + ", ".join(repeated[:5]))
    return issues


_PROHIBITED_LGBT_SYMBOL_RE = re.compile(
    r"(?:\b(?:lgbtq?\+?|lgbt|pride|trans(?:gender)?|trans\s+rights|"
    r"gay\s+rights|lesbian|non[-\s]?binary)\b|"
    r"лгбт|прайд|транс(?:гендер|\s+прав|\b)|"
    r"(?:rainbow|радужн\w*|彩虹)\s*(?:flag|pride|rights|флаг|прайд|旗)|"
    r"(?:lgbt|pride|trans|跨性别|性少数|非二元)\s*(?:rainbow|радужн\w*|彩虹|旗|flag)|"
    r"跨性别|性少数|非二元)",
    re.IGNORECASE,
)


def _prohibited_lgbt_symbol_issues(draft: ListingDraftRecord) -> list[dict[str, str]]:
    """Hard-stop platform-prohibited LGBT/political-symbol promotion on every text surface.

    This does not attempt to rewrite a prohibited product into a different
    product. A match requires manual removal/archive because images may carry
    the same symbol even when text is later edited.
    """
    surfaces: list[tuple[str, str]] = [
        ("title", draft.title or ""),
        ("description", draft.description or ""),
    ]
    for attribute in draft.attribute_values:
        if attribute.value_text:
            surfaces.append((f"attribute:{attribute.attribute_id}", attribute.value_text))
    findings: list[dict[str, str]] = []
    for field, value in surfaces:
        match = _PROHIBITED_LGBT_SYMBOL_RE.search(str(value))
        if match:
            findings.append({
                "error_code": "prohibited_lgbt_symbolism",
                "error_field": field,
                "description": f"命中平台禁止的 LGBT/非传统性别关系宣传线索：{match.group(0)}；必须移除对应内容和图片，已创建商品须归档",
            })
    return findings


def _source_content_policy_issues(db: Session, draft: ListingDraftRecord) -> list[dict[str, str]]:
    """Keep a confirmed image-policy finding effective for legacy drafts too."""
    if not draft.source_product_id:
        return []
    source = db.get(SourceProductRecord, draft.source_product_id)
    if source and source.ingestion_status == "content_policy_blocked":
        return [{
            "error_code": "source_content_policy_blocked",
            "error_field": "source_media",
            "description": "该货源已被标记为 Ozon 内容政策风险（图片/内容宣传）；必须更换全部风险素材并人工解除封禁后才能提交。",
        }]
    return []


def _clean_vulgar_text(draft: ListingDraftRecord) -> list[str]:
    """清理文本字段中的粗俗/冒犯词汇。"""
    fixed = []
    vulgar_pairs = [
        (re.compile(r"\bFake Ass Friend\b", re.IGNORECASE), "юмористической надписью"),
        (re.compile(r"\bfake ass\b", re.IGNORECASE), ""),
    ]

    def _clean_text(text: str) -> str | None:
        if not text:
            return None
        new_text = text
        changed = False
        for pat, repl in vulgar_pairs:
            if pat.search(new_text):
                new_text = pat.sub(repl, new_text)
                changed = True
        return new_text if changed else None

    # 标题
    nt = _clean_text(draft.title)
    if nt:
        draft.title = nt
        fixed.append("title")

    # 描述
    nd = _clean_text(draft.description)
    if nd:
        draft.description = nd
        fixed.append("description")

    # 属性
    for attr in draft.attribute_values:
        if str(attr.attribute_id) == "4191":
            nv = _clean_text(attr.value_text or "")
            if nv:
                attr.value_text = nv
                fixed.append("attr_4191")
        elif str(attr.attribute_id) == "11254" and attr.value_text:
            try:
                fc = json.loads(attr.value_text)
                changed = False
                for block in fc.get("content", []):
                    if block.get("type") == "text":
                        for b in block.get("blocks", []):
                            text = b.get("text", "")
                            nt = _clean_text(text)
                            if nt:
                                b["text"] = nt
                                changed = True
                if changed:
                    attr.value_text = json.dumps(fc, ensure_ascii=False)
                    fixed.append("attr_11254")
            except (json.JSONDecodeError, TypeError):
                pass
        elif str(attr.attribute_id) == "23171" and attr.value_text:
            tags = attr.value_text.split()
            bad = ["fake", "ass", "fuck", "shit", "bitch"]
            new_tags = [t for t in tags if not any(b in t.lower() for b in bad)]
            if len(new_tags) != len(tags):
                attr.value_text = " ".join(new_tags)
                fixed.append("tags_23171")

    return fixed


def _clean_brand_hashtags(draft: ListingDraftRecord) -> list[str]:
    """过滤主题标签中疑似品牌词（保守做法：移除非常见的专有名词）。"""
    for attr in draft.attribute_values:
        if str(attr.attribute_id) != "23171":
            continue
        if not attr.value_text:
            continue
        tags = attr.value_text.split()
        # 保守策略：只保留商品相关词（颜色/形状/材质/场景/风格类）
        # 移除明显是品牌名的标签（以大写字母开头+人名/地名/品牌后缀）
        safe_suffixes = [
            "брошь", "булавка", "значок", "аксессуар", "украшение",
            "металлический", "пластиковый", "эмалированный",
            "цвет", "дизайн", "стиль", "форма", "тема",
            "летний", "курортный", "повседневный", "вечерний",
            "модный", "стильный", "забавный", "оригинальный",
            "декор", "одежда", "рюкзак", "куртка", "джинсовка", "сумка",
            "мультяшный", "животные", "растения", "еда", "наука",
        ]

        def _is_safe(tag: str) -> bool:
            t = tag.lstrip("#").lower().replace("_", " ")
            for sf in safe_suffixes:
                if sf in t:
                    return True
            return False

        new_tags = [t for t in tags if _is_safe(t)]
        # 确保至少10个标签，太少就放宽
        if len(new_tags) < 10:
            return []
        if len(new_tags) != len(tags):
            attr.value_text = " ".join(new_tags)
            return ["tags_23171_brands"]
    return []


def _brand_terms_for_draft(db: Session, draft: ListingDraftRecord) -> set[str]:
    """Return source-derived forbidden terms for product-facing text.

    Product cards never need to state a brand. ``Ozon`` is always prohibited;
    the structured source brand and capitalised Latin proper tokens found in
    the supplier title are also treated as forbidden. Technical abbreviations
    are deliberately excluded so normal facts such as USB/LED survive.
    """
    terms = {"ozon"}
    source = db.get(SourceProductRecord, draft.source_product_id) if draft.source_product_id else None
    if source is None:
        return terms
    if source.brand:
        terms.add(str(source.brand).strip().lower())
    technical = {"usb", "led", "lcd", "oled", "3d", "4k", "hd", "hdmi", "wifi", "wi-fi", "type-c", "pvc", "abs", "pp", "eva", "pu"}
    for token in re.findall(r"\b(?:[A-Z][a-z]{2,}|[A-Z]{2,})\b", str(source.title or "")):
        if token.lower() not in technical:
            terms.add(token.lower())
    return {term for term in terms if len(term) >= 3}


def _remove_brand_terms(text: str, terms: set[str]) -> str:
    value = str(text or "")
    for term in sorted(terms, key=len, reverse=True):
        value = re.sub(rf"(?<!\w){re.escape(term)}(?!\w)", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"\b(?:бренд|brand)\s*[:：-]?\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"\s*([,.;:])\s*", r"\1 ", value)
    return value.strip(" ,.;:-")


def _clean_brand_references(db: Session, draft: ListingDraftRecord) -> list[str]:
    """Remove brand/platform references from all four product text surfaces."""
    terms = _brand_terms_for_draft(db, draft)
    fixed: list[str] = []

    if draft.title:
        cleaned = _remove_brand_terms(draft.title, terms)
        if cleaned and cleaned != draft.title:
            draft.title = cleaned
            fixed.append("title")
    if draft.description:
        cleaned = _remove_brand_terms(draft.description, terms)
        if cleaned != draft.description:
            draft.description = cleaned
            fixed.append("description")

    def _clean_json(value: Any) -> tuple[Any, bool]:
        if isinstance(value, str):
            cleaned = _remove_brand_terms(value, terms)
            return cleaned, cleaned != value
        if isinstance(value, list):
            changed = False
            result = []
            for item in value:
                clean_item, item_changed = _clean_json(item)
                result.append(clean_item)
                changed = changed or item_changed
            return result, changed
        if isinstance(value, dict):
            changed = False
            result = {}
            for key, item in value.items():
                clean_item, item_changed = _clean_json(item)
                result[key] = clean_item
                changed = changed or item_changed
            return result, changed
        return value, False

    for attr in draft.attribute_values:
        attr_id = str(attr.attribute_id)
        if attr_id == "4191" and attr.value_text:
            cleaned = _remove_brand_terms(attr.value_text, terms)
            if cleaned != attr.value_text:
                attr.value_text = cleaned
                fixed.append("attr_4191")
        elif attr_id == "23171" and attr.value_text:
            # Tags remain a readable space-separated line locally; payload
            # conversion later sends it as the one Ozon attribute value.
            cleaned = " ".join(tag for tag in attr.value_text.split() if _remove_brand_terms(tag, terms) == tag)
            cleaned = " ".join(sanitize_hashtags(cleaned, max_count=30))
            if cleaned != attr.value_text:
                attr.value_text = cleaned
                fixed.append("tags_23171")
        elif attr_id == "11254" and attr.value_text:
            try:
                payload = json.loads(attr.value_text)
                cleaned_payload, changed = _clean_json(payload)
                if changed:
                    attr.value_text = json.dumps(cleaned_payload, ensure_ascii=False)
                    fixed.append("attr_11254")
            except (json.JSONDecodeError, TypeError):
                # A malformed rich-content value is handled by its existing
                # validator; do not silently corrupt it here.
                pass
    return fixed


# ── 动作映射 ──────────────────────────────────────────────────

_FIX_ACTIONS = {
    "clean_original_words": _clean_original_words,
    "clean_marketing_tags": _clean_marketing_tags,
    "clean_advertising_title": _clean_advertising_title,
    "clean_title_special_symbols": _clean_title_special_symbols,
    "clean_vulgar_text": _clean_vulgar_text,
    "clean_brand_hashtags": _clean_brand_hashtags,
}


# ── 主入口 ────────────────────────────────────────────────────

def run_quality_preflight(
    db: Session,
    draft: ListingDraftRecord,
    *,
    batch_id: int | None = None,
    auto_fix: bool = True,
) -> dict[str, Any]:
    """
    对草稿做 Ozon 质量预检。

    步骤:
    1. 按已知错误模式检查草稿
    2. 可自动修复的直接修改草稿
    3. 写入错误日志
    返回: {"fixed": bool, "issues_fixed": [...], "issues_remaining": [...]}
    """
    # 加载模式表中所有可自动修复的规则
    # Historical local databases can lack this optional feedback table after
    # a migration.  Submission invariants below must still run; use a
    # savepoint so a missing table never aborts the draft transaction.
    try:
        with db.begin_nested():
            patterns = db.execute(text(
                "SELECT * FROM ozon_error_patterns WHERE auto_fixable = 1"
            )).fetchall()
    except SQLAlchemyError:
        patterns = []

    issues_fixed: list[dict] = []
    issues_remaining: list[dict] = []
    any_fixed = False

    # These two controls are submission invariants, not merely historical
    # feedback matches.  The generator may still produce a non-compliant tag
    # or a wholesale adjective, so run them for every draft before import.
    if auto_fix:
        for error_code, error_field, fix_func in (
            ("BR_attribute_advertising", "title", _clean_advertising_title),
            ("DESCRIPTION_DECLINE", "title", _clean_title_special_symbols),
            ("BR_hashtags_symbols_limit", "23171", _clean_marketing_tags),
        ):
            fixed_fields = fix_func(draft)
            if fixed_fields:
                any_fixed = True
                issues_fixed.append({
                    "error_code": error_code,
                    "error_field": error_field,
                    "action": fix_func.__name__.lstrip("_"),
                    "fields": fixed_fields,
                })

        brand_fields = _clean_brand_references(db, draft)
        if brand_fields:
            any_fixed = True
            issues_fixed.append({
                "error_code": "brand_reference_forbidden",
                "error_field": "product_content",
                "action": "clean_brand_references",
                "fields": brand_fields,
            })

        # 按历史 Ozon 回执中的确定性规则做自动修复。
        for pat in patterns:
            action_name = pat.fix_action
            if not action_name or action_name not in _FIX_ACTIONS:
                continue
            fix_func = _FIX_ACTIONS[action_name]
            fixed_fields = fix_func(draft)
            if fixed_fields:
                any_fixed = True
                issues_fixed.append({
                    "error_code": pat.error_code,
                    "error_field": pat.error_field,
                    "action": action_name,
                    "fields": fixed_fields,
                })

    # All automatic repairs above must be followed by the same non-mutating
    # validation used as the submission gate.  This is deliberately last so a
    # removed brand/marketing term cannot leave a stale false-positive issue.
    for issue in _title_quality_issues(draft.title or ""):
        issues_remaining.append({
            "error_code": "title_quality_invalid",
            "error_field": "title",
            "description": issue,
        })

    # Platform moderation forbids this product category outright. It is a
    # hard stop, not an auto-fix: changing only text cannot make symbolic
    # imagery safe, so the operator must remove/replace all related media or
    # archive an already-created product.
    issues_remaining.extend(_prohibited_lgbt_symbol_issues(draft))
    issues_remaining.extend(_source_content_policy_issues(db, draft))

    # 2. 如果有修改，保存草稿更新时间
    if any_fixed:
        draft.updated_at = datetime.utcnow()

    # 20–30 relevant tags is a quality target, not a hard publishing gate.
    # Never pad a short set with invented marketing words, but do not strand a
    # valid card solely because AI returned 19 rather than 20 tags.
    for attr in draft.attribute_values:
        if str(attr.attribute_id) != "23171":
            continue
        tag_count=len(sanitize_hashtags(attr.value_text or "", max_count=30))
        if tag_count == 0:
            issues_remaining.append({
                "error_code":"hashtag_empty",
                "error_field":"23171",
                "description":"未保留任何有效俄文主题标签；需重新生成",
            })
        break

    return {
        "fixed": any_fixed,
        "issues_fixed": issues_fixed,
        "issues_remaining": issues_remaining,
        "fixable_count": len(issues_fixed),
    }


def record_preflight_results(
    db: Session,
    draft: ListingDraftRecord,
    preflight_result: dict,
    *,
    batch_id: int | None = None,
) -> None:
    """把预检结果写入审计日志。"""
    if not preflight_result["fixed"]:
        return
    db.add(AuditEventRecord(
        shop_id=draft.shop_id,
        actor_id="system",
        action="bulk_preflight_auto_fixed",
        entity_type="listing_draft",
        entity_id=str(draft.id),
        details_json=json.dumps(preflight_result, ensure_ascii=False),
    ))
