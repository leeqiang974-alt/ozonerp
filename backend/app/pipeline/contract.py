"""P0: Capture contract freeze.

Defines the JSON schema for 1688 product snapshots collected by the Chrome
extension, the idempotent key specification, and validation/normalisation
helpers.  No network or database access happens here -- this module is the
single source of truth for *what* a valid snapshot looks like.
"""

from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation
from typing import Any


def idempotent_key(source_platform: str, source_product_id: str) -> str:
    """Stable dedup key: platform + product-id, SHA-256 for uniformity."""
    raw = f"{source_platform}:{source_product_id}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


REQUIRED_FIELDS = ("source_product_id", "title")

VARIANT_REQUIRED = ("source_sku", "spec_name")
MEDIA_REQUIRED = ("url",)


class SnapshotError(ValueError):
    """Raised when a snapshot violates the contract."""


def validate_snapshot(snapshot: dict[str, Any]) -> list[str]:
    """Return a list of validation errors (empty == valid)."""
    errors: list[str] = []
    if not isinstance(snapshot, dict):
        return ["snapshot must be a JSON object"]
    for field in REQUIRED_FIELDS:
        if not snapshot.get(field):
            errors.append(f"missing required field: {field}")
    pid = snapshot.get("source_product_id", "")
    if not isinstance(pid, str) or not pid.strip():
        errors.append("source_product_id must be a non-empty string")
    title = snapshot.get("title", "")
    if not isinstance(title, str) or len(title) > 500:
        errors.append("title must be a string of at most 500 characters")
    variants = snapshot.get("variants", [])
    if not isinstance(variants, list):
        errors.append("variants must be a list")
    else:
        for i, variant in enumerate(variants):
            if not isinstance(variant, dict):
                errors.append(f"variants[{i}] must be an object")
                continue
            for field in VARIANT_REQUIRED:
                if not variant.get(field):
                    errors.append(f"variants[{i}].{field} is required")
            price = variant.get("price_cny")
            if price is not None:
                try:
                    if Decimal(str(price)) < 0:
                        errors.append(f"variants[{i}].price_cny must be non-negative")
                except (InvalidOperation, TypeError):
                    errors.append(f"variants[{i}].price_cny is not a valid number")
            stock = variant.get("stock", 0)
            if not isinstance(stock, int) or stock < 0:
                errors.append(f"variants[{i}].stock must be a non-negative integer")
    media = snapshot.get("media", [])
    if not isinstance(media, list):
        errors.append("media must be a list")
    else:
        for i, item in enumerate(media):
            if not isinstance(item, dict):
                errors.append(f"media[{i}] must be an object")
                continue
            if not item.get("url"):
                errors.append(f"media[{i}].url is required")
    return errors


def validate_or_raise(snapshot: dict[str, Any]) -> None:
    errors = validate_snapshot(snapshot)
    if errors:
        raise SnapshotError("; ".join(errors))


_WEIGHT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(kg|g|ke|kg|liang|jin)", re.IGNORECASE)
_DIM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+(?:\.\d+)?)")


def normalize_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Return a deep copy with normalised field names, units, and types."""
    normalized: dict[str, Any] = {
        "source_platform": str(snapshot.get("source_platform", "1688")),
        "source_product_id": str(snapshot.get("source_product_id", "")).strip(),
        "title": str(snapshot.get("title", "")).strip()[:500],
        "source_url": str(snapshot.get("source_url", "")).strip() or None,
        "main_image_url": str(snapshot.get("main_image_url", "")).strip() or None,
        "category_hint": str(snapshot.get("category_hint", "")).strip() or None,
        "brand": str(snapshot.get("brand", "")).strip() or None,
        "material": str(snapshot.get("material", "")).strip() or None,
    }
    variants_out: list[dict[str, Any]] = []
    for variant in snapshot.get("variants", []):
        if not isinstance(variant, dict):
            continue
        price = variant.get("price_cny")
        try:
            price_decimal = Decimal(str(price)) if price is not None else None
        except (InvalidOperation, TypeError):
            price_decimal = None
        variants_out.append({
            "source_sku": str(variant.get("source_sku", "")).strip(),
            "spec_name": str(variant.get("spec_name", "")).strip(),
            "price_cny": price_decimal,
            "stock": int(variant.get("stock", 0)),
            "image_url": str(variant.get("image_url", "")).strip() or None,
            "raw_json": json.dumps(variant, ensure_ascii=False),
        })
    normalized["variants"] = variants_out
    media_out: list[dict[str, Any]] = []
    for i, item in enumerate(snapshot.get("media", [])):
        if not isinstance(item, dict):
            continue
        media_out.append({
            "url": str(item.get("url", "")).strip(),
            "media_type": str(item.get("media_type", "image")),
            "sort_order": int(item.get("sort_order", i)),
            "is_primary": bool(item.get("is_primary", i == 0)),
        })
    normalized["media"] = media_out
    return normalized


def extract_weight_from_text(text: str | None) -> Decimal | None:
    """Extract weight in grams from free-form text."""
    if not text:
        return None
    # Chinese units: kg, g, jin, liang
    match = _WEIGHT_RE.search(text)
    if not match:
        return None
    value = Decimal(match.group(1))
    unit = match.group(2).lower()
    if unit in ("kg",):
        return value * 1000
    if unit == "jin":
        return value * 500
    if unit == "liang":
        return value * 50
    return value


def extract_dimensions_from_text(text: str | None) -> tuple[Decimal, Decimal, Decimal] | None:
    """Extract L x W x H from free-form text (returns raw values)."""
    if not text:
        return None
    match = _DIM_RE.search(text)
    if not match:
        return None
    return tuple(Decimal(g) for g in match.groups())
