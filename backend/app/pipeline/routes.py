"""FastAPI router for the 1688 -> Ozon listing pipeline (P0-P7)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
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
    return {"job": None, "message": "no jobs available"}


@ext_router.post("/1688-crawler/extension/detail-result")
def ext_crawler_detail_result(payload: dict, db: Session = Depends(get_db)):
    # Background job results -- ingest if payload contains product data
    inner = payload.get("payload") or {}
    store_id = str(inner.get("storeId") or payload.get("storeId") or "").strip()
    if store_id and store_id.isdigit() and inner.get("title"):
        shop_id = int(store_id)
        if db.get(Shop, shop_id) is not None:
            try:
                result = extension_bridge.ingest_capture(db, shop_id, inner)
                return {"ok": True, "ingested": True, **result}
            except ValueError:
                pass
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
    return {"ok": True, "received": True}


@ext_router.post("/listing-edit-journal/events")
def ext_listing_edit_journal(payload: dict, db: Session = Depends(get_db)):
    return {"ok": True, "received": True}
