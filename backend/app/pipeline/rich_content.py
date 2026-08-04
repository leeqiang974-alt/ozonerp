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


def build_text_widget(
    title_lines: list[str] | None = None,
    text_lines: list[str] | None = None,
    theme: str = "bullet",
) -> dict[str, Any]:
    """Build a list (text) widget with optional title and body text."""
    block: dict[str, Any] = {}
    if title_lines:
        block["title"] = {
            "content": title_lines,
            "size": "size4",
            "align": "left",
            "color": "color1",
        }
    if text_lines:
        block["text"] = {
            "content": text_lines,
            "size": "size2",
            "align": "left",
            "color": "color1",
        }
    if not block:
        block["text"] = {
            "content": [""],
            "size": "size2",
            "align": "left",
            "color": "color1",
        }
    return {
        "widgetName": "list",
        "theme": theme,
        "blocks": [block],
    }


def build_rich_content(
    image_urls: list[str],
    description_ru: str = "",
    title_ru: str = "",
    description_as_text_block: bool = True,
    images_first: bool = True,
) -> str:
    """Build the complete Rich Content JSON string.

    Args:
        image_urls: List of product image URLs (must be publicly accessible).
        description_ru: Russian product description text.
        title_ru: Russian product title (used as the text block title).
        description_as_text_block: If True, include a text widget with the description.
        images_first: If True, images come before text; False = text first.

    Returns:
        JSON string suitable for attribute id=11254 in /v3/product/import.
    """
    widgets: list[dict[str, Any]] = []

    # Build image showcase widget
    valid_images = [u for u in image_urls if u and isinstance(u, str) and u.startswith(("https://", "http://"))]
    if valid_images:
        showcase = build_showcase_widget(valid_images)
    else:
        showcase = None

    # Build text widget from description
    text_widget = None
    if description_as_text_block and description_ru:
        # Split description into lines
        desc_lines = [line.strip() for line in description_ru.split("\n") if line.strip()]
        title_lines = [title_ru] if title_ru else None
        if desc_lines:
            text_widget = build_text_widget(
                title_lines=title_lines,
                text_lines=desc_lines,
            )

    # Order widgets
    if images_first:
        if showcase:
            widgets.append(showcase)
        if text_widget:
            widgets.append(text_widget)
    else:
        if text_widget:
            widgets.append(text_widget)
        if showcase:
            widgets.append(showcase)

    # Fallback: if no widgets, create a minimal showcase with no blocks
    if not widgets:
        widgets.append({
            "widgetName": "raShowcase",
            "type": "roll",
            "blocks": [],
        })

    return json.dumps({"content": widgets}, ensure_ascii=False, separators=(",", ":"))


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
