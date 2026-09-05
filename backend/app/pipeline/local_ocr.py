"""Free local OCR image gate used by bulk-listing preprocessing.

The source media is immutable.  This module only returns a filtered list for
the draft plus auditable OCR evidence.  English-only dimension images remain.
"""

from __future__ import annotations

import asyncio
import re
import tempfile
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import pytesseract
from PIL import Image

# 显式指定 Tesseract 可执行文件路径（PATH 中可能没有）
_TESSERACT_CMD = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
_OCR_LANG = "chi_sim+eng+rus"


_HAN_RE = re.compile(r"[\u4e00-\u9fff]")
_MEASURE_RE = re.compile(
    r"(?:尺寸|重量|净重|克重|长|宽|高|厚|直径|厘米|毫米|公斤|克|"
    r"\b(?:size|weight|length|width|height|diameter|cm|mm|kg|g|inch|in)\b)",
    re.IGNORECASE,
)

# 营销/厂家/定制/促销类关键词——命中即说明图片与产品本身无关
_MARKETING_RE = re.compile(
    r"(?:厂家|直销|源头|工厂|定制|来图|定做|OEM|ODM|代工|批发|批量|供货|"
    r"一件代发|代发|包邮|促销|特价|清仓|甩卖|折扣|优惠|活动|限时|"
    r"量大|价优|微信|加微|扫码|联系|客服|电话|下单|订购|预约|"
    r"赠品|礼品|礼盒|免费|赠送|爆款|热销|网红|同款|"
    r"\b(?:factory|wholesale|custom|oem|odm|bulk|drop.?ship|promotion|sale|discount|free shipping)\b)",
    re.IGNORECASE,
)

# Platform policy hard-stop. This is intentionally separate from ordinary
# marketing text: a matched image must not be translated, regenerated around,
# or submitted as a product detail image.
_PROHIBITED_LGBT_SYMBOL_RE = re.compile(
    r"(?:\b(?:lgbtq?\+?|pride|trans(?:gender)?|trans\s+rights|gay\s+rights|"
    r"lesbian|non[-\s]?binary)\b|лгбт|прайд|транс(?:гендер|\s+прав|\b)|"
    r"(?:rainbow|радужн\w*|彩虹)\s*(?:flag|pride|rights|флаг|прайд|旗)|"
    r"(?:lgbt|pride|trans|跨性别|性少数|非二元)\s*(?:rainbow|радужн\w*|彩虹|旗|flag)|"
    r"跨性别|性少数|非二元)",
    re.IGNORECASE,
)


def exclusion_reasons_for_ocr_text(
    text: str,
    *,
    remove_chinese_measure: bool = False,
    remove_marketing: bool = False,
) -> list[str]:
    """Classify OCR evidence without mutating a source image."""
    reasons: list[str] = []
    if remove_chinese_measure and _HAN_RE.search(text) and _MEASURE_RE.search(text):
        reasons.append("chinese_measure")
    if remove_marketing and _MARKETING_RE.search(text):
        reasons.append("marketing")
    # Always enforce this policy gate; it must never depend on a UI checkbox.
    if _PROHIBITED_LGBT_SYMBOL_RE.search(text):
        reasons.append("prohibited_lgbt_symbolism")
    return reasons


def _run_tesseract(image_path: Path) -> str:
    """Run Tesseract synchronously (chi_sim + eng + rus)."""
    pytesseract.pytesseract.tesseract_cmd = _TESSERACT_CMD
    with Image.open(image_path) as img:
        text = pytesseract.image_to_string(img, lang=_OCR_LANG)
    return (text or "").strip()


async def _recognize_url(url: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff"}:
        suffix = ".jpg"
    with tempfile.TemporaryDirectory(prefix="ozon-ocr-") as folder:
        path = Path(folder) / f"source{suffix}"
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=20) as response:
            path.write_bytes(response.read())
        try:
            text = await asyncio.to_thread(_run_tesseract, path)
        except Exception as exc:
            raise RuntimeError(f"Tesseract OCR 识别失败: {exc}") from exc
        if not text:
            raise RuntimeError("Tesseract OCR 未识别到文字")
        return text


def filter_chinese_measure_images(media: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Exclude only images containing both Chinese and measurement evidence."""
    kept: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    for item in media:
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        try:
            text = asyncio.run(_recognize_url(url))
            excluded = bool(_HAN_RE.search(text) and _MEASURE_RE.search(text))
            evidence.append({"url": url, "text": text[:1000], "excluded": excluded})
            if not excluded:
                kept.append(item)
        except Exception as exc:
            kept.append(item)
            evidence.append({"url": url, "text": "", "excluded": False, "error": str(exc)[:500]})
    return kept, evidence


def filter_bulk_images(
    media: list[dict[str, Any]],
    *,
    remove_chinese_measure: bool = False,
    remove_marketing: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """OCR过滤图片，返回(保留图片, 审计证据, 有文字需翻译的URL列表)。

    - 中文尺重图：remove_chinese_measure=True 时排除
    - 营销/厂家/定制图：remove_marketing=True 时排除
    - 只有OCR成功且识别到非空文字的图片才会加入需翻译列表
    - 被排除的图片绝不进入翻译列表
    - OCR失败的图片保留但不翻译
    """
    kept: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    translatable_urls: list[str] = []
    for item in media:
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        try:
            text = asyncio.run(_recognize_url(url))
            excluded_reasons = exclusion_reasons_for_ocr_text(
                text,
                remove_chinese_measure=remove_chinese_measure,
                remove_marketing=remove_marketing,
            )
            excluded = bool(excluded_reasons)
            has_text = bool(text.strip())
            evidence.append({
                "url": url, "text": text[:1000], "excluded": excluded,
                "reasons": excluded_reasons, "has_text": has_text,
            })
            if not excluded:
                kept.append(item)
                if has_text:
                    translatable_urls.append(url)
        except Exception as exc:
            kept.append(item)
            evidence.append({"url": url, "text": "", "excluded": False, "error": str(exc)[:500], "has_text": False})
    return kept, evidence, translatable_urls


def inspect_image(url: str) -> dict[str, Any]:
    """OCR one image for an operator retry without touching source media."""
    try:
        text = asyncio.run(_recognize_url(url))
        reasons = exclusion_reasons_for_ocr_text(text, remove_chinese_measure=True)
        return {"url": url, "text": text[:1000], "excluded": bool(reasons), "reasons": reasons, "error": None}
    except Exception as exc:
        return {"url": url, "text": "", "excluded": False, "error": str(exc)[:500]}
