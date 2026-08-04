"""P7: Approval and small-batch write-back.

Manages the approval flow, audit trail, and staged submission to the Ozon
/v3/product/import endpoint.  All write operations require explicit approval
and produce audit events.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..erp_models import (
    AuditEventRecord,
    ListingDraftRecord,
    ListingVariantRecord,
    PipelineProductRecord,
    SourceProductRecord,
)
from ..integrations.ozon_seller import OzonSellerClient, OzonSellerError
from ..sync_service import SyncConfigurationError, _credentials


def build_import_payload(db: Session, shop_id: int, source_product_id: int) -> dict[str, Any]:
    """Build the Ozon /v3/product/import items list from pipeline data.

    Shared between P6 payload preview and P7 actual submission so the preview
    always matches what gets sent.
    """
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found")
    source = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.id == source_product_id,
    ))
    if source is None:
        raise ValueError("source product not found")
    variant_data = json.loads(pipeline.variant_mapping_json) if pipeline.variant_mapping_json else {}
    attr_mapping = json.loads(pipeline.attribute_mapping_json) if pipeline.attribute_mapping_json else []
    pricing = json.loads(pipeline.pricing_json) if pipeline.pricing_json else {}

    # Build attribute list from P3 mapping
    attributes_list: list[dict[str, Any]] = []
    for attr in attr_mapping:
        if not attr.get("matched"):
            continue
        value_text = attr.get("value_text") or ""
        value_id = attr.get("value_id")
        if not value_text and not value_id:
            continue
        attributes_list.append({
            "complex_id": 0,
            "id": attr["attribute_id"],
            "values": [{
                "dictionary_value_id": value_id if value_id else 0,
                "value": value_text,
            }],
        })

    # Filter valid image URLs
    all_images = [m["url"] for m in variant_data.get("media", []) if m.get("url")]
    valid_images = [u for u in all_images if isinstance(u, str) and u.startswith(("https://", "http://"))]
    if not valid_images and source.main_image_url and source.main_image_url.startswith(("https://", "http://")):
        valid_images = [source.main_image_url]

    # Build one item per variant (each variant is a separate Ozon product)
    items: list[dict[str, Any]] = []
    variants = variant_data.get("variants", [])
    if not variants:
        # Fallback: single item with no variant
        variants = [{"seller_sku": f"SRC{source_product_id}", "source_sku": "", "price_cny": None}]

    for var in variants:
        var_pricing = next(
            (p for p in pricing.get("variants", []) if p.get("source_sku") == var.get("source_sku")),
            {},
        )
        price_val = var_pricing.get("price_cny") or var.get("price_cny")
        old_price_val = var_pricing.get("old_price_cny")
        price_str = _format_price(price_val)
        old_price_str = _format_price(old_price_val) if old_price_val else price_str

        items.append({
            "name": pipeline.generated_title_ru or source.title,
            "offer_id": var["seller_sku"],
            "description_category_id": int(pipeline.matched_category_id) if pipeline.matched_category_id else None,
            "type_id": int(pipeline.matched_type_id) if pipeline.matched_type_id else 0,
            "price": price_str,
            "old_price": old_price_str,
            "premium_price": "",
            "vat": "0",
            "description": pipeline.generated_description_ru or "",
            "depth": 200,
            "width": 150,
            "height": 100,
            "weight": 500,
            "dimension_unit": "mm",
            "weight_unit": "g",
            "images": valid_images,
            "attributes": attributes_list,
        })

    return {"items": items}


def _format_price(value: Any) -> str:
    """Format a price value as a clean string for the Ozon API."""
    if value is None:
        return "0"
    try:
        f = float(value)
        if f == int(f):
            return str(int(f))
        return f"{f:.2f}".rstrip("0").rstrip(".")
    except (TypeError, ValueError):
        return "0"


def create_listing_draft_from_pipeline(db: Session, shop_id: int, source_product_id: int) -> ListingDraftRecord:
    """Create a ListingDraftRecord from the pipeline output for approval."""
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found")
    if pipeline.pipeline_stage != "quality_checked":
        raise ValueError(f"pipeline must be quality_checked, current: {pipeline.pipeline_stage}")
    source = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.id == source_product_id,
    ))
    if source is None:
        raise ValueError("source product not found")
    variant_data = json.loads(pipeline.variant_mapping_json) if pipeline.variant_mapping_json else {}
    pricing = json.loads(pipeline.pricing_json) if pipeline.pricing_json else {}
    offer_id = variant_data.get("variants", [{}])[0].get("seller_sku", f"SRC{source_product_id}")
    # Check for existing draft
    existing = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.shop_id == shop_id,
        ListingDraftRecord.offer_id == offer_id,
    ))
    if existing:
        draft = existing
    else:
        draft = ListingDraftRecord(
            shop_id=shop_id,
            offer_id=offer_id,
            title=pipeline.generated_title_ru or source.title,
            description=pipeline.generated_description_ru,
            category_id=pipeline.matched_category_id,
            type_id=pipeline.matched_type_id,
            primary_image_url=source.main_image_url,
            status="ready_for_approval",
        )
        db.add(draft)
        db.flush()
    # Update variants
    db.query(ListingVariantRecord).filter(ListingVariantRecord.draft_id == draft.id).delete()
    for var in variant_data.get("variants", []):
        var_pricing = next((p for p in pricing.get("variants", []) if p.get("source_sku") == var.get("source_sku")), {})
        db.add(ListingVariantRecord(
            draft_id=draft.id,
            seller_sku=var["seller_sku"],
            purchase_cost_cny=var.get("price_cny"),
            weight_g=500,
            length_mm=200,
            width_mm=150,
            height_mm=100,
            calculated_price_cny=var_pricing.get("price_cny"),
            min_price_cny=str(var_pricing.get("min_price_cny", "")),
            old_price_cny=var_pricing.get("old_price_cny"),
        ))
    pipeline.listing_draft_id = draft.id
    pipeline.pipeline_stage = "draft_created"
    db.commit()
    db.refresh(draft)
    return draft


def approve_for_publish(
    db: Session,
    shop_id: int,
    source_product_id: int,
    approver_id: str,
) -> PipelineProductRecord:
    """Record an approval decision with full audit trail."""
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found")
    if pipeline.listing_draft_id is None:
        raise ValueError("listing draft must be created before approval")
    pipeline.publish_status = "approved"
    pipeline.pipeline_stage = "approved"
    db.add(AuditEventRecord(
        shop_id=shop_id,
        actor_id=approver_id,
        action="pipeline_product_approved",
        entity_type="pipeline_product",
        entity_id=str(source_product_id),
        details_json=json.dumps({
            "listing_draft_id": pipeline.listing_draft_id,
            "quality_score": float(pipeline.quality_score) if pipeline.quality_score else None,
        }, ensure_ascii=False),
    ))
    db.commit()
    db.refresh(pipeline)
    return pipeline


def submit_to_ozon(
    db: Session,
    shop_id: int,
    source_product_id: int,
    approver_id: str,
) -> dict[str, Any]:
    """Submit an approved product to Ozon /v3/product/import.

    This is the ONLY stage that performs an Ozon write.  It is guarded by
    the approval check and produces an audit event.
    """
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found")
    if pipeline.publish_status != "approved":
        raise ValueError("product must be approved before submission")

    # Build the import payload from pipeline data
    payload = build_import_payload(db, shop_id, source_product_id)
    if not payload["items"]:
        raise ValueError("no items to import; pipeline data may be incomplete")

    # Call the real Ozon API
    try:
        client_id, api_key = _credentials(db, shop_id)
    except SyncConfigurationError as exc:
        raise ValueError(f"无法获取店铺授权: {exc}") from exc

    try:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            response = client.create_products(items=payload["items"])
    except OzonSellerError as exc:
        # Record the failure in audit, keep status at approved for retry
        db.add(AuditEventRecord(
            shop_id=shop_id,
            actor_id=approver_id,
            action="pipeline_product_submit_failed",
            entity_type="pipeline_product",
            entity_id=str(source_product_id),
            details_json=json.dumps({
                "error": str(exc)[:2000],
                "error_type": type(exc).__name__,
            }, ensure_ascii=False),
        ))
        db.commit()
        return {
            "status": "failed",
            "error": str(exc),
            "error_type": type(exc).__name__,
        }

    # Extract the real task_id from Ozon's response
    result = response.get("result", {}) if isinstance(response, dict) else {}
    task_id = str(result.get("task_id", "")) if result else ""

    if not task_id:
        # Ozon returned a response without a task_id -- unusual but handle it
        task_id = str(uuid.uuid4())

    pipeline.task_id = task_id
    pipeline.publish_status = "submitted"
    pipeline.pipeline_stage = "published"
    db.add(AuditEventRecord(
        shop_id=shop_id,
        actor_id=approver_id,
        action="pipeline_product_submitted",
        entity_type="pipeline_product",
        entity_id=str(source_product_id),
        details_json=json.dumps({
            "task_id": task_id,
            "listing_draft_id": pipeline.listing_draft_id,
            "item_count": len(payload["items"]),
        }, ensure_ascii=False),
    ))
    db.commit()
    return {
        "task_id": task_id,
        "status": "submitted",
        "item_count": len(payload["items"]),
    }


def poll_task_status(db: Session, shop_id: int, source_product_id: int) -> dict[str, Any]:
    """Check the status of a submitted product import task via Ozon API."""
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found")
    if not pipeline.task_id:
        return {"status": "not_submitted", "message": "product has not been submitted to Ozon"}

    # Call the real Ozon API to poll task status
    try:
        client_id, api_key = _credentials(db, shop_id)
    except SyncConfigurationError as exc:
        return {
            "status": "error",
            "task_id": pipeline.task_id,
            "error": f"无法获取店铺授权: {exc}",
        }

    try:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            response = client.get_import_info(task_id=pipeline.task_id)
    except OzonSellerError as exc:
        return {
            "status": "error",
            "task_id": pipeline.task_id,
            "error": str(exc),
            "error_type": type(exc).__name__,
        }

    # Parse Ozon's import-info response
    result = response.get("result", {}) if isinstance(response, dict) else {}
    items = result.get("items", []) if isinstance(result, dict) else []

    # Determine overall status from individual item statuses
    statuses = [str(item.get("status", "")).lower() for item in items if isinstance(item, dict)]
    if not statuses:
        ozon_status = "pending"
    elif all(s == "imported" for s in statuses):
        ozon_status = "imported"
        pipeline.publish_status = "imported"
    elif any(s == "failed" for s in statuses):
        ozon_status = "failed"
        pipeline.publish_status = "import_failed"
    else:
        ozon_status = "pending"

    # Collect errors if any
    errors = []
    for item in items:
        if isinstance(item, dict) and item.get("errors"):
            errors.append({
                "offer_id": item.get("offer_id"),
                "errors": item["errors"],
            })

    db.commit()
    return {
        "task_id": pipeline.task_id,
        "publish_status": pipeline.publish_status,
        "pipeline_stage": pipeline.pipeline_stage,
        "ozon_status": ozon_status,
        "items": [
            {
                "offer_id": item.get("offer_id"),
                "product_id": item.get("product_id"),
                "status": item.get("status"),
            }
            for item in items if isinstance(item, dict)
        ],
        "errors": errors,
    }