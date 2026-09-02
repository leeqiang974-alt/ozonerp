"""Minimal, read-only client for the Ozon Seller API.

Credentials are injected by the caller at process runtime. This module neither
loads secret files nor logs credential values.
"""

from __future__ import annotations

from typing import Any

import httpx

DEFAULT_BASE_URL = "https://api-seller.ozon.ru"


class OzonSellerError(Exception):
    """Base exception for Ozon Seller API failures."""


class OzonAuthenticationError(OzonSellerError):
    """The Seller API rejected the supplied credentials."""


class OzonRateLimitError(OzonSellerError):
    """The Seller API rate limit was reached."""


class OzonClientResponseError(OzonSellerError):
    """The Seller API rejected a request (other 4xx response)."""


class OzonServerError(OzonSellerError):
    """The Seller API failed while processing a request (5xx response)."""


class OzonTransportError(OzonSellerError):
    """A network or timeout failure occurred before a response was received."""


class OzonSellerClient:
    """Read-only Ozon Seller API client.

    Parameters are intentionally required: credential retrieval and secret
    storage belong to the application boundary, not this integration client.
    """

    def __init__(
        self,
        *,
        client_id: str,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout_seconds: float = 20.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not client_id.strip() or not api_key.strip():
            raise ValueError("client_id and api_key are required")
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Client-Id": client_id, "Api-Key": api_key, "Content-Type": "application/json"},
            timeout=timeout_seconds,
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "OzonSellerClient":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def list_products(
        self,
        *,
        limit: int = 100,
        last_id: str = "",
        filter: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Return a page from the documented Seller product list endpoint."""
        self._validate_limit(limit)
        return self._post("/v3/product/list", {"filter": filter or {}, "last_id": last_id, "limit": limit})

    def list_fbs_postings(
        self,
        *,
        since: str,
        to: str,
        limit: int = 100,
        offset: int = 0,
        status: str = "",
    ) -> dict[str, Any]:
        """Return FBS postings for a time range without modifying seller data."""
        self._validate_limit(limit)
        if offset < 0:
            raise ValueError("offset must be non-negative")
        payload: dict[str, Any] = {
            "dir": "ASC",
            "filter": {"since": since, "to": to, "status": status},
            "limit": limit,
            "offset": offset,
            "with": {"analytics_data": False, "barcodes": False, "financial_data": False},
        }
        return self._post("/v3/posting/fbs/list", payload)

    def get_product_pictures(self, *, product_ids: list[int]) -> dict[str, Any]:
        """Read product images by Ozon product ID; this does not modify seller data."""
        if not product_ids:
            return {"items": []}
        if len(product_ids) > 1000:
            raise ValueError("at most 1000 product IDs can be requested")
        return self._post("/v2/product/pictures/info", {"product_id": product_ids})

    def list_promotions(self) -> dict[str, Any]:
        return self._get("/v1/actions")

    def list_promotion_products(self, *, action_id: int, limit: int = 100, last_id: str = "") -> dict[str, Any]:
        return self._post("/v1/actions/products", {"action_id": action_id, "limit": limit, "last_id": last_id})

    def deactivate_promotion_products(self, *, action_id: int, product_ids: list[int]) -> dict[str, Any]:
        return self._post("/v1/actions/products/deactivate", {"action_id": action_id, "product_ids": product_ids})

    def get_product_info(self, *, product_ids: list[int] | None = None, skus: list[int] | None = None) -> dict[str, Any]:
        """Read product information, including its ordered image URLs."""
        if bool(product_ids) == bool(skus):
            raise ValueError("exactly one product identifier type is required")
        identifiers = product_ids or skus or []
        if len(identifiers) > 1000:
            raise ValueError("at most 1000 product identifiers can be requested")
        return self._post("/v3/product/info/list", {"product_id": product_ids or [], "sku": skus or [], "offer_id": []})

    def get_related_skus(self, *, skus: list[int]) -> dict[str, Any]:
        """Return all Ozon SKUs related to the supplied SKU identifiers."""
        if not skus:
            raise ValueError("at least one SKU is required")
        if len(skus) > 200:
            raise ValueError("at most 200 SKUs per request")
        return self._post("/v1/product/related-sku/get", {"sku": skus})

    def get_category_tree(self, language: str = "DEFAULT") -> dict[str, Any]:
        """Read Ozon's current category tree; no seller data is changed.
        Pass language="ZH" for Chinese category names."""
        return self._post("/v1/description-category/tree", {"language": language})

    def get_category_attributes(self, *, category_id: int, type_id: int, language: str = "DEFAULT") -> dict[str, Any]:
        return self._post("/v1/description-category/attribute", {"description_category_id": category_id, "type_id": type_id, "language": language})

    def get_category_attribute_values(self, *, category_id: int, type_id: int, attribute_id: int, limit: int = 100, last_value_id: int = 0) -> dict[str, Any]:
        self._validate_limit(limit)
        return self._post("/v1/description-category/attribute/values", {
            "attribute_id": attribute_id,
            "description_category_id": category_id,
            "language": "ZH_HANS",
            "last_value_id": last_value_id,
            "limit": limit,
            "type_id": type_id,
        })

    def search_category_attribute_values(self, *, category_id: int, type_id: int, attribute_id: int, value: str, limit: int = 50) -> dict[str, Any]:
        self._validate_limit(limit)
        if not value.strip():
            raise ValueError("attribute dictionary search requires a value")
        return self._post("/v1/description-category/attribute/values/search", {
            "attribute_id": attribute_id,
            "description_category_id": category_id,
            "language": "ZH_HANS",
            "limit": limit,
            "type_id": type_id,
            "value": value.strip(),
        })


    def create_products(self, *, items: list[dict[str, Any]]) -> dict[str, Any]:
        """Create or update products via /v3/product/import (write operation).

        Each item must follow the Ozon product import schema:
        name, offer_id, category_id, price, vat, weight, dimensions,
        images, description, attributes.
        Returns the task_id for async processing.
        """
        if not items:
            raise ValueError("at least one item is required")
        if len(items) > 1000:
            raise ValueError("at most 1000 items per import request")
        return self._post("/v3/product/import", {"items": items})

    def update_product_prices(self, *, prices: list[dict[str, Any]]) -> dict[str, Any]:
        """Update existing Offer prices through the documented price endpoint."""
        if not prices:
            raise ValueError("at least one price item is required")
        if len(prices) > 1000:
            raise ValueError("at most 1000 price items per request")
        for item in prices:
            if not str(item.get("offer_id") or "").strip() and not item.get("product_id"):
                raise ValueError("each price item requires offer_id or product_id")
        return self._post("/v1/product/import/prices", {"prices": prices})

    def update_product_attributes(self, *, items: list[dict[str, Any]]) -> dict[str, Any]:
        """Update attributes on existing Offers without creating an import task.

        Ozon's /v1/product/attributes/update only accepts attributes. Prices,
        media, dimensions, names, and SKU structure must continue through the
        full product-import workflow.
        """
        if not items:
            raise ValueError("at least one item is required")
        if len(items) > 1000:
            raise ValueError("at most 1000 items per attributes update request")
        for item in items:
            if not str(item.get("offer_id") or "").strip():
                raise ValueError("each attribute update item requires offer_id")
            if not isinstance(item.get("attributes"), list) or not item["attributes"]:
                raise ValueError("each attribute update item requires attributes")
        return self._post("/v1/product/attributes/update", {"items": items})

    def list_warehouses(self) -> dict[str, Any]:
        """Get FBS warehouse list (v2 endpoint, v1 is deprecated)."""
        return self._post("/v2/warehouse/list", {})

    def get_import_info(self, *, task_id: str) -> dict[str, Any]:
        """Check the status of a product import task via /v1/product/import/info."""
        if not task_id.strip():
            raise ValueError("task_id is required")
        return self._post("/v1/product/import/info", {"task_id": task_id.strip()})

    def archive_products(self, *, product_ids: list[int]) -> dict[str, Any]:
        """Archive existing Ozon products via the documented /v1/product/archive endpoint."""
        normalized = sorted({int(product_id) for product_id in product_ids if int(product_id) > 0})
        if not normalized:
            raise ValueError("at least one product ID is required")
        if len(normalized) > 100:
            raise ValueError("at most 100 product IDs can be archived per request")
        return self._post("/v1/product/archive", {"product_id": normalized})

    def get_product_upload_quota(self) -> dict[str, Any]:
        """Read product create/update limits from the official v4 endpoint."""
        return self._post("/v4/product/info/limit", {})

    def generate_barcodes(self, *, product_ids: list[int]) -> dict[str, Any]:
        """Generate barcodes for products via /v1/barcode/generate."""
        if not product_ids:
            raise ValueError("at least one product_id is required")
        if len(product_ids) > 100:
            raise ValueError("at most 100 product_ids per request")
        return self._post("/v1/barcode/generate", {"product_ids": product_ids})

    def update_stocks(self, *, stocks: list[dict[str, Any]]) -> dict[str, Any]:
        """Update FBS stock levels via /v2/products/stocks."""
        if not stocks:
            raise ValueError("at least one stock entry is required")
        return self._post("/v2/products/stocks", {"stocks": stocks})

    def get_fbs_stocks_by_warehouse(
        self, *, offer_ids: list[str], limit: int = 1000, cursor: str = ""
    ) -> dict[str, Any]:
        """Read FBS warehouse stocks for seller Offer IDs."""
        if not offer_ids:
            raise ValueError("at least one offer_id is required")
        if len(offer_ids) > 1000:
            raise ValueError("at most 1000 offer_ids per request")
        self._validate_limit(limit)
        return self._post("/v2/product/info/stocks-by-warehouse/fbs", {
            "cursor": cursor,
            "limit": limit,
            "offer_id": offer_ids,
            "sku": [],
        })

    def get_product_rating_by_sku(self, *, skus: list[int]) -> dict[str, Any]:
        """Get product content rating by SKU (product_id). Returns rating 0-100, groups, conditions."""
        if not skus:
            raise ValueError("at least one SKU is required")
        if len(skus) > 1000:
            raise ValueError("at most 1000 SKUs per request")
        return self._post("/v1/product/rating-by-sku", {"skus": skus})

    def get_product_attributes_v4(self, *, product_ids: list[int], visibility: str = "ALL") -> dict[str, Any]:
        """Get product attributes as stored on Ozon. Returns actual attribute values and moderation status."""
        if not product_ids:
            raise ValueError("at least one product_id is required")
        return self._post("/v4/product/info/attributes", {
            "filter": {"product_id": product_ids, "visibility": visibility},
            "limit": 1000,
        })

    @staticmethod
    def _validate_limit(limit: int) -> None:
        if not 1 <= limit <= 1000:
            raise ValueError("limit must be between 1 and 1000")

    def _get(self, path: str) -> dict[str, Any]:
        try:
            response = self._http.get(path)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as exc:
            raise OzonTransportError("Ozon request failed") from exc

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._http.post(path, json=payload)
        except httpx.TimeoutException as exc:
            raise OzonTransportError("Ozon request timed out") from exc
        except httpx.HTTPError as exc:
            raise OzonTransportError("Ozon transport request failed") from exc

        # Capture response body for error diagnostics before raising
        if response.status_code >= 400:
            body_text = response.text[:2000]
        if response.status_code in (401, 403):
            raise OzonAuthenticationError(f"Ozon authentication failed: {body_text}")
        if response.status_code == 429:
            retry_after = response.headers.get("Item-Retry-After", "")
            remaining = response.headers.get("Item-Rate-Limit-Remaining", "")
            suffix = f"; Item-Retry-After={retry_after}; Item-Rate-Limit-Remaining={remaining}"
            raise OzonRateLimitError(f"Ozon rate limit reached: {body_text}{suffix}")
        if 400 <= response.status_code < 500:
            raise OzonClientResponseError(f"Ozon request failed (HTTP {response.status_code}): {body_text}")
        if response.status_code >= 500:
            raise OzonServerError(f"Ozon service failed (HTTP {response.status_code}): {body_text}")
        try:
            body = response.json()
        except ValueError as exc:
            raise OzonServerError("Ozon returned an invalid JSON response") from exc
        if not isinstance(body, dict):
            raise OzonServerError("Ozon returned an unexpected response shape")
        return body
