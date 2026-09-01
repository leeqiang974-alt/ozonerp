import json
import unittest

import httpx

from app.integrations.ozon_seller import (
    OzonAuthenticationError,
    OzonRateLimitError,
    OzonSellerClient,
    OzonServerError,
)


class OzonSellerClientTests(unittest.TestCase):
    def test_product_list_sends_headers_and_payload(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/v3/product/list")
            self.assertEqual(request.headers["client-id"], "test-client")
            self.assertEqual(request.headers["api-key"], "test-api-key")
            self.assertEqual(json.loads(request.content), {"filter": {"visibility": "ALL"}, "last_id": "cursor", "limit": 50})
            return httpx.Response(200, json={"items": [], "last_id": ""})

        with OzonSellerClient(client_id="test-client", api_key="test-api-key", transport=httpx.MockTransport(handler)) as client:
            response = client.list_products(limit=50, last_id="cursor", filter={"visibility": "ALL"})
        self.assertEqual(response["items"], [])

    def test_fbs_posting_list_is_read_only_documented_endpoint(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/v3/posting/fbs/list")
            self.assertEqual(request.method, "POST")
            self.assertEqual(json.loads(request.content)["filter"]["status"], "awaiting_packaging")
            return httpx.Response(200, json={"result": {"postings": []}})

        with OzonSellerClient(client_id="id", api_key="key", transport=httpx.MockTransport(handler)) as client:
            result = client.list_fbs_postings(
                since="2026-08-01T00:00:00Z", to="2026-08-02T00:00:00Z", status="awaiting_packaging"
            )
        self.assertEqual(result, {"result": {"postings": []}})

    def test_category_tree_and_attributes_use_current_read_only_endpoints(self):
        requests = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append((request.url.path, json.loads(request.content)))
            if request.url.path == "/v1/description-category/tree":
                return httpx.Response(200, json={"result": []})
            return httpx.Response(200, json={"result": [{"id": 1, "name": "品牌", "is_required": True}]})

        with OzonSellerClient(client_id="id", api_key="key", transport=httpx.MockTransport(handler)) as client:
            client.get_category_tree()
            client.get_category_attributes(category_id=17027449, type_id=91613)

        self.assertEqual(
            requests,
            [
                ("/v1/description-category/tree", {"language": "DEFAULT"}),
                (
                    "/v1/description-category/attribute",
                    {"description_category_id": 17027449, "type_id": 91613, "language": "DEFAULT"},
                ),
            ],
        )

    def test_category_attribute_values_use_current_read_only_endpoint(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/v1/description-category/attribute/values")
            self.assertEqual(json.loads(request.content), {
                "attribute_id": 85,
                "description_category_id": 17027449,
                "language": "ZH_HANS",
                "last_value_id": 0,
                "limit": 100,
                "type_id": 91613,
            })
            return httpx.Response(200, json={"result": [{"id": 1, "value": "测试"}], "has_next": False})

        with OzonSellerClient(client_id="id", api_key="key", transport=httpx.MockTransport(handler)) as client:
            response = client.get_category_attribute_values(category_id=17027449, type_id=91613, attribute_id=85, limit=100)
        self.assertEqual(response["result"][0]["value"], "测试")

    def test_category_attribute_value_search_requires_a_query(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/v1/description-category/attribute/values/search")
            self.assertEqual(json.loads(request.content)["value"], "ab")
            return httpx.Response(200, json={"result": [{"id": 1, "value": "ABC"}]})
        with OzonSellerClient(client_id="id", api_key="key", transport=httpx.MockTransport(handler)) as client:
            response = client.search_category_attribute_values(category_id=1, type_id=2, attribute_id=3, value="ab", limit=20)
        self.assertEqual(response["result"][0]["value"], "ABC")

    def test_related_skus_uses_documented_endpoint_and_limit(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/v1/product/related-sku/get")
            self.assertEqual(json.loads(request.content), {"sku": [88997766]})
            return httpx.Response(200, json={"items": [{"sku": 88997766}], "errors": []})

        with OzonSellerClient(client_id="id", api_key="key", transport=httpx.MockTransport(handler)) as client:
            response = client.get_related_skus(skus=[88997766])
            with self.assertRaises(ValueError):
                client.get_related_skus(skus=list(range(201)))
        self.assertEqual(response["items"][0]["sku"], 88997766)

    def test_product_upload_quota_uses_documented_v4_endpoint(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/v4/product/info/limit")
            self.assertEqual(request.method, "POST")
            self.assertEqual(json.loads(request.content), {})
            return httpx.Response(200, json={"daily_create": {"limit": 200, "usage": 12, "reset_at": "2026-08-26T00:00:00Z"}})

        with OzonSellerClient(client_id="id", api_key="key", transport=httpx.MockTransport(handler)) as client:
            response = client.get_product_upload_quota()
        self.assertEqual(response["daily_create"]["limit"] - response["daily_create"]["usage"], 188)

    def test_error_statuses_are_classified(self):
        for status_code, error_type in ((401, OzonAuthenticationError), (429, OzonRateLimitError), (500, OzonServerError)):
            with self.subTest(status_code=status_code):
                transport = httpx.MockTransport(lambda request, code=status_code: httpx.Response(code, json={}))
                with OzonSellerClient(client_id="id", api_key="key", transport=transport) as client:
                    with self.assertRaises(error_type):
                        client.list_products()

    def test_promotion_products_and_deactivate_use_documented_payloads(self):
        requests = []
        def handler(request: httpx.Request) -> httpx.Response:
            requests.append((request.url.path, json.loads(request.content)))
            return httpx.Response(200, json={"result": {"products": [], "last_id": ""}})
        with OzonSellerClient(client_id="id", api_key="key", transport=httpx.MockTransport(handler)) as client:
            client.list_promotion_products(action_id=12, limit=1000, last_id="")
            client.deactivate_promotion_products(action_id=12, product_ids=[101, 202])
        self.assertEqual(requests, [
            ("/v1/actions/products", {"action_id": 12, "limit": 1000, "last_id": ""}),
            ("/v1/actions/products/deactivate", {"action_id": 12, "product_ids": [101, 202]}),
        ])

    def test_fbs_stock_readback_uses_v2_offer_id_payload(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/v2/product/info/stocks-by-warehouse/fbs")
            self.assertEqual(json.loads(request.content), {
                "cursor": "",
                "limit": 1000,
                "offer_id": ["KC000006-A"],
                "sku": [],
            })
            return httpx.Response(200, json={"products": []})

        with OzonSellerClient(client_id="id", api_key="key", transport=httpx.MockTransport(handler)) as client:
            response = client.get_fbs_stocks_by_warehouse(offer_ids=["KC000006-A"])
        self.assertEqual(response, {"products": []})


if __name__ == "__main__":
    unittest.main()
