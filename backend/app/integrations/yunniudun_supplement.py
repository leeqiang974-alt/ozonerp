"""Collection-only contract for Yun Newton 1688 product-link supplementation."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlparse


class YunNewtonSupplementError(ValueError):
    pass


def offer_id_from_url(url: str) -> str:
    match = re.search(r"(?:detail\.)?1688\.com/offer/(\d+)\.html", str(url or ""), re.I)
    if not match:
        raise YunNewtonSupplementError("仅支持 detail.1688.com 的商品链接")
    return match.group(1)


def build_link_collection_message(source_url: str) -> str:
    offer_id = offer_id_from_url(source_url)
    return "\n".join((
        "请仅读取并结构化提取这个 1688 商品链接的数据：",
        source_url.strip(),
        f"预期 Offer ID：{offer_id}",
        "禁止询盘、发送消息、收藏、加入采购单、下单、图片翻译或任何外部写操作。",
        "只返回一个 JSON 对象，不要 Markdown，不要解释。字段必须为：",
        "offerId, title, url, supplier, images, detailImages, attributes, skuVariants, packageInfo, parseIssues。",
        "images 只能是商品固定主图；detailImages 只能来自“商品描述”详情区域；不得包含推荐商品、店铺头像、广告或 SKU 专属图。",
        "skuVariants 必须保留每个真实 SKU：skuId, spec, price, stock, image；image 只放该 SKU 的专属图。",
        "packageInfo 只使用 weightG, lengthMm, widthMm, heightMm，无法确认则留空并在 parseIssues 说明。",
    ))


def _http_url(value: Any) -> str:
    url = str(value or "").strip()
    parsed = urlparse(url)
    return url if parsed.scheme in {"http", "https"} and parsed.netloc else ""


def _urls(value: Any) -> list[str]:
    rows = value if isinstance(value, list) else []
    result: list[str] = []
    for item in rows:
        url = _http_url(item)
        if url and url not in result:
            result.append(url)
    return result


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _integer(value: Any) -> int | None:
    number = _number(value)
    return int(number) if number is not None and number >= 0 else None


def _json_object(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _find_capture(value: Any) -> dict[str, Any] | None:
    parsed = _json_object(value)
    if parsed is not None:
        if parsed.get("title") or parsed.get("offerId"):
            return parsed
        value = parsed
    if isinstance(value, dict):
        for key in ("data", "content", "message", "messages", "chunks", "result"):
            candidate = _find_capture(value.get(key))
            if candidate:
                return candidate
    if isinstance(value, list):
        for item in reversed(value):
            candidate = _find_capture(item)
            if candidate:
                return candidate
    return None


def normalize_link_collection_result(raw_result: Any, source_url: str) -> dict[str, Any]:
    """Normalize an agent result without guessing absent SKU combinations."""
    expected_offer_id = offer_id_from_url(source_url)
    candidate = _find_capture(raw_result)
    if not candidate:
        raise YunNewtonSupplementError("云牛顿结果未包含可解析的商品 JSON")
    offer_id = str(candidate.get("offerId") or expected_offer_id).strip()
    if offer_id != expected_offer_id:
        raise YunNewtonSupplementError("云牛顿返回的 Offer ID 与请求链接不一致")
    title = str(candidate.get("title") or "").strip()[:500]
    if not title:
        raise YunNewtonSupplementError("云牛顿结果缺少商品标题")
    variants: list[dict[str, Any]] = []
    for index, row in enumerate(candidate.get("skuVariants") or []):
        if not isinstance(row, dict):
            continue
        sku_id = str(row.get("skuId") or row.get("sku_id") or row.get("spec") or "").strip()
        spec = str(row.get("spec") or row.get("specName") or sku_id).strip()
        if not sku_id or not spec:
            continue
        variant = {"skuId": sku_id[:128], "spec": spec[:500]}
        price = _number(row.get("price"))
        stock = _integer(row.get("stock"))
        image = _http_url(row.get("image") or row.get("skuImageUrl"))
        if price is not None:
            variant["price"] = price
        if stock is not None:
            variant["stock"] = stock
        if image:
            variant["image"] = image
        variants.append(variant)
    issues = [str(issue).strip()[:200] for issue in (candidate.get("parseIssues") or []) if str(issue).strip()]
    if not variants:
        issues.append("missing_sku_variants")
    package = candidate.get("packageInfo") if isinstance(candidate.get("packageInfo"), dict) else {}
    package_info = {key: _number(package.get(key)) for key in ("weightG", "lengthMm", "widthMm", "heightMm")}
    package_info = {key: value for key, value in package_info.items() if value is not None and value > 0}
    attributes = [
        {"name": str(row.get("name") or "").strip()[:200], "value": str(row.get("value") or "").strip()[:1000]}
        for row in (candidate.get("attributes") or []) if isinstance(row, dict) and str(row.get("name") or "").strip()
    ]
    return {
        "offerId": offer_id,
        "title": title,
        "url": source_url.strip(),
        "supplier": str(candidate.get("supplier") or "").strip()[:300],
        # These arrays are copied only from their explicit source fields.
        # SKU-only images are never promoted into either public image array.
        "images": _urls(candidate.get("images")),
        "detailImages": _urls(candidate.get("detailImages")),
        "attributes": attributes,
        "skuVariants": variants,
        "packageInfo": package_info,
        "parseIssues": list(dict.fromkeys(issues)),
        "sources": {"kind": "yunniudun_link_supplement", "official_api": False},
    }
