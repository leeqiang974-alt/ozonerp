"""Ozon Offer ID normalization shared by draft validation and submission."""

from __future__ import annotations

import re

OZON_OFFER_ID_MAX_LENGTH = 50


def normalize_offer_id(value: str, *, max_length: int = OZON_OFFER_ID_MAX_LENGTH) -> str:
    """Keep readable IDs unchanged; shorten long IDs with a stable uniqueness hash."""
    cleaned = re.sub(r"\s+", "_", str(value or "").strip())
    if len(cleaned) <= max_length:
        return cleaned
    hash_value = 2166136261
    for character in cleaned:
        hash_value ^= ord(character)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    digest = f"{hash_value:08x}"
    readable_length = max_length - len(digest) - 1
    readable = cleaned[:readable_length].rstrip("-_.")
    return f"{readable}-{digest}"


def normalize_offer_ids(values: list[str]) -> list[str]:
    results = [normalize_offer_id(value) for value in values]
    if len(set(results)) != len(results):
        raise ValueError("规范化后的 Offer ID 出现重复，请调整变体编码")
    return results
