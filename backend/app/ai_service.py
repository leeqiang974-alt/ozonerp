"""DeepSeek-powered AI service for the listing editor.

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

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env"), override=True)


def _config() -> tuple[str, str, str]:
    """Return (api_key, base_url, model) from environment."""
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or ""
    base_url = os.getenv("LLM_BASE_URL", "https://api.deepseek.com")
    model = os.getenv("LLM_MODEL", "deepseek-chat")
    return api_key, base_url, model


def _chat(messages: list[dict[str, str]], *, temperature: float = 0.3, max_tokens: int = 4096) -> str:
    """Call the DeepSeek chat-completions endpoint and return the text reply."""
    api_key, base_url, model = _config()
    if not api_key:
        raise RuntimeError("LLM_API_KEY 未配置，无法使用 AI 功能")
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    # Disable reasoning/thinking mode for faster response (Volcano Engine coding plan)
    payload["thinking"] = {"type": "disabled"}
    resp = httpx.post(url, headers=headers, json=payload, timeout=60.0)
    if resp.status_code >= 400:
        # If thinking param is rejected, retry without it
        if resp.status_code == 400 and "thinking" in resp.text.lower():
            payload.pop("thinking", None)
            resp = httpx.post(url, headers=headers, json=payload, timeout=60.0)
        if resp.status_code >= 400:
            raise RuntimeError(f"LLM API 返回 {resp.status_code}: {resp.text[:500]}")
    body = resp.json()
    msg = body["choices"][0]["message"]
    text = msg.get("content") or ""
    if not text.strip():
        # Reasoning models (deepseek-v4, glm-5.2) put output in reasoning_content
        text = msg.get("reasoning_content") or ""
    return text.strip()


def _extract_json(text: str) -> dict[str, Any]:
    """Strip markdown fences and parse JSON from LLM output."""
    cleaned = re.sub(r"^```(?:json)?\s*", "", text)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned)


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
    api_key, _, model = _config()
    if not api_key:
        raise RuntimeError("LLM_API_KEY 未配置")
    lang_name = {"ru": "俄语", "en": "英语", "zh": "中文"}.get(target_lang, target_lang)
    ctx = f"\n上下文信息：{context}" if context else ""
    messages = [
        {"role": "system", "content": f"你是专业电商翻译。将用户提供的文本翻译为{lang_name}，只返回翻译结果，不要加任何解释或引号。"},
        {"role": "user", "content": f"{text}{ctx}"},
    ]
    result = _chat(messages, temperature=0.2, max_tokens=2048)
    return {"translated": result, "lang": target_lang, "method": "deepseek", "model": model}


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
    api_key, _, model = _config()
    if not api_key:
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
    raw = _chat(messages, temperature=0.3, max_tokens=2048)
    try:
        result = _extract_json(raw)
    except (json.JSONDecodeError, ValueError):
        result = {"value_id": None, "value": raw.strip()}
    result["method"] = "deepseek"
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
    api_key, _, model = _config()
    if not api_key:
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
    result = _chat(messages, temperature=0.4, max_tokens=4096)
    return {"description": result[:3000], "lang": target_lang, "method": "deepseek", "model": model}


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
    welcome = f"Welcome to store {shop_name}!" if shop_name else "Welcome to our store!"
    welcome_ru = f"Добро пожаловать в магазин {shop_name}!" if shop_name else "Добро пожаловать в наш магазин!"
    welcome_ru += " Мы стремимся предоставить вам изысканный образ жизни!"

    widgets: list[dict[str, Any]] = []

    # Text block 1: Welcome message
    widgets.append({
        "widgetName": "raTextBlock",
        "title": {"content": "", "color": "default", "fontSize": "medium"},
        "content": {"content": welcome_ru, "color": "default", "fontSize": "medium"},
        "padding": {"top": "medium", "bottom": "medium"},
    })

    # Text block 2: Product description
    if description and description.strip():
        widgets.append({
            "widgetName": "raTextBlock",
            "title": {"content": "", "color": "default", "fontSize": "medium"},
            "content": {"content": description.strip(), "color": "default", "fontSize": "medium"},
            "padding": {"top": "medium", "bottom": "medium"},
        })

    # Image blocks: up to 5 product detail images
    for url in image_urls[:5]:
        if url and url.strip():
            widgets.append({
                "widgetName": "raShowcase",
                "content": {
                    "images": [{"image": url.strip(), "width": 750}],
                },
                "padding": {"top": "small", "bottom": "small"},
            })

    # Wrap in {"content": [...]} as Ozon requires
    rich_obj = {"content": widgets}
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
    api_key, _, model = _config()
    if not api_key:
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
    raw = _chat(messages, temperature=0.1, max_tokens=4096)
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
        "model": model,
    }
