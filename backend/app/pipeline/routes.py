"""FastAPI router for the 1688 -> Ozon listing pipeline (P0-P7)."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..erp_models import AutomationCandidateRecord, AutomationRunRecord, AutomationTaskRecord, ListingDraftRecord, OzonMarketSnapshotRecord, SourceProductRecord
from ..models import Shop
from . import (
    attribute_mapping,
    extension_bridge,
    category_matching,
    content_generation,
    ingestion_service,
    progress,
    publish_service,
    quality_check,
    variant_mapping,
)
from .schemas import (
    ApproveRequest,
    CategoryLockRequest,
    SourceProductIngest,
    SourceProductRead,
)

router = APIRouter(prefix="/api/v1", tags=["pipeline"])


def _get_shop_or_404(db: Session, shop_id: int) -> Shop:
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=404, detail="shop not found")
    return shop


# ---------------------------------------------------------------------------
# P0/P1: ingestion
# ---------------------------------------------------------------------------

@router.post(
    "/shops/{shop_id}/pipeline/ingest",
    response_model=SourceProductRead,
    status_code=status.HTTP_201_CREATED,
)
def ingest_snapshot(shop_id: int, payload: SourceProductIngest, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    try:
        record = ingestion_service.ingest_source_product(db, shop_id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return record


@router.get("/shops/{shop_id}/pipeline/source-products")
def list_source_products(shop_id: int, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    products = ingestion_service.list_source_products(db, shop_id)
    product_ids = [p.id for p in products]
    drafts = list(db.scalars(
        select(ListingDraftRecord)
        .where(ListingDraftRecord.shop_id == shop_id, ListingDraftRecord.source_product_id.in_(product_ids))
        .order_by(ListingDraftRecord.updated_at.desc(), ListingDraftRecord.id.desc())
    )) if product_ids else []
    latest_draft_by_source = {}
    for draft in drafts:
        latest_draft_by_source.setdefault(draft.source_product_id, draft)
    return [
        {
            "id": p.id,
            "source_platform": p.source_platform,
            "source_product_id": p.source_product_id,
            "title": p.title,
            "main_image_url": p.main_image_url,
            "category_hint": p.category_hint,
            "brand": p.brand,
            "material": p.material,
            "ingestion_status": p.ingestion_status,
            "variant_count": len(p.variants),
            "media_count": len(p.media),
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "draft_id": latest_draft_by_source[p.id].id if p.id in latest_draft_by_source else None,
            "offer_id": latest_draft_by_source[p.id].offer_id if p.id in latest_draft_by_source else None,
            "draft_status": latest_draft_by_source[p.id].status if p.id in latest_draft_by_source else None,
            "editor_status": (
                "published"
                if p.id in latest_draft_by_source and (
                    latest_draft_by_source[p.id].status == "submitted"
                    or latest_draft_by_source[p.id].import_task_id
                    or latest_draft_by_source[p.id].ozon_product_id
                )
                else "edited" if p.id in latest_draft_by_source else "unedited"
            ),
        }
        for p in products
    ]


# ---------------------------------------------------------------------------
# P2: category matching
# ---------------------------------------------------------------------------

@router.post("/shops/{shop_id}/pipeline/source-products/{sp_id}/match-categories")
def match_categories(shop_id: int, sp_id: int, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    try:
        ingestion_service.get_source_product(db, shop_id, sp_id)
        facts, candidates = category_matching.match_categories(db, shop_id, sp_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "facts": facts.to_dict(),
        "candidates": [
            {"category_id": c.category_id, "type_id": c.type_id, "title": c.title, "score": c.score}
            for c in candidates
        ],
    }


@router.post("/shops/{shop_id}/pipeline/source-products/{sp_id}/lock-category")
def lock_category(shop_id: int, sp_id: int, payload: CategoryLockRequest, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    try:
        pipeline = category_matching.lock_category(db, shop_id, sp_id, payload.category_id, payload.type_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"pipeline_stage": pipeline.pipeline_stage, "matched_category_id": pipeline.matched_category_id}


# ---------------------------------------------------------------------------
# P3: attribute mapping
# ---------------------------------------------------------------------------

@router.post("/shops/{shop_id}/pipeline/source-products/{sp_id}/map-attributes")
def map_attributes(shop_id: int, sp_id: int, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    try:
        result = attribute_mapping.map_attributes(db, shop_id, sp_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


# ---------------------------------------------------------------------------
# P4: variant mapping
# ---------------------------------------------------------------------------

@router.post("/shops/{shop_id}/pipeline/source-products/{sp_id}/map-variants")
def map_variants(shop_id: int, sp_id: int, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    try:
        result = variant_mapping.map_variants(db, shop_id, sp_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


# ---------------------------------------------------------------------------
# P5: content generation
# ---------------------------------------------------------------------------

@router.post("/shops/{shop_id}/pipeline/source-products/{sp_id}/generate-content")
def generate_content(shop_id: int, sp_id: int, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    try:
        result = content_generation.generate_content(db, shop_id, sp_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


# ---------------------------------------------------------------------------
# P6: quality check
# ---------------------------------------------------------------------------

@router.post("/shops/{shop_id}/pipeline/source-products/{sp_id}/quality-check")
def run_quality_check(shop_id: int, sp_id: int, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    try:
        result = quality_check.run_quality_check(db, shop_id, sp_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


@router.get("/shops/{shop_id}/pipeline/source-products/{sp_id}/payload-preview")
def preview_payload(shop_id: int, sp_id: int, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    try:
        result = quality_check.preview_payload(db, shop_id, sp_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return result


# ---------------------------------------------------------------------------
# P7: approval and publish
# ---------------------------------------------------------------------------

@router.post("/shops/{shop_id}/pipeline/source-products/{sp_id}/create-draft")
def create_draft(shop_id: int, sp_id: int, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    try:
        draft = publish_service.create_listing_draft_from_pipeline(db, shop_id, sp_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"draft_id": draft.id, "offer_id": draft.offer_id, "status": draft.status}


@router.post("/shops/{shop_id}/pipeline/source-products/{sp_id}/approve")
def approve_product(shop_id: int, sp_id: int, payload: ApproveRequest, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    try:
        pipeline = publish_service.approve_for_publish(db, shop_id, sp_id, payload.approver_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"publish_status": pipeline.publish_status, "pipeline_stage": pipeline.pipeline_stage}


@router.post("/shops/{shop_id}/pipeline/source-products/{sp_id}/submit")
def submit_product(shop_id: int, sp_id: int, payload: ApproveRequest, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    try:
        result = publish_service.submit_to_ozon(db, shop_id, sp_id, payload.approver_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


@router.get("/shops/{shop_id}/pipeline/source-products/{sp_id}/task-status")
def get_task_status(shop_id: int, sp_id: int, db: Session = Depends(get_db)):
    _get_shop_or_404(db, shop_id)
    try:
        result = publish_service.poll_task_status(db, shop_id, sp_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return result


# ---------------------------------------------------------------------------
# Progress dashboard
# ---------------------------------------------------------------------------

@router.get("/pipeline/progress")
def get_pipeline_progress(db: Session = Depends(get_db)):
    return progress.get_progress(db)


@router.post("/pipeline/progress/refresh")
def refresh_pipeline_progress(db: Session = Depends(get_db)):
    return progress.get_progress(db)


# ---------------------------------------------------------------------------
# Chrome extension bridge endpoints
# These match the paths the extension already calls (no /v1 prefix).
# ---------------------------------------------------------------------------

ext_router = APIRouter(prefix="/api", tags=["extension"])


@ext_router.get("/stores")
def ext_list_stores(db: Session = Depends(get_db)):
    return extension_bridge.stores_for_extension(db)


@ext_router.get("/1688/status")
def ext_1688_status(storeId: int, offerId: str, db: Session = Depends(get_db)):
    if db.get(Shop, storeId) is None:
        raise HTTPException(status_code=404, detail="shop not found")
    return extension_bridge.capture_status(db, storeId, "1688", offerId.strip())


@ext_router.post("/1688/capture")
def ext_capture_1688(payload: dict, db: Session = Depends(get_db)):
    store_id = str(payload.get("storeId") or "").strip()
    if not store_id or not store_id.isdigit():
        raise HTTPException(status_code=422, detail="storeId is required (select a shop in the popup first)")
    shop_id = int(store_id)
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="shop not found")
    try:
        return extension_bridge.ingest_capture(db, shop_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@ext_router.post("/pdd/capture")
def ext_capture_pdd(payload: dict, db: Session = Depends(get_db)):
    store_id = str(payload.get("storeId") or "").strip()
    if not store_id or not store_id.isdigit():
        raise HTTPException(status_code=422, detail="storeId is required")
    shop_id = int(store_id)
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="shop not found")
    try:
        return extension_bridge.ingest_capture(db, shop_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@ext_router.post("/1688-crawler/extension/heartbeat")
def ext_crawler_heartbeat(payload: dict, db: Session = Depends(get_db)):
    return {"ok": True, "received": True}


@ext_router.get("/1688-crawler/extension/next")
def ext_crawler_next(workerId: str = "", db: Session = Depends(get_db)):
    # A shop scan is a streaming producer: every discovered Offer ID is
    # immediately eligible for detail capture. Do not hold the queue behind a
    # separate 100-item gate; human-verification pauses are handled by the
    # extension worker and remain the only external stop condition.
    candidate = db.scalar(select(AutomationCandidateRecord).where(
        AutomationCandidateRecord.status.in_(["queued_detail", "test_queued_detail", "full_hold_detail"])
    ).order_by(AutomationCandidateRecord.id).limit(1))
    if candidate is None:
        queued = db.scalar(select(func.count(AutomationCandidateRecord.id)).where(
            AutomationCandidateRecord.status == "queued_detail"
        )) or 0
        return {"job": None, "message": "waiting for discovered detail tasks", "queued": queued}
    candidate.status = "test_running_detail"
    db.commit()
    return {
        "job": {
            "id": candidate.id,
            "kind": "detail",
            "url": candidate.source_url or f"https://detail.1688.com/offer/{candidate.offer_id}.html",
            "offerId": candidate.offer_id,
            "storeId": str(candidate.shop_id or ""),
            "testBatch": False,
        },
        "message": "streaming 1688 detail collection",
    }


@ext_router.post("/1688-crawler/extension/detail-result")
def ext_crawler_detail_result(payload: dict, db: Session = Depends(get_db)):
    # Background job results -- ingest if payload contains product data
    inner = payload.get("payload") or {}
    store_id = str(inner.get("storeId") or payload.get("storeId") or "").strip()
    candidate = db.get(AutomationCandidateRecord, int(payload.get("jobId") or 0)) if str(payload.get("jobId") or "").isdigit() else None
    if candidate:
        try:
            candidate_meta = json.loads(candidate.package_json or "{}")
        except (TypeError, ValueError):
            candidate_meta = {}
        if candidate_meta.get("source_shop_key") and not inner.get("sourceShopKey"):
            inner["sourceShopKey"] = candidate_meta["source_shop_key"]
    if store_id and store_id.isdigit() and inner.get("title"):
        shop_id = int(store_id)
        if db.get(Shop, shop_id) is not None:
            try:
                result = extension_bridge.ingest_capture(db, shop_id, inner)
                if candidate:
                    candidate.status = "collected"
                    candidate.source_record_id = result.get("id")
                    candidate.capture_json = json.dumps(inner, ensure_ascii=False)
                    db.commit()
                return {"ok": True, "ingested": True, **result}
            except ValueError as exc:
                if candidate:
                    candidate.status = "failed"
                    candidate.rejection_reason = str(exc)[:1000]
                    db.commit()
    if candidate:
        candidate.status = "waiting_human" if payload.get("needsHuman") else "failed"
        candidate.rejection_reason = str(payload.get("error") or "详情采集未返回有效商品")[:1000]
        db.commit()
    return {"ok": True, "ingested": False}


@ext_router.post("/1688-crawler/extension/discover-result")
def ext_crawler_discover_result(payload: dict, db: Session = Depends(get_db)):
    return {"ok": True, "received": True}


@ext_router.post("/1688-crawler/tasks/{task_id}/resume")
def ext_crawler_resume(task_id: str, db: Session = Depends(get_db)):
    return {"ok": True, "resumed": True}


@ext_router.post("/ozon-learning/extension/heartbeat")
def ext_ozon_heartbeat(payload: dict, db: Session = Depends(get_db)):
    return {"ok": True, "received": True}


@ext_router.get("/ozon-learning/extension/next")
def ext_ozon_next(workerId: str = "", db: Session = Depends(get_db)):
    return {"job": None, "message": "no ozon jobs available"}


@ext_router.post("/ozon-learning/extension/search-result")
def ext_ozon_search_result(payload: dict, db: Session = Depends(get_db)):
    return {"ok": True, "received": True}


@ext_router.post("/ozon-learning/extension/detail-result")
def ext_ozon_detail_result(payload: dict, db: Session = Depends(get_db)):
    inner = payload.get("payload") or {}
    store_id = str(inner.get("storeId") or payload.get("storeId") or "").strip()
    if not store_id or not store_id.isdigit():
        return {"ok": False, "received": True, "ingested": False, "error": "storeId is required"}
    shop_id = int(store_id)
    if db.get(Shop, shop_id) is None:
        return {"ok": False, "received": True, "ingested": False, "error": "shop not found"}
    if payload.get("needsHuman"):
        return {"ok": True, "received": True, "ingested": False, "needsHuman": True}
    if not inner.get("title"):
        return {"ok": False, "received": True, "ingested": False, "error": "title is required"}
    try:
        result = extension_bridge.ingest_ozon_capture(db, shop_id, inner)
        return {"ok": True, "received": True, "ingested": True, **result}
    except ValueError as exc:
        return {"ok": False, "received": True, "ingested": False, "error": str(exc)}


@ext_router.post("/ozon/capture")
def ext_ozon_capture(payload: dict, db: Session = Depends(get_db)):
    """Direct foreground capture endpoint for a public Ozon detail page."""
    store_id = str(payload.get("storeId") or "").strip()
    snapshot = payload.get("payload") or {}
    if not store_id.isdigit():
        raise HTTPException(status_code=422, detail="storeId is required")
    shop_id = int(store_id)
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="shop not found")
    if not snapshot.get("title"):
        raise HTTPException(status_code=422, detail="Ozon 商品标题为空")
    try:
        return extension_bridge.ingest_ozon_capture(db, shop_id, snapshot)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@ext_router.post("/ozon/market-snapshots")
def ext_ozon_market_snapshot(payload: dict, db: Session = Depends(get_db)):
    """Store one user-triggered, read-only snapshot of the visible Ozon analytics table."""
    store_id = str(payload.get("storeId") or "").strip()
    snapshot = payload.get("snapshot") or {}
    if not store_id.isdigit():
        raise HTTPException(status_code=422, detail="storeId is required")
    shop_id = int(store_id)
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="shop not found")
    rows = snapshot.get("rows")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=422, detail="当前可见表格没有可采集商品")
    if len(rows) > 500:
        raise HTTPException(status_code=422, detail="单次最多采集 500 行")
    source_url = str(snapshot.get("sourceUrl") or "")[:2000]
    if not source_url.startswith("https://seller.ozon.ru/"):
        raise HTTPException(status_code=422, detail="只接受 Ozon Seller 官方分析页快照")
    from datetime import datetime, timezone
    captured_at = datetime.now(timezone.utc)
    try:
        value = str(snapshot.get("capturedAt") or "").replace("Z", "+00:00")
        if value:
            captured_at = datetime.fromisoformat(value)
    except ValueError:
        pass
    record = OzonMarketSnapshotRecord(
        shop_id=shop_id,
        source_page=str(snapshot.get("sourcePage") or "products_on_ozon")[:64],
        period_days=snapshot.get("periodDays") if snapshot.get("periodDays") in (7, 28) else None,
        category_filter=str(snapshot.get("categoryFilter") or "")[:500] or None,
        row_count=len(rows), source_url=source_url,
        capture_method=str(snapshot.get("captureMethod") or "visible_dom")[:32],
        raw_json=json.dumps(snapshot, ensure_ascii=False), captured_at=captured_at,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"ok": True, "snapshotId": record.id, "imported": len(rows), "capturedAt": record.captured_at}


@ext_router.get("/ozon/market-snapshots/latest")
def ext_latest_ozon_market_snapshot(storeId: int, db: Session = Depends(get_db)):
    if db.get(Shop, storeId) is None:
        raise HTTPException(status_code=404, detail="shop not found")
    record = db.scalar(select(OzonMarketSnapshotRecord).where(
        OzonMarketSnapshotRecord.shop_id == storeId,
    ).order_by(OzonMarketSnapshotRecord.id.desc()).limit(1))
    if record is None:
        return {"snapshot": None}
    return {
        "snapshotId": record.id, "shopId": record.shop_id, "rowCount": record.row_count,
        "capturedAt": record.captured_at, "snapshot": json.loads(record.raw_json),
    }


@ext_router.post("/1688/shop-scan/check")
def ext_1688_shop_scan_check(payload: dict, db: Session = Depends(get_db)):
    """Check a shop-list page against the global 1688 strong identity.

    This endpoint is deliberately read-only: enumerating a public shop catalog
    must not create incomplete source products or listing drafts.
    """
    offer_ids = list(dict.fromkeys(
        str(value).strip() for value in (payload.get("offerIds") or [])
        if str(value).strip().isdigit()
    ))[:100]
    if not offer_ids:
        return {"existingOfferIds": [], "newOfferIds": []}
    existing = set(db.scalars(select(SourceProductRecord.source_product_id).where(
        SourceProductRecord.source_platform == "1688",
        SourceProductRecord.source_product_id.in_(offer_ids),
    )).all())
    return {
        "existingOfferIds": [offer_id for offer_id in offer_ids if offer_id in existing],
        "newOfferIds": [offer_id for offer_id in offer_ids if offer_id not in existing],
    }


@ext_router.post("/1688/shop-scan/chunk")
def ext_1688_shop_scan_chunk(payload: dict, db: Session = Depends(get_db)):
    """Persist one shop page and enqueue each new Offer ID for detail capture."""
    shop_id = int(payload.get("storeId") or 0)
    if not shop_id or db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=422, detail="请先在插件选择归属店铺")
    shop_key = str(payload.get("shopKey") or "").strip()[:180]
    if not shop_key:
        raise HTTPException(status_code=422, detail="shopKey is required")
    task_name = f"1688店铺采集:{shop_key}"[:160]
    task = db.scalar(select(AutomationTaskRecord).where(AutomationTaskRecord.name == task_name))
    if task is None:
        task = AutomationTaskRecord(name=task_name, keywords_json="[]", filters_json="{}", daily_target=100000, status="active")
        db.add(task)
        db.flush()
    run = db.scalar(select(AutomationRunRecord).where(
        AutomationRunRecord.task_id == task.id,
        AutomationRunRecord.status.in_(["queued", "running"]),
    ).order_by(AutomationRunRecord.id.desc()))
    if run is None:
        run = AutomationRunRecord(task_id=task.id, status="running", current_stage="shop_detail")
        db.add(run)
        db.flush()
    added = already_known = 0
    for item in (payload.get("items") or [])[:100]:
        offer_id = str(item.get("offerId") or "").strip()
        if not offer_id.isdigit():
            continue
        if db.scalar(select(AutomationCandidateRecord.id).where(
            AutomationCandidateRecord.run_id == run.id,
            AutomationCandidateRecord.offer_id == offer_id,
        )):
            already_known += 1
            continue
        source = db.scalar(select(SourceProductRecord).where(
            SourceProductRecord.source_platform == "1688",
            SourceProductRecord.source_product_id == offer_id,
        ))
        db.add(AutomationCandidateRecord(
            run_id=run.id, task_id=task.id, offer_id=offer_id,
            title=str(item.get("title") or f"1688商品 {offer_id}")[:500],
            image_url=str(item.get("image") or "")[:2000] or None,
            source_url=str(item.get("url") or f"https://detail.1688.com/offer/{offer_id}.html")[:2000],
            package_json=json.dumps({"source_shop_key": shop_key}, ensure_ascii=False),
            status="collected" if source else "queued_detail",
            source_record_id=source.id if source else None, shop_id=shop_id,
        ))
        already_known += int(source is not None)
        added += int(source is None)
    db.flush()
    run.discovered_count = db.scalar(select(func.count(AutomationCandidateRecord.id)).where(AutomationCandidateRecord.run_id == run.id)) or 0
    run.collected_count = db.scalar(select(func.count(AutomationCandidateRecord.id)).where(AutomationCandidateRecord.run_id == run.id, AutomationCandidateRecord.status == "collected")) or 0
    db.commit()
    queued = db.scalar(select(func.count(AutomationCandidateRecord.id)).where(AutomationCandidateRecord.run_id == run.id, AutomationCandidateRecord.status == "queued_detail")) or 0
    return {"runId": run.id, "addedToDetailQueue": added, "alreadyKnown": already_known, "discovered": run.discovered_count, "queued": queued, "collected": run.collected_count}


@ext_router.post("/listing-edit-journal/events")
def ext_listing_edit_journal(payload: dict, db: Session = Depends(get_db)):
    return {"ok": True, "received": True}
