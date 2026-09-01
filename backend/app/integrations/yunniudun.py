"""Read-only 1688 Yun Newton OpenAPI integration.

Yun Newton is kept separate from the existing JXHY/Fenxiao application so
installing its AppKey never replaces the working JXHY token. Task creation is
available only to the explicitly confirmed link-supplement flow; task listing,
incremental task reads and result-table reads are read-only operations. This
module never resumes a task, sends an inquiry, places an order or publishes to
Ozon.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from app.security import decrypt_secret, encrypt_secret


CONFIG_FILE = Path(".local-secrets/yunniudun.json")
AUTHORIZE_URL = "https://auth.1688.com/auth/authorize.htm"
TOKEN_URL_TEMPLATE = "https://gw.open.1688.com/openapi/http/1/system.oauth2/getToken/{app_key}"
GATEWAY_URL = "https://gw.open.1688.com/openapi/{path}"


class YunNewtonError(RuntimeError):
    pass


def _config() -> dict[str, str]:
    raw = json.loads(CONFIG_FILE.read_text("utf-8")) if CONFIG_FILE.exists() else {}
    for field in ("app_secret", "access_token", "refresh_token"):
        if raw.get(field):
            raw[field] = decrypt_secret(raw[field])
    return raw


def save_application(app_key: str, app_secret: str, redirect_uri: str) -> None:
    """Persist the app independently, encrypting every secret at rest."""
    current = _config()
    data = {
        "app_key": app_key.strip(),
        "redirect_uri": redirect_uri.strip(),
        "app_secret": encrypt_secret(app_secret.strip()),
        "access_token": encrypt_secret(current["access_token"]) if current.get("access_token") else "",
        "refresh_token": encrypt_secret(current["refresh_token"]) if current.get("refresh_token") else "",
        "authorization_state": "",
    }
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")


def begin_authorization() -> str:
    """Create a one-time state and return the Alibaba author URL."""
    current = _config()
    if not current.get("app_key") or not current.get("app_secret"):
        raise YunNewtonError("请先配置云牛顿 AppKey 和 AppSecret")
    state = secrets.token_urlsafe(24)
    stored = json.loads(CONFIG_FILE.read_text("utf-8"))
    stored["authorization_state"] = state
    CONFIG_FILE.write_text(json.dumps(stored, ensure_ascii=False, indent=2), "utf-8")
    return AUTHORIZE_URL + "?" + urlencode({
        "client_id": current["app_key"],
        "site": "1688",
        "redirect_uri": current["redirect_uri"],
        "state": state,
    })


def save_existing_access_token(access_token: str) -> None:
    """Store an operator-provided already-authorized token without exposing it.

    This supports an existing Alibaba author grant such as the user's
    ``piggary`` authorization.  Verification is a separate read-only API call;
    saving it does not claim that a task API has accepted the token.
    """
    value = str(access_token or "").strip()
    if not value:
        raise YunNewtonError("AccessToken 不能为空")
    if not CONFIG_FILE.exists():
        raise YunNewtonError("请先配置云牛顿 AppKey 和 AppSecret")
    raw = json.loads(CONFIG_FILE.read_text("utf-8"))
    raw["access_token"] = encrypt_secret(value)
    raw["authorization_state"] = ""
    CONFIG_FILE.write_text(json.dumps(raw, ensure_ascii=False, indent=2), "utf-8")


def exchange_code(code_or_url: str, *, state: str = "", transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """Exchange an authorized callback code and encrypt the returned tokens."""
    current = _config()
    raw_config = json.loads(CONFIG_FILE.read_text("utf-8")) if CONFIG_FILE.exists() else {}
    value = str(code_or_url or "").strip()
    callback_state = state.strip()
    if "://" in value:
        query = parse_qs(urlparse(value).query)
        value = query.get("code", [""])[0]
        callback_state = callback_state or query.get("state", [""])[0]
    expected_state = str(raw_config.get("authorization_state") or "")
    if not value:
        raise YunNewtonError("授权回调未包含 code")
    if not expected_state or not secrets.compare_digest(expected_state, callback_state):
        raise YunNewtonError("授权 state 不匹配，请从 ERP 重新打开授权页")
    form = {
        "grant_type": "authorization_code",
        "need_refresh_token": "true",
        "client_id": current["app_key"],
        "client_secret": current["app_secret"],
        "redirect_uri": current["redirect_uri"],
        "code": value,
    }
    with httpx.Client(timeout=20, transport=transport) as client:
        response = client.post(TOKEN_URL_TEMPLATE.format(app_key=current["app_key"]), data=form)
    try:
        payload = response.json()
    except ValueError as exc:
        raise YunNewtonError(f"授权换取 Token 返回非 JSON（HTTP {response.status_code}）") from exc
    token = payload.get("access_token") or payload.get("accessToken")
    if response.status_code >= 400 or not token:
        raise YunNewtonError(str(payload.get("error_description") or payload.get("error") or payload))
    raw_config["access_token"] = encrypt_secret(str(token))
    refresh = payload.get("refresh_token") or payload.get("refreshToken")
    if refresh:
        raw_config["refresh_token"] = encrypt_secret(str(refresh))
    raw_config["authorization_state"] = ""
    CONFIG_FILE.write_text(json.dumps(raw_config, ensure_ascii=False, indent=2), "utf-8")
    return {"ok": True, "has_refresh_token": bool(refresh), "expires_in": payload.get("expires_in") or payload.get("expiresIn")}


def configuration_status() -> dict[str, Any]:
    current = _config()
    missing = [name for name, value in (
        ("AppKey", current.get("app_key")),
        ("AppSecret", current.get("app_secret")),
        ("AccessToken", current.get("access_token")),
    ) if not value]
    return {
        "configured": not missing,
        "app_key": current.get("app_key", ""),
        "missing": missing,
        "message": "云牛顿已授权" if not missing else f"云牛顿缺少：{'、'.join(missing)}",
    }


def _sign_path(path: str, params: dict[str, str], secret: str) -> str:
    """Apply the standard 1688 OpenAPI HMAC-SHA1 form signature."""
    payload = "".join(f"{key}{params[key]}" for key in sorted(params))
    return hmac.new(secret.encode("utf-8"), f"{path}{payload}".encode("utf-8"), hashlib.sha1).hexdigest().upper()


def validate_existing_access_token(*, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """Check authorization using only ``newtoncloud.task.get``.

    The generated task ID is never created.  A task-not-found response proves
    that the OpenAPI signature and token reached the account boundary, while
    an authentication response is returned as an authorization failure.  The
    raw response is deliberately not surfaced because it may contain provider
    trace metadata.
    """
    status = configuration_status()
    if not status["configured"]:
        raise YunNewtonError(status["message"])
    current = _config()
    app_key = current["app_key"]
    path = f"param2/1/com.alibaba.agent/newtoncloud.task.get/{app_key}"
    params = {
        "access_token": current["access_token"],
        "_aop_timestamp": str(int(time.time() * 1000)),
        "taskId": f"erp-auth-probe-{uuid.uuid4()}",
        "fromIndex": "0",
        "includeBlocks": "true",
    }
    params["_aop_signature"] = _sign_path(path, params, current["app_secret"])
    with httpx.Client(timeout=20, transport=transport) as client:
        response = client.post(GATEWAY_URL.format(path=path), data=params)
    try:
        payload = response.json()
    except ValueError as exc:
        raise YunNewtonError(f"云牛顿授权检查返回非 JSON（HTTP {response.status_code}）") from exc

    provider_code = str(payload.get("errorCode") or payload.get("code") or "").strip()
    error_text = " ".join(str(payload.get(key) or "") for key in (
        "error", "errorMessage", "error_message", "errorCode", "code", "message",
    )).lower()
    auth_terms = ("access_token", "token", "authorize", "auth", "permission", "signature", "sign")
    if response.status_code in (401, 403) or any(term in error_text for term in auth_terms):
        reason = "签名不匹配" if any(term in error_text for term in ("signature", "sign")) else "令牌或授权权限不匹配"
        return {
            "checked": True,
            "authorized": False,
            "reason": reason,
            "provider_code": provider_code,
            "message": "云牛顿未接受当前授权，请重新 author 授权",
        }
    if response.status_code >= 500:
        return {"checked": True, "authorized": None, "provider_code": provider_code, "message": "云牛顿服务暂时不可用，未能判断授权"}
    return {"checked": True, "authorized": True, "provider_code": provider_code, "message": "云牛顿已接受授权（仅执行不存在任务的只读查询）"}


def create_read_only_task(message: str, *, auto: bool = True, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """Create an explicitly requested, collection-only Newton Cloud task.

    Optional provider fields are intentionally omitted until an operator needs
    them.  The supplement prompt itself is the safety boundary: it forbids
    inquiry, ordering, image translation and every other external write.
    """
    status = configuration_status()
    if not status["configured"]:
        raise YunNewtonError(status["message"])
    clean_message = str(message or "").strip()
    if not clean_message:
        raise YunNewtonError("云牛顿任务缺少 message")
    current = _config()
    path = f"param2/1/com.alibaba.agent/newtoncloud.task.create/{current['app_key']}"
    params: dict[str, str] = {
        "access_token": current["access_token"],
        "_aop_timestamp": str(int(time.time() * 1000)),
        "message": clean_message,
        "auto": "true" if auto else "false",
    }
    params["_aop_signature"] = _sign_path(path, params, current["app_secret"])
    with httpx.Client(timeout=30, transport=transport) as client:
        response = client.post(GATEWAY_URL.format(path=path), data=params)
    try:
        payload = response.json()
    except ValueError as exc:
        raise YunNewtonError(f"云牛顿创建任务返回非 JSON（HTTP {response.status_code}）") from exc
    if not isinstance(payload, dict):
        raise YunNewtonError("云牛顿创建任务返回格式无效")
    if response.status_code >= 400 or payload.get("success") is False:
        code = str(payload.get("errorCode") or "").strip()
        error = str(payload.get("error") or payload.get("message") or f"HTTP {response.status_code}").strip()
        raise YunNewtonError(f"{code}: {error}" if code else error)
    if not payload.get("success", True) or not payload.get("taskId"):
        raise YunNewtonError(str(payload.get("error") or payload.get("message") or "云牛顿未返回 taskId"))
    return {
        "success": True,
        "taskId": str(payload.get("taskId")),
        "sessionId": str(payload.get("sessionId") or ""),
        "status": str(payload.get("status") or "INIT"),
        "errorCode": str(payload.get("errorCode") or ""),
        "eagleTraceId": str(payload.get("eagleTraceId") or ""),
    }


def _post_task_api(api_name: str, params: dict[str, str], *, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    status = configuration_status()
    if not status["configured"]:
        raise YunNewtonError(status["message"])
    current = _config()
    path = f"param2/1/com.alibaba.agent/{api_name}/{current['app_key']}"
    signed = dict(params)
    signed.setdefault("access_token", current["access_token"])
    signed.setdefault("_aop_timestamp", str(int(time.time() * 1000)))
    signed["_aop_signature"] = _sign_path(path, signed, current["app_secret"])
    with httpx.Client(timeout=30, transport=transport) as client:
        response = client.post(GATEWAY_URL.format(path=path), data=signed)
    try:
        payload = response.json()
    except ValueError as exc:
        raise YunNewtonError(f"云牛顿 {api_name} 返回非 JSON（HTTP {response.status_code}）") from exc
    if not isinstance(payload, dict):
        raise YunNewtonError(f"云牛顿 {api_name} 返回格式无效")
    if response.status_code >= 400:
        raise YunNewtonError(str(payload.get("error") or payload.get("errorMessage") or f"HTTP {response.status_code}"))
    return payload


def get_task(task_id: str, *, from_index: int = 0, include_blocks: bool = True, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """Read one task incrementally using the documented ``fromIndex`` cursor."""
    value = str(task_id or "").strip()
    if not value:
        raise YunNewtonError("云牛顿查询缺少 taskId")
    payload = _post_task_api("newtoncloud.task.get", {
        "taskId": value,
        "fromIndex": str(max(0, int(from_index))),
        "includeBlocks": "true" if include_blocks else "false",
    }, transport=transport)
    if payload.get("success") is False:
        code = str(payload.get("errorCode") or payload.get("error") or payload.get("errorMessage") or "任务查询失败")
        raise YunNewtonError(code)
    chunks_raw = payload.get("chunks")
    if isinstance(chunks_raw, str):
        try:
            chunks = json.loads(chunks_raw)
        except json.JSONDecodeError:
            chunks = []
    elif isinstance(chunks_raw, list):
        chunks = chunks_raw
    else:
        chunks = []
    try:
        next_index = int(payload.get("nextIndex") or from_index)
    except (TypeError, ValueError):
        next_index = max(0, int(from_index))
    return {
        "success": True,
        "taskId": str(payload.get("taskId") or value),
        "sessionId": str(payload.get("sessionId") or ""),
        "status": str(payload.get("status") or ""),
        "content": payload.get("content") or "",
        "messages": payload.get("messages") if isinstance(payload.get("messages"), list) else [],
        "chunks": chunks,
        "nextIndex": max(0, next_index),
        "outputStatus": str(payload.get("outputStatus") or ""),
        "error": str(payload.get("error") or payload.get("errorMessage") or ""),
        "eagleTraceId": str(payload.get("eagleTraceId") or ""),
        "queuePosition": payload.get("queuePosition"),
        "queueLength": payload.get("queueLength"),
        "finishedAt": payload.get("finishedAt") or "",
    }


def list_tasks(*, page_no: int | None = None, page_size: int | None = None, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """List the current account's Newton tasks without exposing credentials."""
    params: dict[str, str] = {}
    if page_no is not None:
        params["pageNo"] = str(max(1, int(page_no)))
    if page_size is not None:
        params["pageSize"] = str(min(100, max(1, int(page_size))))
    payload = _post_task_api("newtoncloud.task.list", params, transport=transport)
    if payload.get("success") is False:
        raise YunNewtonError(str(payload.get("error") or payload.get("message") or "云牛顿任务列表查询失败"))
    rows = payload.get("data")
    if not isinstance(rows, list):
        rows = []
    return {
        "success": True,
        "data": rows,
        "total": int(payload.get("total") or len(rows)),
        "error": str(payload.get("error") or ""),
        "eagleTraceId": str(payload.get("eagleTraceId") or ""),
    }


def fetch_task_table(
    task_id: str,
    table_id: str,
    *,
    scene: str = "newton",
    sub_scene: str = "purchase",
    stage: str | None = "recall",
    page_no: int = 1,
    page_size: int = 10,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, Any]:
    """Fetch one ``complex_table`` emitted by a completed/paused task."""
    clean_task_id = str(task_id or "").strip()
    clean_table_id = str(table_id or "").strip()
    if not clean_task_id or not clean_table_id:
        raise YunNewtonError("云牛顿表格查询缺少 taskId 或 id")
    params: dict[str, str] = {
        "taskId": clean_task_id,
        "id": clean_table_id,
        "scene": str(scene or "newton"),
        "subScene": str(sub_scene or "purchase"),
        "pageNo": str(max(1, int(page_no))),
        "pageSize": str(min(100, max(1, int(page_size)))),
    }
    if stage:
        params["stage"] = str(stage)
    payload = _post_task_api("newtoncloud.task.fetch", params, transport=transport)
    result = payload.get("result")
    if isinstance(result, dict):
        # The documented response wraps the useful payload in result.data.
        data = result.get("data") if isinstance(result.get("data"), dict) else result
        if result.get("success") is False or (isinstance(data, dict) and data.get("success") is False):
            raise YunNewtonError(str(result.get("message") or result.get("error") or "云牛顿表格查询失败"))
    else:
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    if not isinstance(data, dict):
        data = {}
    rows = data.get("result") if isinstance(data.get("result"), list) else []
    return {
        "success": True,
        "data": rows,
        "total": int(data.get("total") or len(rows)),
        "fieldSpec": data.get("fieldSpec") if isinstance(data.get("fieldSpec"), list) else [],
        "eagleTraceId": str(data.get("eagleTraceId") or payload.get("eagleTraceId") or ""),
    }


def list_models(*, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """Return provider-published model tiers for the task.create ``model`` field."""
    payload = _post_task_api("newtoncloud.model.list", {}, transport=transport)
    if payload.get("success") is False:
        raise YunNewtonError(str(payload.get("error") or payload.get("message") or "云牛顿模型列表查询失败"))
    models = payload.get("models")
    return {
        "success": True,
        "models": models if isinstance(models, list) else [],
        "error": str(payload.get("error") or ""),
        "eagleTraceId": str(payload.get("eagleTraceId") or ""),
    }
