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

    def test_error_statuses_are_classified(self):
        for status_code, error_type in ((401, OzonAuthenticationError), (429, OzonRateLimitError), (500, OzonServerError)):
            with self.subTest(status_code=status_code):
                transport = httpx.MockTransport(lambda request, code=status_code: httpx.Response(code, json={}))
                with OzonSellerClient(client_id="id", api_key="key", transport=transport) as client:
                    with self.assertRaises(error_type):
                        client.list_products()


if __name__ == "__main__":
    unittest.main()
