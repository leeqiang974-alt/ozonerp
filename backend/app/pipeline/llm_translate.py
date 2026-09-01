"""LLM-powered Chinese-to-Russian translation for product listings.

Uses the configured OpenAI-compatible listing-text provider when available.
Falls back to a dictionary-based translation when no key is configured, and
marks the output as unverified so the quality check can flag it for review.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from dotenv import load_dotenv

from ..llm_provider import get_listing_llm_config, get_listing_llm_provider

# Load .env from project root or current directory
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), ".env"), override=True)

# --------------------------------------------------------------------------- #
# Dictionary fallback (used when no LLM API key is configured)                #
# --------------------------------------------------------------------------- #

# Expanded Chinese -> Russian keyword dictionary for common e-commerce terms
_DICT_ZH_RU: dict[str, str] = {
    # Materials
    "不锈钢": "нержавеющая сталь", "塑料": "пластик", "硅胶": "силикон",
    "陶瓷": "керамика", "玻璃": "стекло", "木质": "дерево", "竹制": "бамбук",
    "棉": "хлопок", "涤纶": "полиэстер", "尼龙": "нейлон", "铝合金": "алюминий",
    "铸铁": "чугун", "真皮": "натуральная кожа", "PU": "полиуретан",
    "ABS": "ABS-пластик", "PC": "поликарбонат",
    # Colors
    "红色": "красный", "蓝色": "синий", "绿色": "зеленый", "黑色": "черный",
    "白色": "белый", "黄色": "желтый", "紫色": "фиолетовый", "橙色": "оранжевый",
    "粉色": "розовый", "灰色": "серый", "金色": "золотой", "银色": "серебряный",
    # Product types
    "耳机": "наушники", "蓝牙": "Bluetooth", "无线": "беспроводной",
    "有线": "проводной", "头戴式": "накладные", "入耳式": "внутриканальные",
    "降噪": "шумоподавление", "主动降噪": "активное шумоподавление",
    "手机": "телефон", "手机壳": "чехол для телефона", "手机挂绳": "ремешок для телефона",
    "充电器": "зарядное устройство", "充电宝": "повербанк", "数据线": "кабель",
    "收纳架": "органайзер", "收纳盒": "коробка-органайзер", "置物架": "полка",
    "厨房": "кухонный", "壁挂": "настенный", "立式": "напольный", "手持": "ручной",
    "折叠": "складной", "便携": "портативный", "迷你": "мини",
    "灯": "лампа", "LED": "LED", "台灯": "настольная лампа",
    "手表": "часы", "闹钟": "будильник", "背包": "рюкзак", "钱包": "кошелек",
    "雨伞": "зонт", "水杯": "бутылка для воды", "保温杯": "термос",
    "毛巾": "полотенце", "枕头": "подушка", "被套": "пододеяльник",
    "玩具": "игрушка", "积木": "конструктор", "拼图": "пазл",
    # Features
    "防水": "водонепроницаемый", "防滑": "антискользящий", "防摔": "ударопрочный",
    "可调节": "регулируемый", "可拆卸": "съемный", "可充电": "перезаряжаемый",
    "触控": "сенсорный", "智能": "умный", "多功能": "многофункциональный",
    "高清": "HD", "4K": "4K", "高速": "высокоскоростной",
    # Specs
    "圆形": "круглый", "方形": "квадратный", "长方形": "прямоугольный",
    "大号": "большой", "中号": "средний", "小号": "маленький",
    "加厚": "утолщенный", "加宽": "расширенный", "加长": "удлиненный",
    # Misc
    "新款": "новинка", "时尚": "модный", "创意": "креативный",
    "实用": "практичный", "家用": "для дома", "户外": "для улицы",
    "旅行": "для путешествий", "办公": "для офиса", "学生": "студенческий",
    "礼品": "подарок", "批发": "опт", "厂家直销": "от производителя",
    "现货": "в наличии", "跨境": "кросс-бордер", "私模": "эксклюзивный дизайн",
    "品牌": "бренд", "型号": "модель", "规格": "характеристики",
    "重量": "вес", "尺寸": "размер", "颜色": "цвет", "材质": "материал",
    "包装": "упаковка", "配件": "аксессуары", "说明书": "инструкция",
}


def _dict_translate(text: str) -> str:
    """Translate Chinese text to Russian using the dictionary. Best-effort."""
    result = text
    # Sort by length descending so longer phrases are matched first
    for cn, ru in sorted(_DICT_ZH_RU.items(), key=lambda x: -len(x[0])):
        result = result.replace(cn, ru)
    # Remove remaining Chinese characters
    result = re.sub(r"[\u4e00-\u9fff]+", "", result)
    # Clean up extra spaces and punctuation
    result = re.sub(r"\s+", " ", result).strip()
    result = re.sub(r"[,，]+(?=\s|$)", "", result)
    result = re.sub(r"^\s*[,，]+|[,，]+\s*$", "", result)
    return result.strip()


def _has_cyrillic(text: str) -> bool:
    """Check if text contains Cyrillic characters."""
    return bool(re.search(r"[\u0400-\u04FF]", text))


# --------------------------------------------------------------------------- #
# LLM translation                                                             #
# --------------------------------------------------------------------------- #

def _get_api_config() -> tuple[str | None, str, str]:
    """Return (api_key, base_url, model) for title/description generation."""
    return get_listing_llm_config()


def is_llm_available() -> bool:
    """Check if LLM translation is available (API key configured)."""
    api_key, _, _ = _get_api_config()
    return bool(api_key)


def translate_product_content(
    title_zh: str,
    *,
    material: str = "",
    brand: str = "",
    category_zh: str = "",
    specs: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Translate a Chinese product to Russian title + description.

    Returns:
        {
            "title_ru": str,
            "description_ru": str,
            "verified": bool,  # True if LLM was used, False if dictionary fallback
            "method": str,     # "llm" or "dictionary"
        }
    """
    api_key, base_url, model = _get_api_config()

    if api_key:
        try:
            return _llm_translate(
                title_zh, api_key, base_url, model, get_listing_llm_provider(),
                material=material, brand=brand, category_zh=category_zh, specs=specs,
            )
        except Exception:
            # Fall back to dictionary on any LLM error
            pass

    return _fallback_translate(
        title_zh, material=material, brand=brand, category_zh=category_zh, specs=specs,
    )


def _llm_translate(
    title_zh: str, api_key: str, base_url: str, model: str, provider: str,
    *, material: str = "", brand: str = "", category_zh: str = "",
    specs: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Use OpenAI-compatible API for high-quality Russian translation."""
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=base_url)

    spec_text = ""
    if specs:
        spec_lines = [f"- {s['name']}: {s['value']}" for s in specs[:20]]
        spec_text = "\n".join(spec_lines)

    context_parts = []
    if material:
        context_parts.append(f"Material: {material}")
    if category_zh:
        context_parts.append(f"Category: {category_zh}")
    if spec_text:
        context_parts.append(f"Specifications:\n{spec_text}")
    context = "\n".join(context_parts)

    prompt = f"""You are a professional e-commerce listing translator. Translate the following Chinese product information to Russian for the Ozon marketplace.

Chinese title: {title_zh}
{context}

Generate a JSON response with:
1. "title_ru": A concise Russian product title (max 200 chars). Remove marketing fluff. Include key features like material, type, and main function. SEO-friendly.
2. "description_ru": A structured Russian product description (max 5000 chars) with sections:
   - Product overview (1-2 sentences)
   - Key features (bullet points)
   - Materials and specifications
   - Usage scenarios
   Make it informative and appealing to Russian buyers. Use proper Russian grammar.

Hard Ozon moderation rule: never write that the colour/model is random, mixed, selected after ordering, or "в ассортименте"/"случайный"/"уточняйте при заказе". Do not promise a bundle or combination product. When variants exist, state only their explicit SKU facts. Never include, translate, infer, or mention any brand, manufacturer, supplier, shop, marketplace, or platform name from the source copy.

Respond with ONLY valid JSON, no markdown."""

    options: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are an e-commerce listing translator. Respond only with valid JSON."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 4096,
    }
    if provider == "volcengine":
        options["extra_body"] = {"thinking": {"type": "disabled"}}
    response = client.chat.completions.create(**options)

    _msg = response.choices[0].message
    raw = (_msg.content or "").strip()
    if not raw:
        # Reasoning models (deepseek-v4, glm-5.2) put output in reasoning_content
        raw = (_msg.reasoning_content or "").strip()
    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    result = json.loads(raw)
    title_ru = str(result.get("title_ru", "")).strip()[:200]
    description_ru = str(result.get("description_ru", "")).strip()[:5000]

    if not title_ru:
        raise ValueError("LLM returned empty title")

    return {
        "title_ru": title_ru,
        "description_ru": description_ru,
        "verified": True,
        "method": "llm",
    }


def _fallback_translate(
    title_zh: str, *,
    material: str = "", brand: str = "", category_zh: str = "",
    specs: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Dictionary-based fallback translation. Marks output as unverified."""
    title_ru = _dict_translate(title_zh)
    if not title_ru or not _has_cyrillic(title_ru):
        # If no Cyrillic at all, use category name as fallback
        if category_zh:
            title_ru = _dict_translate(category_zh) or "Товар"

    # Build structured description
    desc_parts: list[str] = []

    # Overview
    if title_ru:
        desc_parts.append(title_ru)
    else:
        desc_parts.append("Товар")

    # Features from specs
    if specs:
        desc_parts.append("\nХарактеристики:")
        for s in specs[:15]:
            name_ru = _dict_translate(s.get("name", ""))
            value_ru = _dict_translate(s.get("value", ""))
            if name_ru and value_ru:
                desc_parts.append(f"- {name_ru}: {value_ru}")

    # Material
    if material:
        mat_ru = _dict_translate(material)
        if mat_ru:
            desc_parts.append(f"\nМатериал: {mat_ru}")

    description_ru = "\n".join(desc_parts)[:5000]

    return {
        "title_ru": title_ru or "Товар",
        "description_ru": description_ru,
        "verified": False,
        "method": "dictionary",
    }
