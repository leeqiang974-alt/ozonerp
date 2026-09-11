# -*- coding: utf-8 -*-
"""Submit manual fixes to existing Ozon product cards without re-creating them.

For a draft that already exists on Ozon (offer_id -> product_id), this service
sends only corrections:
  * attributes (variant colour 10096/10097, model name 9048, rich content
    11254, category video attributes) via /v1/product/attributes/update
  * images (per-SKU gallery with the SKU's own first image first) via
    /v1/product/pictures/import
  * video link (Yandex Disk direct link) via category video attributes

It never touches price / stock / name / description, so it is safe for cards
already live or in moderation.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..erp_models import (
    AuditEventRecord,
    ListingAttributeValueRecord,
    ListingDraftRecord,
    PipelineProductRecord,
    SourceProductRecord,
)
from ..integrations.ozon_seller import OzonSellerClient
from ..sync_service import _credentials
from .publish_service import build_import_payload
from .rich_content import get_rich_content_attribute

_YANDEX_DISK_HOSTS = {"disk.yandex.com", "disk.yandex.ru", "yadi.sk"}


def _is_yandex_video(url: str) -> bool:
    try:
        from urllib.parse import urlparse
        host = (urlparse(url).hostname or "").lower().rstrip(".")
        return host in _YANDEX_DISK_HOSTS
    except Exception:
        return False


def submit_fixes(
    db: Session,
    shop_id: int,
    draft_id: int,
    color_overrides: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Push manual corrections for an already-submitted draft to Ozon.

    color_overrides: {offer_id: {"color_value_id": int|str, "color_text": str,
    "color_name": str}} -- per-SKU values picked in the UI.  When omitted the
    payload's own colour values (from the saved draft) are kept.
    """
    draft = db.get(ListingDraftRecord, draft_id)
    if draft is None or int(draft.shop_id) != int(shop_id):
        raise ValueError("draft not found for this shop")
    if not draft.source_product_id:
        raise ValueError("draft has no source product; cannot rebuild the fix payload")
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == int(shop_id),
        PipelineProductRecord.source_product_id == int(draft.source_product_id),
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found for draft")
    category_id = str(pipeline.matched_category_id or draft.category_id or "").strip()
    type_id = str(pipeline.matched_type_id or draft.type_id or "").strip()

    # 1. Rebuild the full submission payload (reuses per-SKU colours / images).
    payload = build_import_payload(db, int(shop_id), int(draft.source_product_id))
    items = payload.get("items") or []
    if not items:
        raise ValueError("build_import_payload returned no items")
    overrides = color_overrides or {}

    # 2. Normalise per-item attributes.
    attr_update_items: list[dict[str, Any]] = []
    per_sku_images: dict[str, list[str]] = {}
    for item in items:
        oid = str(item.get("offer_id") or "").strip()
        attrs: list[dict[str, Any]] = []
        for row in item.get("attributes") or []:
            aid = str(row.get("id") or "")
            if aid in {"10096", "10097"} and oid in overrides:
                ov = overrides[oid]
                if aid == "10096":
                    attrs.append({"complex_id": 0, "id": "10096", "values": [{
                        "dictionary_value_id": int(ov.get("color_value_id") or 0),
                        "value": str(ov.get("color_text") or ""),
                    }]})
                else:
                    attrs.append({"complex_id": 0, "id": "10097", "values": [{
                        "dictionary_value_id": 0,
                        "value": str(ov.get("color_name") or ov.get("color_text") or ""),
                    }]})
                continue
            attrs.append(row)
        # Rich content: rebuild with this SKU's own images so it is never empty.
        sku_images = [u for u in (item.get("images") or []) if isinstance(u, str) and u.startswith(("http://", "https://"))]
        if sku_images:
            per_sku_images[oid] = list(dict.fromkeys(sku_images))[:15]
        attrs = [row for row in attrs if str(row.get("id") or "") != "11254"]
        # 11254: submit a valid text-only rich content (version:0.3 + raTextBlock).
        # Ozon template validator rejects empty JSON {} and external image URLs;
        # the validated form (approved products XY000001/AECMTS/DFEMTS/CFFMTS)
        # is text-only with the version field.
        rich_attr = get_rich_content_attribute(
            [],
            description_ru=str(draft.description or ""),
            title_ru=str(draft.title or ""),
        )
        attrs.append(rich_attr)
        attr_update_items.append({"offer_id": oid, "attributes": attrs})

    # 3. Video: if the draft carries a Yandex Disk direct link, attach it via
    #    the category's real video attributes.
    video_url = str(draft.video_url or "").strip()
    video_note = ""
    if _is_yandex_video(video_url):
        try:
            client_id, api_key = _credentials(db, int(shop_id))
            with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
                client.attach_videos_v2(
                    offer_ids=list(per_sku_images.keys()),
                    video_url=video_url,
                    video_title=str(draft.title or "")[:80],
                    category_id=int(category_id) if category_id.isdigit() else None,
                    type_id=int(type_id) if type_id.isdigit() else None,
                )
            video_note = f"video attached to {len(per_sku_images)} offers"
        except Exception as exc:
            video_note = f"video attach failed: {str(exc)[:120]}"

    # 4. Send attributes update.
    client_id, api_key = _credentials(db, int(shop_id))
    attr_result: dict[str, Any] = {}
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        for i in range(0, len(attr_update_items), 1000):
            chunk = attr_update_items[i:i + 1000]
            resp = client.update_product_attributes(items=chunk)
            merged = {**attr_result, **resp}
            attr_result = merged
        # 5. Pictures per SKU.
        pid_map = client.get_product_ids_by_offer(offer_ids=list(per_sku_images.keys()))
        pic_results: dict[str, Any] = {}
        for oid, imgs in per_sku_images.items():
            pid = pid_map.get(oid)
            if not pid:
                pic_results[oid] = {"error": "product_id not found on Ozon"}
                continue
            try:
                pic_results[oid] = client.import_product_pictures(product_id=pid, images=imgs)
            except Exception as exc:
                pic_results[oid] = {"error": str(exc)[:120]}

    # 6. Audit + local state.
    issues: list[dict[str, Any]] = []
    try:
        issues = json.loads(draft.ozon_issues_json or "[]")
    except (json.JSONDecodeError, TypeError):
        issues = []
    cleared = [it for it in issues if not any(
        k in str(it.get("type") or "").lower() or k in str(it.get("message") or "").lower()
        for k in ("pics_url_unsupported", "some_image_failed", "link", "rich", "merger")
    )]
    draft.ozon_issues_json = json.dumps(cleared, ensure_ascii=False)
    db.add(AuditEventRecord(
        shop_id=int(shop_id),
        actor_id="system",
        action="fix_submit",
        entity_type="listing_draft",
        entity_id=str(draft_id),
        details_json=json.dumps({
            "offers": len(attr_update_items),
            "pics": len(per_sku_images),
            "video": video_note or "no video",
        }, ensure_ascii=False),
    ))
    db.commit()

    return {
        "ok": True,
        "offers": len(attr_update_items),
        "attributes_update": attr_result,
        "pictures": pic_results,
        "video": video_note,
        "product_ids": pid_map,
        "cleared_issues": len(issues) - len(cleared),
    }
