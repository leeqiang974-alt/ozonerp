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

    def get_product_info(self, *, product_ids: list[int] | None = None, skus: list[int] | None = None) -> dict[str, Any]:
        """Read product information, including its ordered image URLs."""
        if bool(product_ids) == bool(skus):
            raise ValueError("exactly one product identifier type is required")
        identifiers = product_ids or skus or []
        if len(identifiers) > 1000:
            raise ValueError("at most 1000 product identifiers can be requested")
        return self._post("/v3/product/info/list", {"product_id": product_ids or [], "sku": skus or [], "offer_id": []})

    def get_category_tree(self) -> dict[str, Any]:
        """Read Ozon's current category tree; no seller data is changed."""
        return self._post("/v1/description-category/tree", {"language": "DEFAULT"})

    def get_category_attributes(self, *, category_id: int, type_id: int) -> dict[str, Any]:
        return self._post("/v1/description-category/attribute", {"description_category_id": category_id, "type_id": type_id, "language": "DEFAULT"})

    def get_category_attribute_values(self, *, category_id: int, type_id: int, attribute_id: int, limit: int = 100, last_value_id: int = 0) -> dict[str, Any]:
        self._validate_limit(limit)
        return self._post("/v1/description-category/attribute/values", {
            "attribute_id": attribute_id,
            "description_category_id": category_id,
            "language": "DEFAULT",
            "last_value_id": last_value_id,
            "limit": limit,
            "type_id": type_id,
        })

    def search_category_attribute_values(self, *, category_id: int, type_id: int, attribute_id: int, value: str, limit: int = 50) -> dict[str, Any]:
        self._validate_limit(limit)
        if len(value.strip()) < 2:
            raise ValueError("attribute dictionary search requires at least two characters")
        return self._post("/v1/description-category/attribute/values/search", {
            "attribute_id": attribute_id,
            "description_category_id": category_id,
            "language": "DEFAULT",
            "limit": limit,
            "type_id": type_id,
            "value": value.strip(),
        })

    @staticmethod
    def _validate_limit(limit: int) -> None:
        if not 1 <= limit <= 1000:
            raise ValueError("limit must be between 1 and 1000")

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._http.post(path, json=payload)
        except httpx.TimeoutException as exc:
            raise OzonTransportError("Ozon request timed out") from exc
        except httpx.HTTPError as exc:
            raise OzonTransportError("Ozon transport request failed") from exc

        if response.status_code in (401, 403):
            raise OzonAuthenticationError("Ozon authentication failed")
        if response.status_code == 429:
            raise OzonRateLimitError("Ozon rate limit reached")
        if 400 <= response.status_code < 500:
            raise OzonClientResponseError(f"Ozon request failed with status {response.status_code}")
        if response.status_code >= 500:
            raise OzonServerError(f"Ozon service failed with status {response.status_code}")
        try:
            body = response.json()
        except ValueError as exc:
            raise OzonServerError("Ozon returned an invalid JSON response") from exc
        if not isinstance(body, dict):
            raise OzonServerError("Ozon returned an unexpected response shape")
        return body
