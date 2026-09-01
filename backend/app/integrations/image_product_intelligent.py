"""1688 商品智能标题及卖点推荐 OpenAPI integration.

This capability has its own credential store.  It must not reuse the JXHY
application because the two applications can have different author grants
and quota policies.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from app.security import decrypt_secret, encrypt_secret


CONFIG_FILE = Path(".local-secrets/image_product_intelligent.json")
GATEWAY_URL = "https://gw.open.1688.com/openapi/{path}"
AUTHORIZE_URL = "https://auth.1688.com/auth/authorize.htm"
DEFAULT_REDIRECT_URI = "https://auth.1688.com/auth/authCode.htm"
AUTH_STATE_TTL_SECONDS = 15 * 60


class ImageProductIntelligentError(RuntimeError):
    pass


def _config() -> dict[str, str]:
    raw = json.loads(CONFIG_FILE.read_text("utf-8")) if CONFIG_FILE.exists() else {}
    for field in ("app_secret", "access_token"):
        if raw.get(field):
            raw[field] = decrypt_secret(raw[field])
    return raw


def save_application(app_key: str, app_secret: str) -> None:
    app_key = str(app_key or "").strip()
    app_secret = str(app_secret or "").strip()
    if not app_key or not app_secret:
        raise ImageProductIntelligentError("AppKey 和 AppSecret 不能为空")
    current = _config()
    same_app = str(current.get("app_key") or "").strip() == app_key
    state_records = current.get("authorization_states") if same_app and isinstance(current.get("authorization_states"), list) else []
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps({
        "app_key": app_key,
        "app_secret": encrypt_secret(app_secret),
        "access_token": encrypt_secret(current["access_token"]) if same_app and current.get("access_token") else "",
        "redirect_uri": current.get("redirect_uri") or DEFAULT_REDIRECT_URI,
        "authorization_state": current.get("authorization_state") if same_app else "",
        "authorization_states": state_records,
    }, ensure_ascii=False, indent=2), "utf-8")


def save_access_token(access_token: str) -> None:
    value = str(access_token or "").strip()
    if not value:
        raise ImageProductIntelligentError("AccessToken 不能为空")
    if not CONFIG_FILE.exists():
        raise ImageProductIntelligentError("请先保存商品智能标题的 AppKey 和 AppSecret")
    raw = json.loads(CONFIG_FILE.read_text("utf-8"))
    raw["access_token"] = encrypt_secret(value)
    CONFIG_FILE.write_text(json.dumps(raw, ensure_ascii=False, indent=2), "utf-8")


def begin_authorization() -> str:
    current = _config()
    if not current.get("app_key") or not current.get("app_secret"):
        raise ImageProductIntelligentError("请先保存商品智能标题的 AppKey 和 AppSecret")
    state = secrets.token_urlsafe(24)
    raw = json.loads(CONFIG_FILE.read_text("utf-8"))
    now = int(time.time())
    previous = raw.get("authorization_states") if isinstance(raw.get("authorization_states"), list) else []
    records = []
    for item in previous:
        if isinstance(item, dict):
            value, created_at = str(item.get("value") or ""), int(item.get("created_at") or 0)
        else:
            value, created_at = str(item or ""), now
        if value and now - created_at <= AUTH_STATE_TTL_SECONDS:
            records.append({"value": value, "created_at": created_at})
    records.append({"value": state, "created_at": now})
    raw["authorization_states"] = records[-5:]
    raw["authorization_state"] = state
    raw.setdefault("redirect_uri", DEFAULT_REDIRECT_URI)
    CONFIG_FILE.write_text(json.dumps(raw, ensure_ascii=False, indent=2), "utf-8")
    return AUTHORIZE_URL + "?" + urlencode({
        "client_id": current["app_key"],
        "site": "1688",
        "redirect_uri": raw["redirect_uri"],
        "state": state,
    })


def exchange_code(code_or_url: str, *, state: str = "", transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    current = _config()
    if not current.get("app_key") or not current.get("app_secret"):
        raise ImageProductIntelligentError("请先保存商品智能标题的 AppKey 和 AppSecret")
    raw = json.loads(CONFIG_FILE.read_text("utf-8")) if CONFIG_FILE.exists() else {}
    value = str(code_or_url or "").strip()
    callback_state = str(state or "").strip()
    if "://" in value:
        parsed = urlparse(value)
        query = parse_qs(parsed.query)
        fragment = parse_qs(parsed.fragment.lstrip("?#")) if parsed.fragment else {}
        # Providers may place code/state in either component, or split them
        # across both. Query values take precedence when duplicated.
        callback_params = {**fragment, **query}
        value = callback_params.get("code", [""])[0]
        callback_state = callback_state or callback_params.get("state", [""])[0]
    if not value:
        raise ImageProductIntelligentError("授权回调未包含 code")
    now = int(time.time())
    records = raw.get("authorization_states") if isinstance(raw.get("authorization_states"), list) else []
    if not records and raw.get("authorization_state"):
        records = [{"value": str(raw.get("authorization_state")), "created_at": now}]
    valid_records = []
    matched = False
    for item in records:
        if isinstance(item, dict):
            expected_state, created_at = str(item.get("value") or ""), int(item.get("created_at") or 0)
        else:
            expected_state, created_at = str(item or ""), now
        if not expected_state or now - created_at > AUTH_STATE_TTL_SECONDS:
            continue
        if callback_state and secrets.compare_digest(expected_state, callback_state):
            matched = True
            continue
        valid_records.append({"value": expected_state, "created_at": created_at})
    if not matched:
        raise ImageProductIntelligentError("授权 state 不匹配，请从授权中心重新打开授权页")
    form = {
        "grant_type": "authorization_code",
        "need_refresh_token": "true",
        "client_id": current["app_key"],
        "client_secret": current["app_secret"],
        "redirect_uri": raw.get("redirect_uri") or DEFAULT_REDIRECT_URI,
        "code": value,
    }
    token_url = f"https://gw.open.1688.com/openapi/http/1/system.oauth2/getToken/{current['app_key']}"
    with httpx.Client(timeout=20, transport=transport) as client:
        response = client.post(token_url, data=form)
    try:
        payload = response.json()
    except ValueError as exc:
        raise ImageProductIntelligentError(f"授权换取 Token 返回非 JSON（HTTP {response.status_code}）") from exc
    token = payload.get("access_token") or payload.get("accessToken")
    if response.status_code >= 400 or not token:
        raise ImageProductIntelligentError(str(payload.get("error_description") or payload.get("error") or payload))
    raw["access_token"] = encrypt_secret(str(token))
    refresh = payload.get("refresh_token") or payload.get("refreshToken")
    if refresh:
        raw["refresh_token"] = encrypt_secret(str(refresh))
    raw["authorization_states"] = valid_records
    raw["authorization_state"] = valid_records[-1]["value"] if valid_records else ""
    CONFIG_FILE.write_text(json.dumps(raw, ensure_ascii=False, indent=2), "utf-8")
    return {"ok": True, "has_refresh_token": bool(refresh), "expires_in": payload.get("expires_in") or payload.get("expiresIn")}


def configuration_status() -> dict[str, Any]:
    current = _config()
    app_key = (current.get("app_key") or os.getenv("IMAGE_PRODUCT_INTELLIGENT_APP_KEY", "")).strip()
    missing = [name for name, value in (
        ("AppKey", app_key),
        ("AppSecret", current.get("app_secret") or os.getenv("IMAGE_PRODUCT_INTELLIGENT_APP_SECRET", "").strip()),
        ("AccessToken", current.get("access_token") or os.getenv("IMAGE_PRODUCT_INTELLIGENT_ACCESS_TOKEN", "").strip()),
    ) if not value]
    return {
        "configured": not missing,
        "app_key": app_key,
        "missing": missing,
        "message": "商品智能标题接口已配置" if not missing else f"商品智能标题接口缺少：{'、'.join(missing)}",
    }


def _stringify(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return "" if value is None else str(value)


def sign_path(path: str, params: dict[str, Any], secret: str) -> str:
    base = "".join(f"{key}{_stringify(params[key])}" for key in sorted(params))
    return hmac.new(secret.encode("utf-8"), f"{path}{base}".encode("utf-8"), hashlib.sha1).hexdigest().upper()


def generate(image_url: str, cat_id: int | str, *, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    status = configuration_status()
    if not status["configured"]:
        raise ImageProductIntelligentError(status["message"])
    image_url = str(image_url or "").strip()
    if not image_url.lower().startswith(("http://", "https://")):
        raise ImageProductIntelligentError("imageUrl 必须是可访问的 HTTP(S) 图片地址")
    try:
        category_id = int(cat_id)
    except (TypeError, ValueError) as exc:
        raise ImageProductIntelligentError("catId 必须是数字") from exc
    if category_id <= 0:
        raise ImageProductIntelligentError("catId 必须大于 0")
    current = _config()
    app_key = (current.get("app_key") or os.getenv("IMAGE_PRODUCT_INTELLIGENT_APP_KEY", "")).strip()
    secret = (current.get("app_secret") or os.getenv("IMAGE_PRODUCT_INTELLIGENT_APP_SECRET", "")).strip()
    token = (current.get("access_token") or os.getenv("IMAGE_PRODUCT_INTELLIGENT_ACCESS_TOKEN", "")).strip()
    path = f"param2/1/com.alibaba.image/image.product.intelligent.generate/{app_key}"
    params: dict[str, Any] = {
        "access_token": token,
        "_aop_timestamp": str(int(time.time() * 1000)),
        "imageUrl": image_url,
        "catId": category_id,
    }
    params["_aop_signature"] = sign_path(path, params, secret)
    with httpx.Client(timeout=30, transport=transport) as client:
        response = client.post(GATEWAY_URL.format(path=path), data={k: _stringify(v) for k, v in params.items()})
    try:
        payload = response.json()
    except ValueError as exc:
        raise ImageProductIntelligentError(f"智能标题接口返回非 JSON（HTTP {response.status_code}）") from exc
    if not isinstance(payload, dict):
        raise ImageProductIntelligentError("智能标题接口返回格式无效")
    error = payload.get("error_message") or payload.get("errorMessage") or payload.get("error") or payload.get("exception")
    if response.status_code >= 400 or payload.get("success") is False or error:
        message = str(error or f"1688 HTTP {response.status_code}")
        if "need user authorized" in message.lower() or "user authorized" in message.lower():
            message = "当前 AccessToken 未授权商品智能标题应用（AppKey 4663405），请在授权中心用该 AppKey 重新 author 授权后换取 Token"
        raise ImageProductIntelligentError(message)
    result = payload.get("result") if isinstance(payload.get("result"), dict) else payload
    return {
        "result": result,
        "offer_cpv": result.get("offerCPV") if isinstance(result, dict) else {},
        "points": result.get("points") if isinstance(result, dict) and isinstance(result.get("points"), list) else [],
        "subjects": result.get("subjects") if isinstance(result, dict) and isinstance(result.get("subjects"), list) else [],
    }
