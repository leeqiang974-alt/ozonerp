"""Rich Content JSON builder for Ozon product listings.

Generates the Rich Content JSON (attribute id=11254) from product images
and description text.  The JSON is passed as an attribute value in the
/v3/product/import request.

Structure (verified against real Ozon product data):

{
  "content": [
    {
      "widgetName": "raShowcase",      // image gallery
      "type": "roll",
      "blocks": [
        {
          "imgLink": "",
          "img": {
            "src": "https://...",
            "srcMobile": "https://...",
            "alt": "",
            "position": "width_full",
            "positionMobile": "width_full"
          }
        }
      ]
    },
    {
      "widgetName": "list",            // text block (optional)
      "theme": "bullet",
      "blocks": [
        {
          "title": {
            "content": ["Title line 1"],
            "size": "size4",
            "align": "left",
            "color": "color1"
          },
          "text": {
            "content": ["Line 1", "", "Line 2"],
            "size": "size2",
            "align": "left",
            "color": "color1"
          }
        }
      ]
    }
  ]
}
"""

from __future__ import annotations

import json
from typing import Any

RICH_CONTENT_ATTRIBUTE_ID = "11254"


def build_image_block(image_url: str, alt: str = "") -> dict[str, Any]:
    """Build a single image block for the raShowcase widget."""
    return {
        "imgLink": "",
        "img": {
            "src": image_url,
            "srcMobile": image_url,
            "alt": alt,
            "position": "width_full",
            "positionMobile": "width_full",
        },
    }


def build_showcase_widget(image_urls: list[str]) -> dict[str, Any]:
    """Build a raShowcase widget from a list of image URLs."""
    blocks = [build_image_block(url) for url in image_urls if url]
    return {
        "widgetName": "raShowcase",
        "type": "roll",
        "blocks": blocks,
    }


def build_text_widget(text: str) -> dict[str, Any]:
    """Build the raTextBlock shape used by ERP listings accepted by Ozon."""
    return {
        "widgetName": "raTextBlock",
        "type": "text",
        "blocks": [{
            "imgLink": "",
            "img": {"src": "", "srcMobile": "", "alt": "", "position": "width_full", "positionMobile": "width_full"},
            "paragraphs": [{"content": text, "size": "size3", "color": "color1", "align": "align1"}],
        }],
    }


def build_rich_content(
    image_urls: list[str],
    description_ru: str = "",
    title_ru: str = "",
    description_as_text_block: bool = True,
    images_first: bool = False,
) -> str:
    """Build the complete Rich Content JSON string.

    Ozon's rich-content template validator (verified 2026-09) accepts ONLY
    text-only payloads with a top-level ``version`` field.  Image widgets
    (``raShowcase``) carrying external (non-Ozon-CDN) image URLs are erased
    with ``erased_attribute_value`` ("Rich-контент JSON не соответствует
    шаблону"), and an empty JSON ``{}`` is also rejected.  The validated
    shape (verified against approved products XY000001 / AECMTS... /
    DFEMTS... / CFFMTS...) is::

        {"content": [{"widgetName":"raTextBlock", ...paragraphs...}], "version": 0.3}

    Args:
        image_urls: Kept for call-compatibility only; external images are
            intentionally NOT embedded (the template validator rejects them).
        description_ru: Russian product description text.
        title_ru: Russian product title (used as the first text block).
        description_as_text_block: If True, include a text widget with the description.
        images_first: Kept for call-compatibility; has no effect.

    Returns:
        JSON string suitable for attribute id=11254 in /v3/product/import.
    """
    widgets: list[dict[str, Any]] = []
    if title_ru and str(title_ru).strip():
        widgets.append(build_text_widget(str(title_ru).strip()))
    if description_as_text_block and description_ru and str(description_ru).strip():
        widgets.append(build_text_widget(str(description_ru).strip()))
    if not widgets:
        widgets.append(build_text_widget(""))

    payload: dict[str, Any] = {"content": widgets}
    payload["version"] = 0.3
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def get_rich_content_attribute(image_urls: list[str], description_ru: str = "", title_ru: str = "") -> dict[str, Any]:
    """Build the rich content as an attribute dict for /v3/product/import.

    Returns a dict matching the Ozon attribute format:
    {
        "complex_id": 0,
        "id": "11254",
        "values": [{"dictionary_value_id": 0, "value": "<rich content JSON>"}]
    }
    """
    json_str = build_rich_content(image_urls, description_ru=description_ru, title_ru=title_ru)
    return {
        "complex_id": 0,
        "id": RICH_CONTENT_ATTRIBUTE_ID,
        "values": [{"dictionary_value_id": 0, "value": json_str}],
    }
