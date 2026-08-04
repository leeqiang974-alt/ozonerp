"""P4: Multi-variant, SKU and image mapping.

Maps 1688 spec axes (e.g. color-size combinations) to Ozon variant attributes,
generates stable SKU codes, binds images to SKUs, and arranges 8-15 images
for the listing.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..erp_models import (
    PipelineProductRecord,
    SourceMediaRecord,
    SourceVariantRecord,
)

# Ozon image constraints
MIN_IMAGES = 1
MAX_IMAGES = 15
RECOMMENDED_IMAGES = 8


def generate_sku(shop_id: int, source_product_id: int, source_sku: str) -> str:
    """Generate a stable, collision-resistant SKU from source identifiers."""
    raw = f"{shop_id}:{source_product_id}:{source_sku}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:10].upper()
    return f"OZ{digest}"


def map_variants(db: Session, shop_id: int, source_product_id: int) -> dict[str, Any]:
    """Map 1688 variants to Ozon variant structure with stable SKUs."""
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found; run P2 first")
    source_variants = list(db.scalars(select(SourceVariantRecord).where(
        SourceVariantRecord.source_product_id == source_product_id,
    )))
    if not source_variants:
        raise ValueError("source product has no variants")
    mapped: list[dict[str, Any]] = []
    for sv in source_variants:
        # Parse spec_name into axes (e.g. "Red-XL" -> {color: Red, size: XL})
        axes = _parse_spec_axes(sv.spec_name)
        sku = generate_sku(shop_id, source_product_id, sv.source_sku)
        mapped.append({
            "seller_sku": sku,
            "source_sku": sv.source_sku,
            "spec_name": sv.spec_name,
            "axes": axes,
            "price_cny": float(sv.price_cny) if sv.price_cny else None,
            "stock": sv.stock,
            "image_url": sv.image_url,
        })
    # Arrange media
    source_media = list(db.scalars(select(SourceMediaRecord).where(
        SourceMediaRecord.source_product_id == source_product_id,
    ).order_by(SourceMediaRecord.sort_order)))
    arranged = _arrange_media(source_media, source_variants)
    pipeline.variant_mapping_json = json.dumps({
        "variants": mapped,
        "media": arranged,
        "media_count": len(arranged),
    }, ensure_ascii=False)
    pipeline.pipeline_stage = "variants_mapped"
    db.commit()
    return {
        "variants": mapped,
        "media": arranged,
        "media_count": len(arranged),
        "sku_count": len(mapped),
    }


def _parse_spec_axes(spec_name: str) -> dict[str, str]:
    """Parse a 1688 spec name like 'Red-XL' into {color: Red, size: XL}."""
    if not spec_name:
        return {}
    parts = [p.strip() for p in spec_name.replace("-", " ").replace("/", " ").split() if p.strip()]
    axes: dict[str, str] = {}
    for i, part in enumerate(parts):
        if i == 0:
            axes["color"] = part
        elif i == 1:
            axes["size"] = part
        else:
            axes[f"axis_{i}"] = part
    return axes


def _arrange_media(
    media: list[SourceMediaRecord],
    variants: list[SourceVariantRecord],
) -> list[dict[str, Any]]:
    """Arrange media for listing: primary image first, then variant images, then extras."""
    arranged: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    # Primary image first
    for m in media:
        if m.is_primary and m.url not in seen_urls:
            arranged.append({"url": m.url, "type": "primary", "sort_order": len(arranged)})
            seen_urls.add(m.url)
    # Variant images
    for sv in variants:
        if sv.image_url and sv.image_url not in seen_urls:
            arranged.append({"url": sv.image_url, "type": "variant", "sku": sv.source_sku, "sort_order": len(arranged)})
            seen_urls.add(sv.image_url)
    # Remaining media
    for m in media:
        if m.url not in seen_urls:
            arranged.append({"url": m.url, "type": "gallery", "sort_order": len(arranged)})
            seen_urls.add(m.url)
    # Enforce max
    if len(arranged) > MAX_IMAGES:
        arranged = arranged[:MAX_IMAGES]
    return arranged


def check_media_compliance(media_count: int) -> list[str]:
    """Return a list of compliance issues for image count."""
    issues: list[str] = []
    if media_count < MIN_IMAGES:
        issues.append(f"need at least {MIN_IMAGES} image, got {media_count}")
    if media_count > MAX_IMAGES:
        issues.append(f"Ozon allows at most {MAX_IMAGES} images, got {media_count}")
    if media_count < RECOMMENDED_IMAGES:
        issues.append(f"recommended {RECOMMENDED_IMAGES} images for best visibility, got {media_count}")
    return issues
