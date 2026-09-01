import httpx
import pytest
from urllib.parse import parse_qs

import app.main as main
from app.integrations import yunniudun


def test_yunniudun_authorization_is_isolated_and_encrypts_tokens(monkeypatch, tmp_path):
    monkeypatch.setattr(yunniudun, "CONFIG_FILE", tmp_path / "yunniudun.json")
    yunniudun.save_application("yun-app", "secret-value", "http://127.0.0.1:8000/callback")
    url = yunniudun.begin_authorization()
    assert "client_id=yun-app" in url
    state = yunniudun._config()["authorization_state"]

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/system.oauth2/getToken/yun-app")
        assert b"grant_type=authorization_code" in request.content
        return httpx.Response(200, json={"access_token": "token-value", "refresh_token": "refresh-value", "expires_in": 3600})

    result = yunniudun.exchange_code("code-value", state=state, transport=httpx.MockTransport(handler))
    stored = yunniudun.CONFIG_FILE.read_text("utf-8")
    assert result["has_refresh_token"] is True
    assert "secret-value" not in stored and "token-value" not in stored and "refresh-value" not in stored
    assert yunniudun.configuration_status()["configured"] is True


def test_yunniudun_rejects_callback_with_wrong_state(monkeypatch, tmp_path):
    monkeypatch.setattr(yunniudun, "CONFIG_FILE", tmp_path / "yunniudun.json")
    yunniudun.save_application("yun-app", "secret-value", "http://127.0.0.1:8000/callback")
    yunniudun.begin_authorization()
    try:
        yunniudun.exchange_code("code-value", state="wrong")
    except yunniudun.YunNewtonError as exc:
        assert "state" in str(exc)
    else:
        raise AssertionError("wrong OAuth state must be rejected")


def test_yunniudun_can_encrypt_an_existing_author_token(monkeypatch, tmp_path):
    monkeypatch.setattr(yunniudun, "CONFIG_FILE", tmp_path / "yunniudun.json")
    yunniudun.save_application("yun-app", "secret-value", "https://auth.1688.com/auth/authCode.htm")
    yunniudun.save_existing_access_token("existing-author-token")
    stored = yunniudun.CONFIG_FILE.read_text("utf-8")
    assert "existing-author-token" not in stored
    status = yunniudun.configuration_status()
    assert status["configured"] is True
    assert "existing-author-token" not in str(status)


def test_yunniudun_token_probe_only_calls_documented_task_get(monkeypatch, tmp_path):
    monkeypatch.setattr(yunniudun, "CONFIG_FILE", tmp_path / "yunniudun.json")
    yunniudun.save_application("yun-app", "secret-value", "https://auth.1688.com/auth/authCode.htm")
    yunniudun.save_existing_access_token("existing-author-token")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path.endswith("/com.alibaba.agent/newtoncloud.task.get/yun-app")
        form = parse_qs(request.content.decode())
        assert form["taskId"][0].startswith("erp-auth-probe-")
        assert form["fromIndex"] == ["0"]
        assert form["includeBlocks"] == ["true"]
        assert form["_aop_signature"][0]
        return httpx.Response(200, json={"success": False, "errorCode": "TASK_NOT_FOUND"})

    result = yunniudun.validate_existing_access_token(transport=httpx.MockTransport(handler))
    assert result == {
        "checked": True,
        "authorized": True,
        "provider_code": "TASK_NOT_FOUND",
        "message": "云牛顿已接受授权（仅执行不存在任务的只读查询）",
    }


def test_yunniudun_create_uses_documented_form_fields_and_returns_ids(monkeypatch, tmp_path):
    monkeypatch.setattr(yunniudun, "CONFIG_FILE", tmp_path / "yunniudun.json")
    yunniudun.save_application("yun-app", "secret-value", "https://auth.1688.com/auth/authCode.htm")
    yunniudun.save_existing_access_token("existing-author-token")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path.endswith("/com.alibaba.agent/newtoncloud.task.create/yun-app")
        form = parse_qs(request.content.decode())
        assert form["message"] == ["只读采集商品链接"]
        assert form["auto"] == ["true"]
        assert form["access_token"] == ["existing-author-token"]
        assert form["_aop_timestamp"]
        assert form["_aop_signature"]
        return httpx.Response(200, json={"success": True, "taskId": "task-1", "sessionId": "session-1", "status": "INIT"})

    result = yunniudun.create_read_only_task("只读采集商品链接", transport=httpx.MockTransport(handler))
    assert result["taskId"] == "task-1"
    assert result["sessionId"] == "session-1"
    assert result["status"] == "INIT"


def test_yunniudun_create_surfaces_provider_error_code(monkeypatch, tmp_path):
    monkeypatch.setattr(yunniudun, "CONFIG_FILE", tmp_path / "yunniudun.json")
    yunniudun.save_application("yun-app", "secret-value", "https://auth.1688.com/auth/authCode.htm")
    yunniudun.save_existing_access_token("existing-author-token")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"success": False, "errorCode": "RATE_LIMIT_DAILY", "error": "daily limit"})

    with pytest.raises(yunniudun.YunNewtonError, match="RATE_LIMIT_DAILY"):
        yunniudun.create_read_only_task("只读采集商品链接", transport=httpx.MockTransport(handler))


def test_yunniudun_get_parses_incremental_chunks_and_cursor(monkeypatch, tmp_path):
    monkeypatch.setattr(yunniudun, "CONFIG_FILE", tmp_path / "yunniudun.json")
    yunniudun.save_application("yun-app", "secret-value", "https://auth.1688.com/auth/authCode.htm")
    yunniudun.save_existing_access_token("existing-author-token")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/com.alibaba.agent/newtoncloud.task.get/yun-app")
        form = parse_qs(request.content.decode())
        assert form["taskId"] == ["task-1"]
        assert form["fromIndex"] == ["12"]
        assert form["includeBlocks"] == ["true"]
        return httpx.Response(200, json={
            "success": True,
            "taskId": "task-1",
            "sessionId": "session-1",
            "status": "END",
            "nextIndex": 25,
            "chunks": '[{"type":"text","content":"{\\"offerId\\":\\"822581032243\\",\\"title\\":\\"帽子\\"}"}]',
            "messages": [],
        })

    result = yunniudun.get_task("task-1", from_index=12, transport=httpx.MockTransport(handler))
    assert result["nextIndex"] == 25
    assert result["status"] == "END"
    assert result["chunks"][0]["type"] == "text"


def test_yunniudun_task_list_uses_documented_paging(monkeypatch, tmp_path):
    monkeypatch.setattr(yunniudun, "CONFIG_FILE", tmp_path / "yunniudun.json")
    yunniudun.save_application("yun-app", "secret-value", "https://auth.1688.com/auth/authCode.htm")
    yunniudun.save_existing_access_token("existing-author-token")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/com.alibaba.agent/newtoncloud.task.list/yun-app")
        form = parse_qs(request.content.decode())
        assert form["pageNo"] == ["2"]
        assert form["pageSize"] == ["20"]
        assert form["access_token"] == ["existing-author-token"]
        return httpx.Response(200, json={"success": True, "data": [{"taskId": "task-2", "status": "END"}], "total": 21})

    result = yunniudun.list_tasks(page_no=2, page_size=20, transport=httpx.MockTransport(handler))
    assert result["total"] == 21
    assert result["data"][0]["taskId"] == "task-2"


def test_yunniudun_fetch_parses_nested_complex_table(monkeypatch, tmp_path):
    monkeypatch.setattr(yunniudun, "CONFIG_FILE", tmp_path / "yunniudun.json")
    yunniudun.save_application("yun-app", "secret-value", "https://auth.1688.com/auth/authCode.htm")
    yunniudun.save_existing_access_token("existing-author-token")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/com.alibaba.agent/newtoncloud.task.fetch/yun-app")
        form = parse_qs(request.content.decode())
        assert form["taskId"] == ["task-1"]
        assert form["id"] == ["table-1"]
        assert form["scene"] == ["newton"]
        assert form["subScene"] == ["purchase"]
        assert form["stage"] == ["recall"]
        assert form["pageNo"] == ["1"]
        assert form["pageSize"] == ["10"]
        return httpx.Response(200, json={"result": {"success": True, "data": {
            "result": [{"itemId": "822581032243", "title": "帽子", "imageUrl": "https://img.example/a.jpg"}],
            "total": 1,
            "fieldSpec": [{"key": "itemId", "type": "string"}],
        }}})

    result = yunniudun.fetch_task_table("task-1", "table-1", transport=httpx.MockTransport(handler))
    assert result["total"] == 1
    assert result["data"][0]["itemId"] == "822581032243"
    assert result["fieldSpec"][0]["key"] == "itemId"


def test_yunniudun_model_list_returns_provider_tiers(monkeypatch, tmp_path):
    monkeypatch.setattr(yunniudun, "CONFIG_FILE", tmp_path / "yunniudun.json")
    yunniudun.save_application("yun-app", "secret-value", "https://auth.1688.com/auth/authCode.htm")
    yunniudun.save_existing_access_token("existing-author-token")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/com.alibaba.agent/newtoncloud.model.list/yun-app")
        form = parse_qs(request.content.decode())
        assert "access_token" in form and "_aop_signature" in form
        return httpx.Response(200, json={"success": True, "models": [{"id": "flagship", "displayName": "旗舰"}]})

    result = yunniudun.list_models(transport=httpx.MockTransport(handler))
    assert result["models"] == [{"id": "flagship", "displayName": "旗舰"}]


def test_yunniudun_token_endpoint_never_reflects_token(monkeypatch):
    received = []
    monkeypatch.setattr(main, "save_yunniudun_access_token", received.append)
    monkeypatch.setattr(main, "yunniudun_status", lambda: {"configured": True, "missing": []})
    result = main.put_yunniudun_access_token(main.YunNewtonAccessTokenWrite(access_token="secret-token-value"))
    assert received == ["secret-token-value"]
    assert result == {"ok": True, "status": {"configured": True, "missing": []}}
    assert "secret-token-value" not in str(result)
    with pytest.raises(main.HTTPException) as exc:
        main.put_yunniudun_access_token(main.YunNewtonAccessTokenWrite(access_token="short"))
    assert "short" not in str(exc.value.detail)


def test_yunniudun_supplement_routes_are_local_task_endpoints():
    paths = {route.path for route in main.app.routes}
    assert "/api/v1/yunniudun/supplements" in paths
    assert "/api/v1/yunniudun/validate" in paths
