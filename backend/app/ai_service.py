"""Configurable LLM service for listing-editor text generation.

Provides per-field AI assistance: text translation (zh->ru), attribute value
suggestion, and rich content JSON generation.  Uses the OpenAI-compatible
DeepSeek API via httpx; no external SDK dependency required.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx
from dotenv import load_dotenv

from .llm_provider import get_listing_llm_failover_configs, get_listing_llm_config, get_listing_llm_provider

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env"), override=True)


def _config() -> tuple[str, str, str]:
    """Return the configured listing-text LLM without exposing its key."""
    return get_listing_llm_config()


def _chat(messages: list[dict[str, str]], *, temperature: float = 0.3, max_tokens: int = 4096) -> tuple[str, str, str]:
    """Call the chat-completions endpoint and return ``(text, provider, model)``.

    Providers are tried in failover order (agnes -> volcengine -> deepseek).
    A 4xx/5xx, timeout or empty reply on one provider moves to the next, so a
    single account going 402/500 never stalls the whole batch.
    """
    configs = get_listing_llm_failover_configs()
    if not configs:
        raise RuntimeError("LLM_API_KEY 未配置，无法使用 AI 功能")
    last_err: Exception | None = None
    for cfg in configs:
        api_key, base_url, model = cfg["api_key"], cfg["base_url"], cfg["model"]
        if not api_key or not base_url:
            continue
        url = f"{base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
        if cfg["provider"] == "volcengine":
            payload["thinking"] = {"type": "disabled"}
        try:
            resp = httpx.post(url, headers=headers, json=payload, timeout=60.0)
            if resp.status_code >= 400:
                # If thinking param is rejected, retry without it
                if resp.status_code == 400 and "thinking" in resp.text.lower():
                    payload.pop("thinking", None)
                    resp = httpx.post(url, headers=headers, json=payload, timeout=60.0)
                if resp.status_code >= 400:
                    last_err = RuntimeError(f"LLM API 返回 {resp.status_code}: {resp.text[:500]}")
                    continue
            body = resp.json()
            msg = body["choices"][0]["message"]
            text = msg.get("content") or ""
            if not text.strip():
                # Reasoning models (deepseek-v4, glm-5.2) put output in reasoning_content
                text = msg.get("reasoning_content") or ""
            if text.strip():
                return text.strip(), cfg["provider"], model
            last_err = RuntimeError("LLM 返回空内容")
        except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
            last_err = exc
            continue
    if last_err is None:
        last_err = RuntimeError("所有 LLM Provider 均未返回结果")
    raise last_err


_RUSSIAN_HASHTAG_RE = re.compile(r"^#[А-Яа-яЁё]+(?:_[А-Яа-яЁё]+)?$")
_MARKETING_HASHTAG_STEMS = (
    "оптом", "розниц", "дропшип", "подарок", "акци", "распродаж", "скидк",
    "бесплатн", "лучш", "дешев", "выгодн", "хит", "промо", "новинк",
    "сезон", "модн", "стильн", "эксклюзив", "премиум", "реклам",
    "прода", "универс", "креатив", "вдохнов", "мотивир", "оригинал",
    "надёжн", "надежн", "компакт", "лёгк", "легк", "ярк", "позитив",
    "весёл", "весел", "забав", "дизайнер", "стил",
)


def sanitize_hashtags(value: str, max_count: int = 30) -> list[str]:
    """Return Ozon-safe Russian hashtags without enforcing an artificial minimum.

    Ozon limits a *single tag* to 30 characters.  The LLM instruction alone is
    not a validation boundary, so this helper is also used by the preflight for
    historical drafts before an import is allowed.
    """
    tags: list[str] = []
    seen: set[str] = set()
    for raw in str(value or "").split():
        tag = raw.strip(".,;:!?，。；：！")
        normalized = tag.lower()
        if (
            not _RUSSIAN_HASHTAG_RE.fullmatch(tag)
            or len(tag) > 30
            or any(stem in normalized.lstrip("#") for stem in _MARKETING_HASHTAG_STEMS)
            or normalized in seen
        ):
            continue
        seen.add(normalized)
        tags.append(tag)
        if len(tags) >= max_count:
            break
    return tags


def normalize_hashtags(value: str, min_count: int = 1, max_count: int = 30) -> list[str]:
    """Normalize valid Ozon hashtags without turning a short AI answer into a failed job."""
    tags = sanitize_hashtags(value, max_count=max_count)
    if len(tags) < min_count:
        raise RuntimeError("AI未返回任何可用的俄文主题标签")
    return tags


def generate_product_hashtags(title: str, description: str = "", category_zh: str = "") -> str:
    """Shared hashtag generator used by both the editor and batch listings.

    Target 30 because more relevant search tags are useful, but Ozon enforces an
    upper bound rather than an exact count, so 20-30 valid tags are acceptable.
    """
    prompt = f"""Generate 30 Russian search hashtags for an Ozon product.

Product title: {title}
Description: {description[:500]}
Category: {category_zh}

Rules (STRICT - Ozon will reject non-compliant tags):
- Target 30 unique hashtags; if you cannot find 30 strong tags, return 20-30
- Each hashtag starts with #
- Each hashtag is 1-2 Russian words only (use underscore for 2 words)
- Space-separated, all on one line
- Use only facts relevant to this individual product
- NO Chinese, brand/manufacturer/supplier/shop/platform names (including Ozon), numbers or marketing words
- Each tag max 30 characters including #
- Return ONLY the hashtags line, nothing else"""
    # 20–30 is a content-quality target, not an Ozon submission gate.  Ask a
    # second time when the first response is short; if it remains short but is
    # otherwise valid, keep it and let the product proceed.  Previously 19
    # valid tags turned an entire batch row into a hard failure.
    best: list[str] = []
    for _attempt in range(2):
        value, _p, _m = _chat([{"role": "user", "content": prompt}], temperature=0.7, max_tokens=4096)
        tags = normalize_hashtags(value, min_count=1)
        if len(tags) > len(best):
            best = tags
        if len(tags) >= 20:
            return " ".join(tags)
    return " ".join(best)


def _extract_json(text: str) -> dict[str, Any]:
    """Strip markdown fences and parse JSON from LLM output."""
    cleaned = re.sub(r"^```(?:json)?\s*", "", text)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned)


# Ozon moderation rejects assortment/colour-choice promises. These are not
# product facts and must never leak from supplier copy into generated content.
_OZON_ASSORTMENT_CLAIM = re.compile(
    r"(?im)^.*(?:в ассортименте|по заказу|уточняйте при заказе|случайн(?:ый|ая|ые)|"
    r"随机|混款|混色|按订单确认颜色|颜色随机).*$"
)


def _strip_ozon_assortment_claims(text: str) -> str:
    cleaned = str(text or "")
    # Replace inline claims first so a one-line title is not erased wholesale.
    cleaned = re.sub(
        r"(?i)(в ассортименте|по заказу|уточняйте при заказе|случайн(?:ый|ая|ые)|"
        r"随机发货|随机|混款|混色|按订单确认颜色|颜色随机)",
        "",
        cleaned,
    )
    cleaned = _OZON_ASSORTMENT_CLAIM.sub("", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #


def translate_text(
    text: str,
    *,
    target_lang: str = "ru",
    context: str = "",
) -> dict[str, Any]:
    """Translate a single text snippet.  Returns {translated, lang, method}."""
    _api_key, _, _model = _config()
    if not _api_key and not get_listing_llm_failover_configs():
        raise RuntimeError("LLM_API_KEY 未配置")
    lang_name = {"ru": "俄语", "en": "英语", "zh": "中文"}.get(target_lang, target_lang)
    ctx = f"\n上下文信息：{context}" if context else ""
    # Enhanced prompt: avoid word repetition, optimize for e-commerce SEO
    is_title = "标题" in ctx or "title" in ctx.lower() or len(text) < 100
    if is_title:
        sys_prompt = (
            f"你是Ozon电商平台的专业商品标题翻译专家。将中文商品标题翻译为{lang_name}。\n"
            f"规则：\n"
            f"1. 去掉供应商/厂家名称前缀（如「亿兴」「华美」等），从产品本身开始翻译\n"
            f"2. 避免重复词汇：同一个词不要在标题中出现两次（如不要重复「силикон」「форма」等）\n"
            f"3. 推荐格式：产品类型+核心特征+材质+用途，简洁明了\n"
            f"4. 不要逐字翻译堆砌关键词，要组织成通顺的短语\n"
            f"5. 只返回翻译结果，不要加解释或引号\n"
            "6. 绝不保留、翻译、猜测或提及货源中的任何品牌、厂家、店铺、供应商、平台名称（包括 Ozon）。\n"
            "7. 禁止写随机发货、混款/混色、颜色按订单确认、可任选颜色，"
            "也禁止写俄语 в ассортименте、случайный、уточняйте при заказе。"
            "若 SKU 已区分颜色/数量，只陈述每个 SKU 已明确的事实，不承诺组合商品。"
        )
    else:
        sys_prompt = f"你是专业电商翻译。将用户提供的文本翻译为{lang_name}，只返回翻译结果，不要加任何解释或引号。避免重复词汇。"
    messages = [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": f"{text}{ctx}"},
    ]
    result, provider, model = _chat(messages, temperature=0.2, max_tokens=2048)
    return {"translated": _strip_ozon_assortment_claims(result), "lang": target_lang, "method": provider, "model": model}


def suggest_attribute_value(
    attribute_name: str,
    attribute_description: str,
    product_title: str,
    product_description: str,
    *,
    dictionary_options: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Suggest a value for an Ozon attribute based on product info.

    If dictionary_options is provided, the AI will pick the best matching
    option from the list and return its id + value.
    """
    _api_key, _, _model = _config()
    if not _api_key and not get_listing_llm_failover_configs():
        raise RuntimeError("LLM_API_KEY 未配置")

    dict_hint = ""
    if dictionary_options:
        opts = "\n".join(f"  - id={o.get('id','')}, value={o.get('value','')}" for o in dictionary_options[:30])
        dict_hint = f"\n\n该属性是字典型属性，可选值列表（请从中选择最匹配的）：\n{opts}"

    messages = [
        {
            "role": "system",
            "content": (
                "你是 Ozon 平台商品属性填写专家。根据商品信息为指定属性推荐合适的值。\n"
                "如果是字典型属性，必须从可选值列表中选择，返回 JSON: {\"value_id\": \"id\", \"value\": \"选中的值\"}\n"
                "如果是自由文本属性，返回 JSON: {\"value_id\": null, \"value\": \"推荐的值\"}\n"
                "只返回 JSON，不要加任何解释。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"属性名称: {attribute_name}\n"
                f"属性说明: {attribute_description or '无'}\n"
                f"商品标题: {product_title}\n"
                f"商品描述: {product_description or '无'}{dict_hint}"
            ),
        },
    ]
    raw, provider, model = _chat(messages, temperature=0.3, max_tokens=2048)
    try:
        result = _extract_json(raw)
    except (json.JSONDecodeError, ValueError):
        result = {"value_id": None, "value": raw.strip()}
    result["method"] = provider
    result["model"] = model
    return result


def generate_description(
    product_title: str,
    source_description: str = "",
    specs: list[dict[str, str]] | None = None,
    *,
    target_lang: str = "ru",
) -> dict[str, Any]:
    """Generate a structured product description for Ozon."""
    _api_key, _, _model = _config()
    if not _api_key and not get_listing_llm_failover_configs():
        raise RuntimeError("LLM_API_KEY 未配置")

    lang_name = {"ru": "俄语", "en": "英语", "zh": "中文"}.get(target_lang, target_lang)
    spec_text = ""
    if specs:
        spec_text = "\n".join(f"- {s.get('name','')}: {s.get('value','')}" for s in specs[:20])

    messages = [
        {
            "role": "system",
            "content": (
                f"你是 Ozon 平台商品文案专家。用{lang_name}为商品撰写结构化描述。\n"
                "格式要求：\n"
                "1. 产品概述（1-2句）\n"
                "2. 主要特点（要点列表）\n"
                "3. 材质与规格\n"
                "4. 使用场景\n"
                "5. 禁止生成随机发货、混款/混色、按订单确认颜色、任选颜色、"
                "组合商品承诺，以及俄语 в ассортименте、случайный、уточняйте при заказе。"
                "SKU 的颜色和装量必须只按已给规格陈述，不得杜撰。\n"
                "6. 货源文字仅可作为产品事实参考；绝不保留、翻译、猜测或提及任何品牌、制造商、厂家、店铺、供应商或平台名称（包括 Ozon）。\n"
                "只返回描述文本，不要加标题或解释。最多 3000 字符。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"商品标题: {product_title}\n"
                f"货源描述: {source_description or '无'}\n"
                f"规格信息:\n{spec_text or '无'}"
            ),
        },
    ]
    result, provider, model = _chat(messages, temperature=0.4, max_tokens=4096)
    return {"description": _strip_ozon_assortment_claims(result)[:3000], "lang": target_lang, "method": provider, "model": model}


def generate_rich_content(
    description: str,
    image_urls: list[str],
    *,
    shop_name: str = "",
) -> dict[str, Any]:
    """Generate Ozon rich-content JSON from description + images.

    Per user preference: Russian welcome + product description + 5 detail images.
    Format: Ozon raShowcase widget structure, wrapped in {"content": [...]}.
    """
    # Rich content is product content. Do not leak a shop name, which may
    # itself be a brand, into the product card.
    welcome = "Welcome!"
    welcome_ru = "Добро пожаловать!"
    welcome_ru += " Мы стремимся предоставить вам изысканный образ жизни!"

    widgets: list[dict[str, Any]] = []

    # Text block 1: Welcome message
    widgets.append({
        "widgetName": "raTextBlock",
        "type": "text",
        "blocks": [
            {
                "imgLink": "",
                "img": {
                    "src": "",
                    "srcMobile": "",
                    "alt": "",
                    "position": "width_full",
                    "positionMobile": "width_full"
                },
                "paragraphs": [
                    {
                        "content": welcome_ru,
                        "size": "size3",
                        "color": "color1",
                        "align": "align1"
                    }
                ]
            }
        ]
    })

    # Text block 2: Product description
    if description and description.strip():
        widgets.append({
            "widgetName": "raTextBlock",
            "type": "text",
            "blocks": [
                {
                    "imgLink": "",
                    "img": {
                        "src": "",
                        "srcMobile": "",
                        "alt": "",
                        "position": "width_full",
                        "positionMobile": "width_full"
                    },
                    "paragraphs": [
                        {
                            "content": description.strip(),
                            "size": "size3",
                            "color": "color1",
                            "align": "align1"
                        }
                    ]
                }
            ]
        })

    # Image gallery: raShowcase with up to 5 images
    valid_imgs = [u.strip() for u in image_urls[:5] if u and u.strip()]
    if valid_imgs:
        blocks = []
        for url in valid_imgs:
            blocks.append({
                "imgLink": "",
                "img": {
                    "src": url,
                    "srcMobile": url,
                    "alt": "",
                    "position": "width_full",
                    "positionMobile": "width_full"
                }
            })
        widgets.append({
            "widgetName": "raShowcase",
            "type": "roll",
            "blocks": blocks
        })

    # Wrap in {"content": [...]} as Ozon requires
    rich_obj = {"content": widgets, "version": 0.3}
    compact_json = json.dumps(rich_obj, ensure_ascii=False, separators=(",", ":"))
    pretty_json = json.dumps(rich_obj, ensure_ascii=False, indent=2)

    return {
        "rich_content": compact_json,
        "raw_json": pretty_json,
        "method": "template",
    }


def match_category_with_ai(
    product_title: str,
    candidates: list[dict[str, Any]],
    *,
    material: str = "",
    brand: str = "",
) -> dict[str, Any]:
    """Use DeepSeek to pick the best Ozon category from keyword-recalled candidates.

    candidates: list of {"category_id", "type_id", "title", "title_zh", "score"}
    Returns: {"best": {...}, "reason": str, "all_ranked": [...]}
    """
    _api_key, _, model = _config()
    if not _api_key and not get_listing_llm_failover_configs():
        raise RuntimeError("LLM_API_KEY 未配置")
    if not candidates:
        return {"best": None, "reason": "无候选类目", "all_ranked": []}

    # Build candidate list for the prompt
    cand_text = "\n".join(
        f"{i+1}. cat_id={c['category_id']} type_id={c['type_id']} | {c.get('title_zh','') or c['title']} | {c['title']}"
        for i, c in enumerate(candidates[:15])
    )

    ctx_parts = []
    if material:
        ctx_parts.append(f"材质: {material}")
    if brand:
        ctx_parts.append(f"品牌: {brand}")
    ctx = "；".join(ctx_parts) if ctx_parts else "无"

    messages = [
        {
            "role": "system",
            "content": (
                "你是 Ozon 平台类目匹配专家。根据商品标题，从候选类目列表中选择最匹配的一个。\n"
                "返回 JSON: {\"best_index\": 数字(从1开始), \"reason\": \"简短理由\"}\n"
                "只返回 JSON，不要加解释。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"商品标题: {product_title}\n"
                f"附加信息: {ctx}\n\n"
                f"候选类目:\n{cand_text}"
            ),
        },
    ]
    raw, _p, _m = _chat(messages, temperature=0.1, max_tokens=4096)
    try:
        result = _extract_json(raw)
        best_idx = int(result.get("best_index", 0)) - 1
        if 0 <= best_idx < len(candidates):
            best = candidates[best_idx]
        else:
            best = candidates[0]
        reason = result.get("reason", "")
    except (json.JSONDecodeError, ValueError, KeyError):
        best = candidates[0]
        reason = "AI解析失败，取关键词最高分"

    return {
        "best": best,
        "reason": reason,
        "model": _m,
    }

