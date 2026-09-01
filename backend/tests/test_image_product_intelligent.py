import json
from urllib.parse import parse_qs

import httpx
import pytest

from app.integrations import image_product_intelligent as module


def test_credentials_are_isolated_and_encrypted(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "CONFIG_FILE", tmp_path / "image_product_intelligent.json")
    module.save_application("4663405", "app-secret-value")
    module.save_access_token("author-token-value")
    stored = module.CONFIG_FILE.read_text("utf-8")
    assert "app-secret-value" not in stored
    assert "author-token-value" not in stored
    status = module.configuration_status()
    assert status["configured"] is True
    assert "author-token-value" not in json.dumps(status)


def test_generate_uses_documented_endpoint_and_preserves_result(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "CONFIG_FILE", tmp_path / "image_product_intelligent.json")
    module.save_application("4663405", "app-secret-value")
    module.save_access_token("author-token-value")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path.endswith("/param2/1/com.alibaba.image/image.product.intelligent.generate/4663405")
        form = parse_qs(request.content.decode())
        assert form["imageUrl"] == ["https://img.example/product.jpg"]
        assert form["catId"] == ["1031910"]
        assert form["access_token"] == ["author-token-value"]
        assert form["_aop_signature"]
        return httpx.Response(200, json={"result": {
            "offerCPV": {"featureValues": [{"fid": 321, "name": "颜色", "value": "白色", "vid": 28320}]},
            "points": ["轻便", "耐用"],
            "subjects": ["白色轻便商品"],
        }})

    result = module.generate("https://img.example/product.jpg", 1031910, transport=httpx.MockTransport(handler))
    assert result["points"] == ["轻便", "耐用"]
    assert result["subjects"] == ["白色轻便商品"]
    assert result["offer_cpv"]["featureValues"][0]["vid"] == 28320


def test_generate_rejects_invalid_image_before_http(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "CONFIG_FILE", tmp_path / "image_product_intelligent.json")
    module.save_application("4663405", "app-secret-value")
    module.save_access_token("author-token-value")
    with pytest.raises(module.ImageProductIntelligentError, match="HTTP"):
        module.generate("not-an-image", 1031910)


def test_authorization_url_is_scoped_to_this_app(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "CONFIG_FILE", tmp_path / "image_product_intelligent.json")
    module.save_application("4663405", "app-secret-value")
    url = module.begin_authorization()
    assert "client_id=4663405" in url
    assert "redirect_uri=" in url
    assert module._config()["authorization_state"]


def test_authorization_accepts_any_recent_state_and_fragment_callback(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "CONFIG_FILE", tmp_path / "image_product_intelligent.json")
    module.save_application("4663405", "app-secret-value")
    first_url = module.begin_authorization()
    second_url = module.begin_authorization()
    first_state = parse_qs(first_url.split("?", 1)[1])["state"][0]
    second_state = parse_qs(second_url.split("?", 1)[1])["state"][0]
    assert first_state != second_state

    def handler(request: httpx.Request) -> httpx.Response:
        body = parse_qs(request.content.decode())
        assert body["code"] == ["first-code"]
        return httpx.Response(200, json={"access_token": "saved-token"})

    callback = f"https://auth.1688.com/auth/authCode.htm?success=1#code=first-code&state={first_state}"
    module.exchange_code(callback, transport=httpx.MockTransport(handler))
    assert [item["value"] for item in module._config()["authorization_states"]] == [second_state]


def test_changing_application_clears_old_authorization_state(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "CONFIG_FILE", tmp_path / "image_product_intelligent.json")
    module.save_application("4663405", "first-secret")
    module.begin_authorization()
    module.save_application("9999999", "second-secret")
    config = module._config()
    assert config["authorization_state"] == ""
    assert config["authorization_states"] == []
    assert not config.get("access_token")


def test_provider_authorization_error_is_actionable(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "CONFIG_FILE", tmp_path / "image_product_intelligent.json")
    module.save_application("4663405", "app-secret-value")
    module.save_access_token("author-token-value")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"error": "Request need user authorized"})

    with pytest.raises(module.ImageProductIntelligentError, match="4663405.*重新 author 授权"):
        module.generate("https://img.example/product.jpg", 1031910, transport=httpx.MockTransport(handler))
