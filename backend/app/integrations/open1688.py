"""Minimal read-only client for 1688 Fenxiao/JXHY OpenAPI."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs
import re
from typing import Any

import httpx
from app.security import encrypt_secret, decrypt_secret

CONFIG_FILE = Path(".local-secrets/open1688.json")

def _config() -> dict:
    data = json.loads(CONFIG_FILE.read_text("utf-8")) if CONFIG_FILE.exists() else {}
    for key in ("app_secret", "access_token", "refresh_token"):
        if data.get(key): data[key] = decrypt_secret(data[key])
    return data

def save_application(app_key: str, app_secret: str, redirect_uri: str) -> None:
    current = _config()
    data = {"app_key": app_key.strip(), "redirect_uri": redirect_uri.strip(), "app_secret": encrypt_secret(app_secret.strip()), "access_token": encrypt_secret(current["access_token"]) if current.get("access_token") else "", "refresh_token": encrypt_secret(current["refresh_token"]) if current.get("refresh_token") else ""}
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")

def authorization_url() -> str:
    c = _config()
    return "https://auth.1688.com/auth/authorize.htm?" + urlencode({"client_id": c.get("app_key", ""), "site": "1688", "redirect_uri": c.get("redirect_uri", ""), "state": "ozon-erp"})

def exchange_code(code_or_url: str, *, transport=None) -> dict:
    c = _config(); value = code_or_url.strip()
    if "://" in value: value = parse_qs(urlparse(value).query).get("code", [""])[0]
    if not value: raise Open1688Error("没有找到授权码 code")
    url = f"https://gw.open.1688.com/openapi/http/1/system.oauth2/getToken/{c['app_key']}"
    form = {"grant_type":"authorization_code","need_refresh_token":"true","client_id":c["app_key"],"client_secret":c["app_secret"],"redirect_uri":c["redirect_uri"],"code":value}
    with httpx.Client(timeout=20, transport=transport) as client: response = client.post(url, data=form)
    payload = response.json(); token = payload.get("access_token") or payload.get("accessToken")
    if not token: raise Open1688Error(str(payload.get("error_description") or payload.get("error") or payload))
    raw = json.loads(CONFIG_FILE.read_text("utf-8")); raw["access_token"] = encrypt_secret(token)
    refresh = payload.get("refresh_token") or payload.get("refreshToken")
    if refresh: raw["refresh_token"] = encrypt_secret(refresh)
    CONFIG_FILE.write_text(json.dumps(raw, ensure_ascii=False, indent=2), "utf-8")
    return {"ok": True, "has_refresh_token": bool(refresh), "expires_in": payload.get("expires_in") or payload.get("expiresIn")}


class Open1688Error(RuntimeError):
    pass


def configuration_status() -> dict[str, Any]:
    stored = _config(); app_key = (stored.get("app_key") or os.getenv("OPEN1688_APP_KEY", "")).strip()
    missing = [name for name, value in (
        ("AppKey", app_key),
        ("AppSecret", stored.get("app_secret") or os.getenv("OPEN1688_APP_SECRET", "").strip()),
        ("AccessToken", stored.get("access_token") or os.getenv("OPEN1688_ACCESS_TOKEN", "").strip()),
    ) if not value]
    return {
        "configured": not missing,
        "app_key": app_key,
        "missing": missing,
        "message": "严选接口凭据已配置" if not missing else f"缺少：{'、'.join(missing)}",
    }


def _stringify(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return "" if value is None else str(value)


def sign_path(path: str, params: dict[str, Any], secret: str) -> str:
    base = "".join(f"{key}{_stringify(params[key])}" for key in sorted(params))
    return hmac.new(secret.encode(), f"{path}{base}".encode(), hashlib.sha1).hexdigest().upper()


def _items(value: Any) -> list[dict]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if not isinstance(value, dict):
        return []
    for key in ("items", "list", "resultList", "rows", "pageList", "products", "productList", "result", "data"):
        nested = _items(value.get(key))
        if nested:
            return nested
    return []


def _first(item: dict, *keys: str) -> Any:
    for key in keys:
        value = item.get(key)
        if value not in (None, ""):
            return value
    return ""


def _number(value: Any) -> float:
    match = re.search(r"-?\d+(?:\.\d+)?", str(value or ""))
    return float(match.group()) if match else 0


def normalize_candidate(item: dict) -> dict[str, Any]:
    offer_id = str(_first(item, "itemId", "offerId", "offerID", "productId", "productID", "id"))
    price_min = _number(_first(item, "minPrice", "priceStart", "priceMin", "price"))
    price_max = _number(_first(item, "maxPrice", "priceEnd", "priceMax", "price")) or price_min
    if "minPrice" in item: price_min /= 100
    if "maxPrice" in item: price_max /= 100
    return {
        "offer_id": offer_id,
        "title": str(_first(item, "title", "subject", "productName", "offerTitle") or "未命名严选商品"),
        "image_url": str(_first(item, "imgUrl", "image", "imageUrl", "mainImage", "mainImageUrl", "picUrl")),
        "price_min": price_min,
        "price_max": price_max,
        "supplier": str(_first(item, "supplierName", "companyName", "sellerName")),
        "sku_count": int(item.get("skuCnt") or 0),
        "sales_90d": int(item.get("salesCnt90d") or 0),
        "services": item.get("serviceList") or [],
        "url": f"https://detail.1688.com/offer/{offer_id}.html" if offer_id else "",
    }


def search_jxhy_products(keyword: str, page_num: int = 1, page_size: int = 20, *, category_id: int | None = None, price_start: str = "", price_end: str = "", filters: list[str] | None = None, rule_ids: list[str] | None = None, transport=None) -> dict[str, Any]:
    status = configuration_status()
    if not status["configured"]:
        raise Open1688Error(status["message"])
    stored = _config(); app_key = (stored.get("app_key") or os.environ.get("OPEN1688_APP_KEY", "")).strip(); secret = (stored.get("app_secret") or os.environ.get("OPEN1688_APP_SECRET", "")).strip(); token = (stored.get("access_token") or os.environ.get("OPEN1688_ACCESS_TOKEN", "")).strip()
    path = f"param2/1/com.alibaba.fenxiao/jxhy.product.getPageList/{app_key}"
    params = {"access_token": token, "pageNum": page_num, "pageSize": page_size, "keyword": keyword.strip()}
    if category_id: params["categoryId"] = category_id
    if price_start.strip(): params["priceStart"] = price_start.strip()
    if price_end.strip(): params["priceEnd"] = price_end.strip()
    if filters: params["filters"] = [value for value in filters if value]
    if rule_ids: params["ruleIds"] = [value for value in rule_ids if value]
    params["_aop_signature"] = sign_path(path, params, secret)
    with httpx.Client(timeout=15, transport=transport) as client:
        response = client.get(f"https://gw.open.1688.com/openapi/{path}", params={k: _stringify(v) for k, v in params.items()})
    try:
        payload = response.json()
    except ValueError as exc:
        raise Open1688Error(f"1688 返回了非 JSON 响应（HTTP {response.status_code}）") from exc
    error = payload.get("error_message") or payload.get("errorMessage") or payload.get("exception")
    if response.status_code >= 400 or error:
        raise Open1688Error(str(error or f"1688 HTTP {response.status_code}"))
    rows = _items(payload)
    container = payload.get("result") if isinstance(payload.get("result"), dict) else payload
    page_info = container.get("pageInfo") if isinstance(container.get("pageInfo"), dict) else container
    return {
        "page_num": int(page_info.get("currentPage", page_info.get("pageNum", page_num))),
        "page_size": int(page_info.get("pageSize", page_size)),
        "total": int(page_info.get("totalRecords", page_info.get("total", len(rows)))),
        "items": [normalize_candidate(row) for row in rows],
    }


def get_jxhy_product_filters(*, transport=None) -> list[dict[str, Any]]:
    status = configuration_status()
    if not status["configured"]:
        raise Open1688Error(status["message"])
    stored = _config()
    app_key = (stored.get("app_key") or os.environ.get("OPEN1688_APP_KEY", "")).strip()
    secret = (stored.get("app_secret") or os.environ.get("OPEN1688_APP_SECRET", "")).strip()
    token = (stored.get("access_token") or os.environ.get("OPEN1688_ACCESS_TOKEN", "")).strip()
    path = f"param2/1/com.alibaba.fenxiao/jxhy.productFilter.get/{app_key}"
    params = {"access_token": token}
    params["_aop_signature"] = sign_path(path, params, secret)
    with httpx.Client(timeout=15, transport=transport) as client:
        response = client.post(f"https://gw.open.1688.com/openapi/{path}", data={key: _stringify(value) for key, value in params.items()})
    try:
        payload = response.json()
    except ValueError as exc:
        raise Open1688Error(f"1688 筛选条件返回了非 JSON 响应（HTTP {response.status_code}）") from exc
    error = payload.get("error_message") or payload.get("errorMessage") or payload.get("exception")
    if response.status_code >= 400 or error:
        raise Open1688Error(str(error or f"1688 HTTP {response.status_code}"))
    result = payload.get("result") or payload.get("data") or []
    return [item for item in result if isinstance(item, dict)] if isinstance(result, list) else []


def get_product_details(offer_ids: list[str], *, transport=None) -> list[dict[str, Any]]:
    """Fetch official Pifatuan details for up to 20 offers."""
    clean_ids = list(dict.fromkeys(str(value).strip() for value in offer_ids if str(value).strip()))
    if not clean_ids:
        return []
    if len(clean_ids) > 20:
        raise Open1688Error("单次最多查询 20 个严选商品详情")
    status = configuration_status()
    if not status["configured"]:
        raise Open1688Error(status["message"])
    stored = _config()
    app_key = (stored.get("app_key") or os.environ.get("OPEN1688_APP_KEY", "")).strip()
    secret = (stored.get("app_secret") or os.environ.get("OPEN1688_APP_SECRET", "")).strip()
    token = (stored.get("access_token") or os.environ.get("OPEN1688_ACCESS_TOKEN", "")).strip()
    path = f"param2/2/com.alibaba.fenxiao/alibaba.pifatuan.product.detail.list/{app_key}"
    params = {"access_token": token, "offerIds": clean_ids}
    params["_aop_signature"] = sign_path(path, params, secret)
    with httpx.Client(timeout=30, transport=transport) as client:
        response = client.post(
            f"https://gw.open.1688.com/openapi/{path}",
            data={key: _stringify(value) for key, value in params.items()},
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise Open1688Error(f"1688 商品详情返回了非 JSON 响应（HTTP {response.status_code}）") from exc
    error = payload.get("error_message") or payload.get("errorMessage") or payload.get("exception")
    if response.status_code >= 400 or error:
        raise Open1688Error(str(error or f"1688 HTTP {response.status_code}"))
    return _items(payload)

def intelligent_generate_title(image_url: str, cat_id: int | str, *, transport=None) -> dict[str, Any]:
    """Backward-compatible import shim for the isolated integration."""
    from app.integrations.image_product_intelligent import generate

    try:
        return generate(image_url, cat_id, transport=transport)
    except Exception as exc:
        raise Open1688Error(str(exc)) from exc


def _positive_number(value: Any) -> float | None:
    number = _number(value)
    return number if number > 0 else None


def detail_to_capture(detail: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Translate an official product detail into the existing collection contract."""
    product = detail.get("productInfo") if isinstance(detail.get("productInfo"), dict) else detail
    offer_id = str(_first(product, "productID", "productId", "offerId", "id"))
    images_node = product.get("image") if isinstance(product.get("image"), dict) else {}
    images = images_node.get("images") or product.get("images") or []
    images = [str(url).strip() for url in images if str(url).strip()] if isinstance(images, list) else []
    shipping = product.get("shippingInfo") if isinstance(product.get("shippingInfo"), dict) else {}
    sale = product.get("saleInfo") if isinstance(product.get("saleInfo"), dict) else {}
    sku_rows = product.get("skuInfos") if isinstance(product.get("skuInfos"), list) else []
    attributes = product.get("attributes") if isinstance(product.get("attributes"), list) else []

    def absolute_image(value: Any) -> str:
        url = str(value or "").strip()
        if url.startswith("//"):
            return "https:" + url
        if url.startswith("img/"):
            return "https://cbu01.alicdn.com/" + url
        return url

    images = [absolute_image(url) for url in images if absolute_image(url)]

    # 1688 separates the five-or-so gallery images from the long-form detail
    # images.  The latter are still product evidence and must be carried in a
    # distinct field so ERP can add them to its public product gallery without
    # treating them as SKU-specific images.
    description_html = str(product.get("description") or "")
    detail_images: list[str] = []
    for raw_url in re.findall(r'''(?is)<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']''', description_html):
        image_url = absolute_image(raw_url)
        if image_url.startswith(("http://", "https://")) and image_url not in images and image_url not in detail_images:
            detail_images.append(image_url)

    product_weight_g = None
    for attribute in attributes:
        if not isinstance(attribute, dict):
            continue
        name = str(attribute.get("attributeName") or attribute.get("name") or "")
        if any(label in name for label in ("毛重", "净重", "重量")):
            raw = str(attribute.get("value") or "").strip()
            value = _positive_number(raw)
            if value:
                # "500g" has no word boundary before g, while "0.5kg" must
                # remain kilograms. Treat a non-letter immediately before g
                # as grams, alongside the Chinese unit.
                product_weight_g = value if re.search(r"克|(?<![a-z])g\b", raw, re.I) else value * 1000
                break

    def dimensions_from_text(text: str) -> tuple[float, float, float] | None:
        patterns = (
            r"长\s*(\d+(?:\.\d+)?)\s*宽\s*(\d+(?:\.\d+)?)\s*高\s*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米)?",
            r"(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米)?",
        )
        for pattern in patterns:
            match = re.search(pattern, text, re.I)
            if match:
                factor = 1 if (match.group(4) or "cm").lower() in ("mm", "毫米") else 10
                return tuple(float(match.group(i)) * factor for i in (1, 2, 3))
        return None

    def attribute_dimensions(rows: list[dict[str, Any]]) -> tuple[float, float, float] | None:
        text = " ".join(
            f"{item.get('attributeName') or item.get('name') or ''} {item.get('attributeValue') or item.get('value') or ''}"
            for item in rows if isinstance(item, dict)
        )
        return dimensions_from_text(text)

    def dims(node: dict[str, Any]) -> dict[str, float | None]:
        package = node.get("packageInfo") if isinstance(node.get("packageInfo"), dict) else {}
        sources = (node, package, shipping, product)
        aliases = {
            "weightG": ("weightG", "weight", "unitWeight", "packageWeight"),
            "lengthMm": ("lengthMm", "length", "packageLength"),
            "widthMm": ("widthMm", "width", "packageWidth"),
            "heightMm": ("heightMm", "height", "packageHeight"),
        }
        found = {}
        for target, keys in aliases.items():
            value = None
            for source in sources:
                value = _positive_number(_first(source, *keys))
                if value:
                    break
            found[target] = value
        if not found["weightG"] and product_weight_g:
            found["weightG"] = product_weight_g
        parsed = attribute_dimensions(node.get("attributes") if isinstance(node.get("attributes"), list) else attributes)
        if parsed:
            for key, value in zip(("lengthMm", "widthMm", "heightMm"), parsed):
                if not found[key]:
                    found[key] = value
        return found

    variants = []
    for index, sku in enumerate(sku_rows):
        if not isinstance(sku, dict):
            continue
        package = dims(sku)
        sku_attributes = sku.get("attributes") if isinstance(sku.get("attributes"), list) else []
        for attribute in sku_attributes:
            if not isinstance(attribute, dict):
                continue
            parsed = dimensions_from_text(str(attribute.get("attributeValue") or attribute.get("value") or ""))
            if parsed:
                package["lengthMm"], package["widthMm"], package["heightMm"] = parsed
                break
        variants.append({
            "skuId": str(_first(sku, "skuId", "skuID", "specId") or f"sku-{index + 1}"),
            "spec": str(_first(sku, "specAttrs", "attributes", "specName", "skuName") or f"规格 {index + 1}"),
            "price": _positive_number(_first(sku, "price", "discountPrice", "pifaPrice", "consignPrice", "multipleConsignPrice")),
            "stock": int(_number(_first(sku, "amountOnSale", "stock", "canBookCount"))),
            "image": absolute_image(_first(sku, "imageUrl", "image", "skuImageUrl") or next((a.get("skuImageUrl") for a in sku_attributes if isinstance(a, dict) and a.get("skuImageUrl")), "")),
            **package,
        })
    product_package = dims(product)
    complete_variants = [row for row in variants if all(row.get(key) for key in ("weightG", "lengthMm", "widthMm", "heightMm"))]
    has_complete_package = all(product_package.values()) or bool(complete_variants)
    capture = {
        "offerId": offer_id,
        "title": str(_first(product, "subject", "title") or f"1688 商品 {offer_id}"),
        "url": f"https://detail.1688.com/offer/{offer_id}.html",
        "images": images,
        "detailImages": detail_images,
        "skuVariants": variants,
        "packageInfo": product_package,
        "attributes": attributes,
        "description": description_html,
        "supplier": detail.get("wangwangAccount") or "",
        "price": _positive_number(_first(sale, "price", "minPrice", "referencePrice", "priceRanges")),
        "sources": {"kind": "open1688_jxhy", "official_api": True},
    }
    # Official Pifatuan details expose the product video as mainVedio
    # (historical spelling) and often expose SKU prices as pifaPrice or
    # consignPrice rather than the generic price field.
    video_url = str(_first(product, "mainVedio", "mainVideo", "videoUrl") or "").strip()
    if video_url:
        capture["video"] = {"url": video_url, "sourceUrl": video_url}
    return capture, {
        "offer_id": offer_id,
        "has_complete_package": has_complete_package,
        "product_package": product_package,
        "variant_count": len(variants),
        "complete_variant_count": len(complete_variants),
    }
