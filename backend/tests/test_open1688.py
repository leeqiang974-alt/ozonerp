import httpx

from app.integrations.open1688 import detail_to_capture, exchange_code, normalize_candidate, save_application, search_jxhy_products, sign_path


def test_open1688_signature_is_uppercase_and_stable():
    signature = sign_path("param2/1/test/123", {"b": "2", "a": "1"}, "secret")
    assert len(signature) == 40
    assert signature == signature.upper()
    assert signature == sign_path("param2/1/test/123", {"a": "1", "b": "2"}, "secret")


def test_normalize_jxhy_candidate():
    item = normalize_candidate({"offerId": 123, "subject": "测试商品", "priceStart": "3.5", "priceEnd": "6.8"})
    assert item["offer_id"] == "123"
    assert item["title"] == "测试商品"
    assert item["price_min"] == 3.5
    assert item["url"].endswith("/123.html")


def test_search_jxhy_products_uses_official_endpoint(monkeypatch):
    monkeypatch.setenv("OPEN1688_APP_KEY", "4910210")
    monkeypatch.setenv("OPEN1688_APP_SECRET", "secret")
    monkeypatch.setenv("OPEN1688_ACCESS_TOKEN", "token")
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/param2/1/com.alibaba.fenxiao/jxhy.product.getPageList/4910210")
        assert request.url.params["keyword"] == "连衣裙"
        assert request.url.params["_aop_signature"]
        return httpx.Response(200, json={"pageNum": 1, "pageSize": 20, "totalRecords": 1, "result": [{"offerId": 9, "title": "商品九"}]})
    result = search_jxhy_products("连衣裙", transport=httpx.MockTransport(handler))
    assert result["total"] == 1
    assert result["items"][0]["offer_id"] == "9"

def test_exchange_authorization_code_saves_token_encrypted(monkeypatch, tmp_path):
    import app.integrations.open1688 as module
    monkeypatch.setattr(module, "CONFIG_FILE", tmp_path / "open1688.json")
    save_application("4910210", "top-secret", "https://auth.1688.com/auth/authCode.htm")
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/system.oauth2/getToken/4910210")
        body = request.content.decode()
        assert "grant_type=authorization_code" in body and "code=one-time-code" in body
        return httpx.Response(200, json={"access_token":"saved-token","refresh_token":"saved-refresh","expires_in":3600})
    result = exchange_code("one-time-code", transport=httpx.MockTransport(handler))
    stored = module.CONFIG_FILE.read_text("utf-8")
    assert result["has_refresh_token"] is True
    assert "saved-token" not in stored and "top-secret" not in stored


def test_detail_to_capture_extracts_weight_and_sku_dimensions():
    detail = {"productInfo": {"productID": 123, "subject": "收纳箱", "attributes": [
        {"attributeName": "毛重", "value": "1.2"},
    ], "image": {"images": ["img/ibank/main.jpg"]}, "skuInfos": [{
        "skuId": 9, "amountOnSale": 8, "price": 3.5,
        "attributes": [{"attributeName": "尺寸", "attributeValue": "大号【长25宽18高14cm】", "skuImageUrl": "img/ibank/sku.jpg"}],
    }]}}
    capture, package = detail_to_capture(detail)
    assert package["has_complete_package"] is True
    assert package["complete_variant_count"] == 1
    assert capture["images"][0].startswith("https://cbu01.alicdn.com/")
    assert capture["skuVariants"][0]["weightG"] == 1200
    assert capture["skuVariants"][0]["lengthMm"] == 250


def test_detail_to_capture_reads_dimensions_from_product_attributes():
    detail = {"productInfo": {"productID": 124, "subject": "收纳箱", "attributes": [
        {"attributeName": "包装尺寸", "value": "30×20×10cm"}, {"attributeName": "重量", "value": "500g"},
    ], "skuInfos": [{"skuId": 1, "amountOnSale": 5}]}}
    capture, package = detail_to_capture(detail)
    assert capture["packageInfo"] == {"weightG": 500, "lengthMm": 300, "widthMm": 200, "heightMm": 100}
    assert package["has_complete_package"] is True
