"""Highest-priority Ozon card-content rules derived from seller guidance.

This module deliberately evaluates only human-facing text. Image/video pixels
are checked by the media gate; rich-content image URLs are not treated as
external advertising links.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True)
class ContentIssue:
    rule_id: str
    field: str
    message: str


_URL_OR_CONTACT = re.compile(
    r"(?:https?://|www\.|\b(?:vk\.com|t\.me|wa\.me)\b|"
    r"(?:\+?\d[\d\s().-]{8,}\d)|\b8[\s-]?800[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b)",
    re.IGNORECASE,
)
_SOCIAL_OR_PLATFORM = re.compile(
    r"\b(?:instagram|facebook|telegram|whatsapp|viber|wildberries|yandex\s*market|"
    r"aliexpress|amazon|avito|ozon)\b|(?:инстаграм|фейсбук|телеграм|вацап|вайбер|"
    r"вайлдберриз|яндекс\s*маркет|алиэкспресс|авито)",
    re.IGNORECASE,
)
_PROMOTION = re.compile(
    r"\b(?:скидк\w*|распродаж\w*|акци\w*|кэшбэк\w*|розыгрыш\w*|"
    r"купон\w*|промокод\w*|бесплатн\w*\s+доставк\w*|limited\s+offer)\b",
    re.IGNORECASE,
)
_LOGISTICS_OR_RETURNS = re.compile(
    r"\b(?:доставк\w*|самовывоз|срок\s+доставки|возврат\w*|обмен\w*|"
    r"курьер\w*|shipping|return\w*)\b",
    re.IGNORECASE,
)
_COUNTERFEIT = re.compile(
    r"\b(?:реплик\w*|копи\w*|подделк\w*|контрафакт\w*|1\s*[:/]\s*1|"
    r"оригинал\w*|original|aaa\s*(?:качест\w*|quality)|не\s*оригинал\w*)\b",
    re.IGNORECASE,
)
_RANDOM_STYLE = re.compile(
    r"\b(?:случайн\w*\s*(?:стиль|цвет|вариант)|рандом\w*|"
    r"невозможн\w*\s+выбрать\s+(?:цвет|стиль|вариант))\b",
    re.IGNORECASE,
)
_ADULT_TOBACCO = re.compile(
    r"\b(?:сигарет\w*|табак\w*|вейп\w*|кальян\w*|алкогол\w*|"
    r"эротик\w*|порн\w*|секс\w*|мат\w*)\b",
    re.IGNORECASE,
)
_EMOJI = re.compile("[\U0001F000-\U0001FAFF\U00002600-\U000027BF]")
_CYRILLIC = re.compile(r"[А-Яа-яЁё]")
_WORD = re.compile(r"[A-Za-zА-Яа-яЁё]+")


def _rich_text(value: str) -> Iterable[str]:
    """Yield text blocks from rich JSON, never image URLs."""
    try:
        node: Any = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        yield value
        return

    def walk(item: Any, key: str = "") -> Iterable[str]:
        if isinstance(item, dict):
            for child_key, child in item.items():
                yield from walk(child, str(child_key).lower())
        elif isinstance(item, list):
            for child in item:
                yield from walk(child, key)
        elif isinstance(item, str) and key not in {"url", "src", "image", "image_url"}:
            yield item

    yield from walk(node)


def _check_text(text: str, field: str, *, title: bool = False) -> list[ContentIssue]:
    value = str(text or "").strip()
    if not value:
        return []
    issues: list[ContentIssue] = []
    checks = (
        ("contact_or_external_link", _URL_OR_CONTACT, "商品卡不得包含联系方式、网站或站外沟通入口。"),
        ("social_or_marketplace_reference", _SOCIAL_OR_PLATFORM, "商品卡不得提及社交平台、其他商城或 Ozon 平台本身。"),
        ("promotion_or_competition", _PROMOTION, "商品卡不得包含折扣、促销、抽奖、返现等广告营销信息。"),
        ("logistics_or_returns", _LOGISTICS_OR_RETURNS, "商品卡不得包含配送、时效、退货或换货条件。"),
        ("counterfeit_or_originality_claim", _COUNTERFEIT, "商品卡不得出现仿制、1:1、原版/Original、AAA 等假货或真实性宣称。"),
        ("random_style_listing", _RANDOM_STYLE, "商品卡不得销售随机款式/随机颜色或声明无法选择变体。"),
        ("adult_tobacco_or_profanity", _ADULT_TOBACCO, "成人、烟酒烟草或脏话内容需按 Ozon 18+ / 禁售规则人工复核，当前禁止自动提交。"),
    )
    for rule_id, pattern, message in checks:
        if pattern.search(value):
            issues.append(ContentIssue(rule_id, field, message))
    if _EMOJI.search(value):
        issues.append(ContentIssue("emoji_or_pictogram", field, "商品名称和描述不得包含表情符号或象形文字。"))
    if title:
        if len(value) > 200:
            issues.append(ContentIssue("title_over_200", field, "商品名称不得超过 200 个字符。"))
        if any(len(word) > 27 for word in _WORD.findall(value)):
            issues.append(ContentIssue("title_word_over_27", field, "商品名称中不得有超过 27 个字符的词。"))
    return issues


def evaluate_draft_content(draft: Any) -> list[ContentIssue]:
    """Return deterministic, submission-blocking text violations for a draft."""
    issues = _check_text(getattr(draft, "title", ""), "title", title=True)
    issues += _check_text(getattr(draft, "description", ""), "description")
    for attribute in getattr(draft, "attribute_values", []) or []:
        value = str(getattr(attribute, "value_text", "") or "")
        field = f"attribute:{getattr(attribute, 'attribute_id', '')}"
        values = _rich_text(value) if str(getattr(attribute, "attribute_id", "")) == "11254" else [value]
        for fragment in values:
            issues += _check_text(fragment, field)
    # De-duplicate repeated matches caused by multiple rich-content blocks.
    return list(dict.fromkeys(issues))
