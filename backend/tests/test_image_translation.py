from app.main import ImageTranslateRequest, translate_images


class FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "Code": 200,
            "Message": "OK",
            "RequestId": "request-123",
            "Data": {"SslUrl": "https://cdn.example.com/translated.jpg"},
        }


def test_xiangji_translation_uses_documented_single_url_api(monkeypatch):
    captured = []

    def fake_post(url, *, params, timeout):
        captured.append((url, params, timeout))
        return FakeResponse()

    monkeypatch.setenv("XIANGJI_PRIVATE_KEY", "user-key")
    monkeypatch.setenv("XIANGJI_IMG_TRANS_KEY", "ali-channel-key")
    monkeypatch.setattr("app.main.httpx.post", fake_post)

    result = translate_images(ImageTranslateRequest(
        urls=["https://source.example.com/a image.jpg?x=1&y=2"],
        source_lang="CHS", target_lang="RUS",
    ))

    assert result["ok"] is True
    assert result["results"][0]["translated_url"] == "https://cdn.example.com/translated.jpg"
    assert result["results"][0]["request_id"] == "request-123"
    url, params, timeout = captured[0]
    assert url == "https://api.tosoiot.com/"
    assert timeout == 120.0
    assert params["Action"] == "GetImageTranslate"
    assert params["Url"] == "https://source.example.com/a image.jpg?x=1&y=2"
    assert params["SourceLanguage"] == "CHS"
    assert params["TargetLanguage"] == "RUS"
    assert params["NeedWatermark"] == "0"
    assert "EngineType" not in params
    assert "Urls" not in params


def test_xiangji_translation_keeps_per_image_failures(monkeypatch):
    monkeypatch.setenv("XIANGJI_PRIVATE_KEY", "user-key")
    monkeypatch.setenv("XIANGJI_IMG_TRANS_KEY", "ali-channel-key")

    result = translate_images(ImageTranslateRequest(urls=["file:///not-public.jpg"]))

    assert result["ok"] is False
    assert "HTTP(S)" in result["results"][0]["error"]
