import hashlib
import os
import time
import httpx
import json
import re
import threading
import copy
import hashlib
import traceback as _traceback
from decimal import Decimal
from datetime import timedelta
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from urllib.parse import parse_qs, unquote, urlparse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, or_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import Base, engine, ensure_sqlite_operational_columns, get_db, settings
from . import erp_models  # noqa: F401 - registers persistent operational tables.
from .erp_models import AuditEventRecord, BulkListingBatchItemRecord, BulkListingBatchRecord, FbsPostingRecord, ListingAttributeValueRecord, ListingDraftRecord, ListingTemplateRecord, ListingVariantRecord, OzonAttributeCacheRecord, OzonAttributeDictionaryQueryCacheRecord, OzonAttributeDictionaryValueRecord, OzonCategoryCacheRecord, OzonGlobalCategoryCacheRecord, OzonGlobalAttributeCacheRecord, OzonGlobalDictValueRecord, PipelineProductRecord, ProductRecord, SyncRun, SyncState, SourceProductRecord, SourceProductShopRecord, YunNewtonSupplementJobRecord
from .models import ApiCredential, Shop
from .schemas import OzonCredentialStatus, OzonCredentialUpsert, ShopCreate, ShopRead, ShopUpdate
from .security import CredentialEncryptionUnavailable, encrypt_secret
from .sync_service import sync_category_cache, sync_fbs_postings, sync_fbs_product_images, sync_products
from .schemas import FbsPostingDetailRead, FbsPostingRead, FbsPostingSyncRequest, ListingDraftCreate, ListingDraftRead, ListingTemplateCreate, ListingValidationRead, ProductRead, ProductSyncRequest, SyncRunRead, ListingAttributeValueCreate, ListingVariantCreate
from .listing_service import build_variant_image_list, normalize_dictionary_attribute_value, validate_listing_draft
from .listing_cache_service import promote_legacy_listing_caches
from .pricing import PriceInput, PricingService
from .listing_template_service import apply_listing_template, create_listing_template
from .marketing_service import is_protected_promotion, product_ids_from_action_page
from .pricing_policy_service import domain_policy, get_pricing_policy, policy_dict, quote_source_price, update_pricing_policy
from .offer_id_service import normalize_offer_id, normalize_offer_ids
from .auto_sync import AutoSyncShopNotFound, request_auto_sync, run_auto_sync_resource
from .schemas import AutoSyncDecisionRead, AutoSyncRequest
from .listing_metadata_service import get_cached_category_attribute_values, get_category_attributes, search_category_attribute_values
from .pipeline.routes import router as pipeline_router, ext_router as pipeline_ext_router
from .automation_routes import router as automation_router, reconcile_bulk_stock_sync, reconcile_bulk_ozon_feedback, mark_bulk_items_for_ozon_feedback, _recover_stale_bulk_items
from .visual_image_routes import router as visual_image_router
from .automation_scheduler import start_scheduler, stop_scheduler
from .integrations.open1688 import Open1688Error, configuration_status as open1688_status, search_jxhy_products, get_jxhy_product_filters, get_product_details, detail_to_capture, save_application, authorization_url, exchange_code
from .integrations.image_product_intelligent import ImageProductIntelligentError, configuration_status as intelligent_title_status, save_application as save_intelligent_title_application, save_access_token as save_intelligent_title_token, generate as generate_intelligent_title, begin_authorization as begin_intelligent_title_authorization, exchange_code as exchange_intelligent_title_code
from .integrations.yunniudun import YunNewtonError, begin_authorization as yunniudun_authorization_url, configuration_status as yunniudun_status, create_read_only_task as create_yunniudun_read_only_task, exchange_code as yunniudun_exchange_code, fetch_task_table as fetch_yunniudun_task_table_api, get_task as get_yunniudun_task, list_models as list_yunniudun_models, list_tasks as list_yunniudun_tasks, save_application as save_yunniudun_application, save_existing_access_token as save_yunniudun_access_token, validate_existing_access_token as validate_yunniudun_access_token
from .integrations.yunniudun_supplement import YunNewtonSupplementError, build_link_collection_message, normalize_link_collection_result, offer_id_from_url
from .pipeline.extension_bridge import ingest_capture, _media_proxy_url
from .pipeline.publish_service import source_public_gallery
from .ai_service import translate_text, suggest_attribute_value, generate_description, generate_rich_content, match_category_with_ai, sanitize_hashtags, _chat


def _listing_change_signature(draft: ListingDraftRecord) -> dict:
    """Stable local snapshot used to route subsequent edits to the narrow Ozon API."""
    variants = []
    for variant in draft.variants:
        variants.append({
            "seller_sku": normalize_offer_id(variant.seller_sku),
            "price": str(variant.price_cny or variant.calculated_price_cny or ""),
            "old_price": str(variant.old_price_cny or ""),
            "min_price": str(variant.min_price_cny or ""),
            "weight": str(variant.weight_g or ""),
            "length": str(variant.length_mm or ""),
            "width": str(variant.width_mm or ""),
            "height": str(variant.height_mm or ""),
            "barcode": str(variant.barcode or ""),
            "stock": variant.stock,
            "image_url": variant.image_url or "",
            "variant_values": variant.variant_values_json or "",
        })
    attrs = [{"id": av.attribute_id, "value_id": av.value_id, "value": av.value_text} for av in draft.attribute_values]
    return {
        "category_id": str(draft.category_id or ""), "type_id": str(draft.type_id or ""),
        "title": draft.title or "", "description": draft.description or "",
        "images": draft.images or [], "video_url": draft.video_url or "",
        "attributes": attrs, "variants": variants,
    }


def _listing_change_hash(snapshot: dict) -> str:
    raw = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _listing_non_attribute_signature(snapshot: dict) -> dict:
    """Fields that cannot be sent through ProductUpdateAttributes."""
    result = copy.deepcopy(snapshot)
    result.pop("attributes", None)
    for variant in result.get("variants", []):
        # Variant dictionary selections are Ozon attributes too.
        variant.pop("variant_values", None)
    return result
from .auto_fill_service import auto_fill_attributes
from .listing_stock_monitor import audit_shop_fbs_inventory, monitor_due_listing_stocks, monitor_listing_stock
from .source_duplicate_service import conflicting_published_shops, source_publication_status
from .pipeline.fact_extraction import ProductFacts, extract_facts
from .pipeline.category_matching import recall_categories, rerank_categories
from .erp_models import SourceProductRecord, SourceVariantRecord, SourceMediaRecord
from .models import Warehouse
from .erp_models import CategoryMatchHistoryRecord, DecisionFeedbackRecord, DecisionMemoryRecord
from .decision_memory_service import finalize_successful_listing_memories, record_category_decision, recommend_categories

import hashlib
import time as _time

# SQLite is intentionally kept as a local/test-only convenience.  Production
# PostgreSQL schema changes are owned by Alembic and are applied by the
# deployment entrypoint before Uvicorn starts; calling ``create_all`` here
# would silently bypass migrations and can leave an already-running database
# half upgraded.
if settings.database_url.startswith("sqlite"):
    Base.metadata.create_all(bind=engine)
    ensure_sqlite_operational_columns()

app = FastAPI(title="Ozon ERP API", version="0.1.0")

_stock_monitor_stop = threading.Event()
_stock_monitor_thread: threading.Thread | None = None


def _background_external_writes_enabled() -> bool:
    """Require an explicit opt-in before a restart resumes unattended writes."""
    return os.getenv("OZON_ENABLE_BACKGROUND_WRITES", "0").strip().lower() in {"1", "true", "yes", "on"}


def _background_stock_monitor_enabled() -> bool:
    """Read the optional stock-worker switch (safe by default).

    The worker performs ``/v2/products/stocks`` writes.  It must therefore be
    subordinate to ``OZON_ENABLE_BACKGROUND_WRITES``; a separate opt-in can
    further disable it without disabling read-only feedback polling.
    """
    return os.getenv("OZON_ENABLE_BACKGROUND_STOCK_MONITOR", "0").strip().lower() in {"1", "true", "yes", "on"}


def _background_polling_enabled() -> bool:
    """Run read-only Ozon import feedback polling without enabling auto-resubmit."""
    return os.getenv("OZON_ENABLE_BACKGROUND_POLLING", "1").strip().lower() in {"1", "true", "yes", "on"}


@app.get("/api/v1/media-preview")
def media_preview(url: str = Query(min_length=1, max_length=4000)) -> RedirectResponse:
    """Resolve a captured Taobao video to its short-lived CDN URL for preview."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc.lower() != "media.woxq.cn" or parsed.path != "/proxy":
        raise HTTPException(status_code=400, detail="只允许已采集的视频代理地址")
    source_url = unquote(parse_qs(parsed.query).get("url", [""])[0]).strip()
    source = urlparse(source_url)
    if source.scheme != "https" or source.netloc.lower() != "cloud.video.taobao.com":
        raise HTTPException(status_code=400, detail="视频来源不在允许列表")
    try:
        response = httpx.get(source_url, headers={"Referer": "https://detail.1688.com/", "User-Agent": "Mozilla/5.0"}, follow_redirects=False, timeout=20)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"视频源连接失败：{exc}") from exc
    location = response.headers.get("location", "")
    if response.status_code not in {301, 302, 303, 307, 308} or not location.startswith("https://"):
        raise HTTPException(status_code=502, detail=f"视频源无法解析为可播放地址（HTTP {response.status_code}）")
    return RedirectResponse(location, status_code=302)


def _stock_monitor_loop() -> None:
    from .database import SessionLocal
    while not _stock_monitor_stop.wait(15):
        try:
            with SessionLocal() as monitor_db:
                monitor_due_listing_stocks(monitor_db)
        except Exception:
            continue


def _startup_reconcile_loop(external_writes: bool) -> None:
    """Recover persisted work without blocking the HTTP server startup.

    Historical import/stock reconciliation can touch thousands of records and
    remote Ozon APIs.  It must never run synchronously in FastAPI's startup
    hook, otherwise a restart makes the entire ERP appear offline.
    """
    from .database import SessionLocal
    try:
        with SessionLocal() as reconcile_db:
            _backfill_legacy_feedback(reconcile_db)
            if external_writes:
                from .visual_image_service import reconcile_interrupted_jobs
                reconcile_interrupted_jobs(reconcile_db)
                reconcile_bulk_stock_sync(reconcile_db)
            else:
                reconcile_bulk_ozon_feedback(reconcile_db)
    except Exception:
        # The scheduler/stock monitor will retry persisted work.  Startup must
        # remain available even when a legacy row or a remote call is slow.
        return


@app.on_event("startup")
def start_listing_stock_monitor() -> None:
    global _stock_monitor_thread
    from .database import SessionLocal
    external_writes = _background_external_writes_enabled()
    stock_monitor = _background_stock_monitor_enabled()
    polling = _background_polling_enabled()
    # A FastAPI BackgroundTask disappears on a backend restart.  Recover
    # locally interrupted rows immediately, before accepting a new bulk-run:
    # rows that already have an Ozon task stay submitted; only rows that never
    # crossed the Ozon boundary go back to the queue.  This is intentionally
    # local-only and performs no Ozon write or inventory action.
    try:
        with SessionLocal() as startup_db:
            recovered = _recover_stale_bulk_items(startup_db, stale_after=timedelta(seconds=0))
            if recovered:
                for running_batch in startup_db.scalars(select(BulkListingBatchRecord).where(BulkListingBatchRecord.status == "running")):
                    still_processing = startup_db.scalar(select(func.count(BulkListingBatchItemRecord.id)).where(
                        BulkListingBatchItemRecord.batch_id == running_batch.id,
                        BulkListingBatchItemRecord.status == "processing",
                    )) or 0
                    if not still_processing:
                        # The old worker is gone.  Expose a resumable state so
                        # one direct "continue" starts the next queue row;
                        # do not leave the browser on a false running state.
                        running_batch.status = "ready_to_continue"
                startup_db.commit()
    except Exception:
        pass
    # BackgroundTasks do not survive a process restart. Read-only feedback
    # polling and the persisted stock monitor are independent of bulk
    # auto-resubmit. This prevents a restart from silently creating products,
    # while still ensuring imported SKUs receive their inventory follow-up.
    if polling or external_writes:
        threading.Thread(
            target=_startup_reconcile_loop,
            args=(external_writes,),
            name="ozon-startup-reconcile",
            daemon=True,
        ).start()
    # Stock reconciliation includes an external Ozon write.  Never let the
    # optional stock flag bypass the explicit global write gate after restart.
    if external_writes and stock_monitor and not (_stock_monitor_thread and _stock_monitor_thread.is_alive()):
        _stock_monitor_stop.clear()
        _stock_monitor_thread = threading.Thread(target=_stock_monitor_loop, name="listing-stock-monitor", daemon=True)
        _stock_monitor_thread.start()
    if polling or external_writes:
        start_scheduler(allow_external_writes=external_writes)


@app.on_event("shutdown")
def stop_listing_stock_monitor() -> None:
    _stock_monitor_stop.set()
    stop_scheduler()


# ── Debug error logging ──
_DEBUG_LOG_FILE = os.path.join(os.path.dirname(__file__), "save_errors.log")

@app.exception_handler(Exception)
async def _log_all_errors(request: Request, exc: Exception):
    err_detail = str(exc)
    if hasattr(exc, "errors"):
        try:
            err_detail = str(exc.errors())
        except Exception:
            pass
    log_line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {request.method} {request.url.path} -> {type(exc).__name__}: {err_detail}\n"
    try:
        with open(_DEBUG_LOG_FILE, "a", encoding="utf-8") as lf:
            lf.write(log_line)
            lf.write(_traceback.format_exc())
            lf.write("\n---\n")
    except Exception:
        pass
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    if hasattr(exc, "errors"):
        return JSONResponse(status_code=422, content={"detail": str(exc.errors())})
    return JSONResponse(status_code=500, content={"detail": err_detail})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipeline_router)
app.include_router(pipeline_ext_router)
app.include_router(automation_router)
app.include_router(visual_image_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/operation-logs")
def operation_logs(
    shop_id: int | None = Query(default=None, gt=0),
    action: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=100, ge=1, le=500),
    before_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
) -> dict:
    """Return the append-only operator/Ozon audit stream for the ERP log view."""
    statement = select(AuditEventRecord)
    count_statement = select(func.count(AuditEventRecord.id))
    predicates = []
    if shop_id is not None:
        predicates.append(AuditEventRecord.shop_id == shop_id)
    if action:
        predicates.append(AuditEventRecord.action == action)
    if before_id is not None:
        predicates.append(AuditEventRecord.id < before_id)
    if predicates:
        statement = statement.where(*predicates)
        count_statement = count_statement.where(*predicates)
    rows = list(db.scalars(statement.order_by(AuditEventRecord.id.desc()).limit(limit)))
    def decode_details(value: str | None):
        raw = value or ""
        if not raw.strip().startswith(("{", "[")):
            return raw
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return raw

    return {
        "items": [
            {
                "id": row.id,
                "shop_id": row.shop_id,
                "actor_id": row.actor_id,
                "action": row.action,
                "entity_type": row.entity_type,
                "entity_id": row.entity_id,
                "details": decode_details(row.details_json),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ],
        "total": int(db.scalar(count_statement) or 0),
        "next_before_id": rows[-1].id if rows else None,
    }


@app.get("/api/v1/open1688/status")
def get_open1688_status() -> dict:
    return open1688_status()

class IntelligentTitleRequest(BaseModel):
    image_url: str = Field(min_length=8, max_length=2000)
    cat_id: int

@app.post("/api/v1/open1688/intelligent-title")
def open1688_intelligent_title(payload: IntelligentTitleRequest) -> dict:
    try:
        return {"ok": True, **generate_intelligent_title(payload.image_url, payload.cat_id)}
    except ImageProductIntelligentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


class IntelligentTitleApplicationWrite(BaseModel):
    app_key: str = Field(min_length=4, max_length=30)
    app_secret: str = Field(min_length=6, max_length=200)


class IntelligentTitleAccessTokenWrite(BaseModel):
    access_token: str = Field(min_length=8, max_length=4000)


@app.get("/api/v1/image-product-intelligent/status")
def get_intelligent_title_status() -> dict:
    return intelligent_title_status()


@app.put("/api/v1/image-product-intelligent/application")
def put_intelligent_title_application(payload: IntelligentTitleApplicationWrite) -> dict:
    try:
        save_intelligent_title_application(payload.app_key, payload.app_secret)
    except ImageProductIntelligentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "status": intelligent_title_status()}


@app.put("/api/v1/image-product-intelligent/access-token")
def put_intelligent_title_access_token(payload: IntelligentTitleAccessTokenWrite) -> dict:
    try:
        save_intelligent_title_token(payload.access_token)
    except ImageProductIntelligentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True, "status": intelligent_title_status()}


class IntelligentTitleCodeWrite(BaseModel):
    code_or_url: str = Field(min_length=4, max_length=2000)


@app.get("/api/v1/image-product-intelligent/authorize")
def get_intelligent_title_authorize() -> dict:
    try:
        return {"authorization_url": begin_intelligent_title_authorization()}
    except ImageProductIntelligentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/v1/image-product-intelligent/token")
def post_intelligent_title_token(payload: IntelligentTitleCodeWrite) -> dict:
    try:
        return exchange_intelligent_title_code(payload.code_or_url)
    except ImageProductIntelligentError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/v1/image-product-intelligent/generate")
def post_intelligent_title_generate(payload: IntelligentTitleRequest) -> dict:
    try:
        return {"ok": True, **generate_intelligent_title(payload.image_url, payload.cat_id)}
    except ImageProductIntelligentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

class Open1688ApplicationWrite(BaseModel):
    app_key: str = Field(min_length=4, max_length=30)
    app_secret: str = Field(min_length=6, max_length=200)
    redirect_uri: str = Field(min_length=8, max_length=500)

class Open1688CodeWrite(BaseModel):
    code_or_url: str = Field(min_length=4, max_length=1000)

@app.put("/api/v1/open1688/application")
def put_open1688_application(payload: Open1688ApplicationWrite) -> dict:
    save_application(payload.app_key, payload.app_secret, payload.redirect_uri)
    return {"ok": True, "authorization_url": authorization_url()}

@app.post("/api/v1/open1688/token")
def post_open1688_token(payload: Open1688CodeWrite) -> dict:
    try: return exchange_code(payload.code_or_url)
    except Open1688Error as exc: raise HTTPException(status_code=502, detail=str(exc)) from exc


_YUNNIUDUN_DEFAULT_REDIRECT_URI = os.getenv(
    "YUNNIUDUN_REDIRECT_URI",
    "https://auth.1688.com/auth/authCode.htm",
)


class YunNewtonApplicationWrite(BaseModel):
    app_key: str = Field(min_length=4, max_length=30)
    app_secret: str = Field(min_length=6, max_length=200)
    redirect_uri: str = Field(default=_YUNNIUDUN_DEFAULT_REDIRECT_URI, min_length=8, max_length=500)


class YunNewtonCodeWrite(BaseModel):
    code_or_url: str = Field(min_length=4, max_length=2000)


class YunNewtonAccessTokenWrite(BaseModel):
    # Do not use a Pydantic length constraint here: validation errors can echo
    # rejected input values, while an access token must never be reflected.
    access_token: str


class YunNewtonValidationWrite(BaseModel):
    confirm: bool = False


class YunNewtonSupplementCreate(BaseModel):
    shop_id: int = Field(gt=0)
    source_url: str = Field(min_length=20, max_length=2000)


class YunNewtonSupplementStart(BaseModel):
    confirm: bool = False


class YunNewtonTaskTableFetch(BaseModel):
    task_id: str = Field(min_length=1, max_length=128)
    table_id: str = Field(min_length=1, max_length=300)
    scene: str = Field(default="newton", min_length=1, max_length=64)
    sub_scene: str = Field(default="purchase", min_length=1, max_length=64)
    stage: str | None = Field(default="recall", max_length=64)
    page_no: int = Field(default=1, ge=1, le=10000)
    page_size: int = Field(default=10, ge=1, le=100)


@app.get("/api/v1/yunniudun/status")
def get_yunniudun_status() -> dict:
    return yunniudun_status()


@app.get("/api/v1/yunniudun/tasks")
def get_yunniudun_tasks(page_no: int | None = Query(default=None, ge=1, le=10000), page_size: int | None = Query(default=None, ge=1, le=100),) -> dict:
    """Read the account task list; this does not create or resume tasks."""
    try:
        return list_yunniudun_tasks(page_no=page_no, page_size=page_size)
    except YunNewtonError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/v1/yunniudun/models")
def get_yunniudun_models() -> dict:
    """Read the provider's currently available model tiers."""
    try:
        return list_yunniudun_models()
    except YunNewtonError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/v1/yunniudun/task-table")
def fetch_yunniudun_task_table(payload: YunNewtonTaskTableFetch) -> dict:
    """Read a complex result table emitted by a Newton task."""
    try:
        return fetch_yunniudun_task_table_api(
            payload.task_id,
            payload.table_id,
            scene=payload.scene,
            sub_scene=payload.sub_scene,
            stage=payload.stage,
            page_no=payload.page_no,
            page_size=payload.page_size,
        )
    except YunNewtonError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.put("/api/v1/yunniudun/application")
def put_yunniudun_application(payload: YunNewtonApplicationWrite) -> dict:
    """Store the app locally; this never calls Yun Newton or 1688."""
    save_yunniudun_application(payload.app_key, payload.app_secret, payload.redirect_uri)
    return {"ok": True, "authorization_url": yunniudun_authorization_url(), "redirect_uri": payload.redirect_uri}


@app.get("/api/v1/yunniudun/authorize")
def begin_yunniudun_authorization() -> dict:
    try:
        return {"authorization_url": yunniudun_authorization_url()}
    except YunNewtonError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/v1/yunniudun/token")
def post_yunniudun_token(payload: YunNewtonCodeWrite) -> dict:
    """Exchange the complete URL returned by the 1688 shared callback page."""
    try:
        return yunniudun_exchange_code(payload.code_or_url)
    except YunNewtonError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.put("/api/v1/yunniudun/access-token")
def put_yunniudun_access_token(payload: YunNewtonAccessTokenWrite) -> dict:
    """Save an operator-entered author token without ever returning it."""
    if not payload.access_token or len(payload.access_token.strip()) < 8:
        raise HTTPException(status_code=400, detail="授权令牌格式无效")
    try:
        save_yunniudun_access_token(payload.access_token)
    except YunNewtonError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True, "status": yunniudun_status()}


@app.post("/api/v1/yunniudun/validate")
def post_yunniudun_validate(payload: YunNewtonValidationWrite) -> dict:
    """Perform the documented no-task ``task.get`` authorization probe."""
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="请先在页面确认执行只读授权验证")
    try:
        return validate_yunniudun_access_token()
    except YunNewtonError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _yunniudun_supplement_read(row: YunNewtonSupplementJobRecord) -> dict:
    return {
        "id": row.id,
        "shop_id": row.shop_id,
        "source_url": row.source_url,
        "offer_id": row.offer_id,
        "status": row.status,
        "provider_task_id": row.provider_task_id,
        "provider_session_id": row.provider_session_id,
        "next_index": row.next_index,
        "parse_issues": json.loads(row.parse_issues_json or "[]"),
        "source_product_id": row.source_product_id,
        "error_message": row.error_message,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


@app.get("/api/v1/yunniudun/supplements")
def list_yunniudun_supplements(shop_id: int | None = Query(default=None, gt=0), db: Session = Depends(get_db)) -> dict:
    statement = select(YunNewtonSupplementJobRecord).order_by(YunNewtonSupplementJobRecord.id.desc()).limit(100)
    if shop_id:
        statement = statement.where(YunNewtonSupplementJobRecord.shop_id == shop_id)
    return {"items": [_yunniudun_supplement_read(row) for row in db.scalars(statement)]}


@app.post("/api/v1/yunniudun/supplements", status_code=201)
def create_yunniudun_supplement(payload: YunNewtonSupplementCreate, db: Session = Depends(get_db)) -> dict:
    """Create a local reviewable supplement job without calling Yun Newton."""
    if not yunniudun_status()["configured"]:
        raise HTTPException(status_code=409, detail="请先在云牛顿接入页保存完整授权")
    if db.get(Shop, payload.shop_id) is None:
        raise HTTPException(status_code=404, detail="目标 Ozon 店铺不存在")
    try:
        offer_id = offer_id_from_url(payload.source_url)
        request_message = build_link_collection_message(payload.source_url)
    except YunNewtonSupplementError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    row = YunNewtonSupplementJobRecord(
        shop_id=payload.shop_id,
        source_url=payload.source_url.strip(),
        offer_id=offer_id,
        status="draft",
        request_message=request_message,
    )
    db.add(row)
    db.flush()
    db.add(AuditEventRecord(
        shop_id=payload.shop_id,
        actor_id="operator",
        action="yunniudun_supplement_draft_created",
        entity_type="yunniudun_supplement_job",
        entity_id=str(row.id),
        details_json=json.dumps({"offer_id": offer_id, "source_url": payload.source_url.strip()}, ensure_ascii=False),
    ))
    db.commit()
    db.refresh(row)
    return {"ok": True, "item": _yunniudun_supplement_read(row), "message": "本地补采任务已创建，尚未调用云牛顿"}


@app.post("/api/v1/yunniudun/supplements/{job_id}/start")
def start_yunniudun_supplement(job_id: int, payload: YunNewtonSupplementStart, db: Session = Depends(get_db)) -> dict:
    """Start one explicitly confirmed read-only Newton Cloud task."""
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="请先确认调用云牛顿 task.create；该调用可能消耗积分")
    row = db.get(YunNewtonSupplementJobRecord, job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="补采任务不存在")
    if row.provider_task_id:
        return {"ok": True, "item": _yunniudun_supplement_read(row), "message": "该补采任务已经提交，不重复创建"}
    if row.status not in {"draft", "failed"}:
        raise HTTPException(status_code=409, detail=f"当前状态不可启动：{row.status}")
    try:
        result = create_yunniudun_read_only_task(row.request_message, auto=True)
    except YunNewtonError as exc:
        row.status = "failed"
        row.error_message = str(exc)[:2000]
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    row.provider_task_id = result["taskId"]
    row.provider_session_id = result.get("sessionId") or None
    row.status = "submitted"
    row.raw_result_json = json.dumps(result, ensure_ascii=False)
    row.error_message = None
    db.add(AuditEventRecord(
        shop_id=row.shop_id,
        actor_id="operator",
        action="yunniudun_supplement_task_created",
        entity_type="yunniudun_supplement_job",
        entity_id=str(row.id),
        details_json=json.dumps({"offer_id": row.offer_id, "provider_task_id": row.provider_task_id, "provider_status": result.get("status")}, ensure_ascii=False),
    ))
    db.commit()
    db.refresh(row)
    return {"ok": True, "item": _yunniudun_supplement_read(row), "message": "云牛顿补采任务已提交，等待回传"}


@app.post("/api/v1/yunniudun/supplements/{job_id}/poll")
def poll_yunniudun_supplement(job_id: int, db: Session = Depends(get_db)) -> dict:
    """Fetch incremental task output and ingest only a normalized source snapshot."""
    row = db.get(YunNewtonSupplementJobRecord, job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="补采任务不存在")
    if not row.provider_task_id:
        raise HTTPException(status_code=409, detail="补采任务尚未提交")
    if row.status == "completed":
        return {"ok": True, "provider_status": "END", "output_status": "done", "item": _yunniudun_supplement_read(row)}
    try:
        result = get_yunniudun_task(row.provider_task_id, from_index=row.next_index, include_blocks=True)
    except YunNewtonError as exc:
        row.error_message = str(exc)[:2000]
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    row.provider_session_id = result.get("sessionId") or row.provider_session_id
    row.next_index = max(row.next_index, int(result.get("nextIndex") or row.next_index))
    row.raw_result_json = json.dumps(result, ensure_ascii=False)
    provider_status = str(result.get("status") or "").upper()
    output_status = str(result.get("outputStatus") or "").lower()
    if provider_status in {"INIT", "QUEUED", "RUNNING"} and output_status != "wait_user":
        row.status = "running"
    elif provider_status == "WAIT_SKILL" and output_status != "wait_user":
        row.status = "running"
    elif provider_status == "WAIT_USER" or output_status == "wait_user":
        row.status = "waiting_human"
    elif provider_status in {"KILL", "ERROR"} or output_status == "error":
        row.status = "failed"
        row.error_message = result.get("error") or "云牛顿任务已终止"
    elif provider_status == "END":
        try:
            capture = normalize_link_collection_result({"messages": result.get("messages"), "content": result.get("content"), "chunks": result.get("chunks")}, row.source_url)
        except YunNewtonSupplementError as exc:
            row.status = "failed"
            row.error_message = str(exc)[:2000]
        else:
            row.normalized_capture_json = json.dumps(capture, ensure_ascii=False)
            row.parse_issues_json = json.dumps(capture.get("parseIssues") or [], ensure_ascii=False)
            try:
                ingested = ingest_capture(db, row.shop_id, capture)
            except ValueError as exc:
                row.status = "failed"
                row.error_message = str(exc)[:2000]
            else:
                row.source_product_id = int(ingested["id"])
                row.status = "completed"
                row.error_message = None
                db.add(AuditEventRecord(
                    shop_id=row.shop_id,
                    actor_id="operator",
                    action="yunniudun_supplement_result_ingested",
                    entity_type="yunniudun_supplement_job",
                    entity_id=str(row.id),
                    details_json=json.dumps({"offer_id": row.offer_id, "source_product_id": row.source_product_id, "parse_issues": capture.get("parseIssues", [])}, ensure_ascii=False),
                ))
    elif provider_status:
        row.status = "failed"
        row.error_message = result.get("error") or f"云牛顿返回未知任务状态：{provider_status}"
    db.commit()
    db.refresh(row)
    return {"ok": True, "provider_status": provider_status, "output_status": result.get("outputStatus"), "item": _yunniudun_supplement_read(row)}


@app.get("/api/v1/yunniudun/oauth/callback")
def yunniudun_oauth_callback(code: str = Query(default="", max_length=2000), state: str = Query(default="", max_length=500)) -> HTMLResponse:
    """Local browser callback after the operator approves the Alibaba author page."""
    try:
        yunniudun_exchange_code(code, state=state)
    except YunNewtonError as exc:
        return HTMLResponse(f"<h3>云牛顿授权未完成</h3><p>{str(exc)}</p>", status_code=502)
    return HTMLResponse("<h3>云牛顿授权完成</h3><p>已安全保存 Token，可以关闭本页并回到 ERP。</p>")


@app.get("/api/v1/open1688/jxhy/products")
def get_open1688_jxhy_products(keyword: str = Query(default="", max_length=100), page_num: int = Query(default=1, ge=1, le=1000), page_size: int = Query(default=20, ge=1, le=50), category_id: int | None = Query(default=None, gt=0), price_start: str = Query(default="", max_length=20), price_end: str = Query(default="", max_length=20), filters: list[str] = Query(default=[]), rule_ids: list[str] = Query(default=[])) -> dict:
    if not keyword.strip() and not (category_id or filters or rule_ids):
        raise HTTPException(status_code=422, detail="请输入关键词或至少选择一个官方筛选条件")
    try:
        return search_jxhy_products(keyword, page_num, page_size, category_id=category_id, price_start=price_start, price_end=price_end, filters=filters, rule_ids=rule_ids)
    except Open1688Error as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/v1/open1688/jxhy/product-filters")
def get_open1688_jxhy_product_filters() -> dict:
    try:
        return {"items": get_jxhy_product_filters()}
    except Open1688Error as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class JxhyBatchInspect(BaseModel):
    offer_ids: list[str] = Field(min_length=1, max_length=20)


class JxhyBatchCollect(JxhyBatchInspect):
    shop_id: int = Field(gt=0)
    require_complete_package: bool = True


@app.post("/api/v1/open1688/jxhy/inspect-package")
def inspect_jxhy_package(payload: JxhyBatchInspect) -> dict:
    try:
        details = get_product_details(payload.offer_ids)
        inspected = []
        for detail in details:
            capture, package = detail_to_capture(detail)
            inspected.append({**package, "title": capture["title"], "image_url": (capture["images"] or [""])[0]})
        return {"requested": len(payload.offer_ids), "returned": len(inspected), "items": inspected}
    except Open1688Error as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/v1/open1688/jxhy/collect")
def collect_jxhy_products(payload: JxhyBatchCollect, db: Session = Depends(get_db)) -> dict:
    if db.get(Shop, payload.shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")
    try:
        details = get_product_details(payload.offer_ids)
    except Open1688Error as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    collected, skipped, failed = [], [], []
    for detail in details:
        capture, package = detail_to_capture(detail)
        if payload.require_complete_package and not package["has_complete_package"]:
            skipped.append({**package, "title": capture["title"], "reason": "缺少完整重量或包装长宽高"})
            continue
        try:
            result = ingest_capture(db, payload.shop_id, capture)
            collected.append({**package, "source_record_id": result["id"], "duplicate": result["duplicate"], "title": result["title"]})
        except ValueError as exc:
            failed.append({**package, "title": capture["title"], "reason": str(exc)})
    returned_ids = {str(item.get("offer_id")) for item in collected + skipped + failed}
    for missing in [str(value) for value in payload.offer_ids if str(value) not in returned_ids]:
        failed.append({"offer_id": missing, "reason": "官方详情接口未返回该商品"})
    return {"requested": len(payload.offer_ids), "collected": collected, "skipped": skipped, "failed": failed}


class PricingPolicyWrite(BaseModel):
    purchase_buffer_cny: Decimal = Field(ge=0, le=1000)
    commission_rate: Decimal = Field(ge=0, lt=1)
    misc_fee_rate: Decimal = Field(ge=0, lt=1)
    fixed_misc_fee: Decimal = Field(ge=0, le=1000)
    target_profit_rate: Decimal = Field(gt=0, lt=0.9)
    old_price_multiplier: Decimal = Field(ge=1, le=10)
    listing_price_floor_cny: Decimal = Field(ge=0.01, le=635)
    minimum_profit_rate: Decimal = Field(ge=0, lt=0.9)
    minimum_profit_cny: Decimal = Field(ge=0, le=10000)
    logistics_ratio_warn: Decimal = Field(gt=0, le=1)
    max_iterations: int = Field(ge=5, le=100)


class PricingQuoteItem(BaseModel):
    source_sku: str = Field(default="", max_length=128)
    source_price_cny: Decimal = Field(ge=0)
    weight_g: Decimal = Field(gt=0)
    length_mm: Decimal = Field(gt=0)
    width_mm: Decimal = Field(gt=0)
    height_mm: Decimal = Field(gt=0)


class PricingQuotesRequest(BaseModel):
    shop_id: int = Field(gt=0)
    items: list[PricingQuoteItem] = Field(min_length=1, max_length=100)
    policy: PricingPolicyWrite | None = None


@app.get("/api/v1/pricing/policy")
def read_pricing_policy(db: Session = Depends(get_db)) -> dict:
    return policy_dict(get_pricing_policy(db))


def _validate_pricing_policy_values(values: dict) -> None:
    if values["minimum_profit_rate"] > values["target_profit_rate"]:
        raise HTTPException(status_code=422, detail="最低利润率不能高于目标利润率")
    if values["commission_rate"] + values["misc_fee_rate"] + values["target_profit_rate"] >= Decimal("0.95"):
        raise HTTPException(status_code=422, detail="佣金率、杂费率和目标利润率合计必须低于 95%")


@app.put("/api/v1/pricing/policy")
def save_pricing_policy(payload: PricingPolicyWrite, db: Session = Depends(get_db)) -> dict:
    values = payload.model_dump()
    _validate_pricing_policy_values(values)
    before = policy_dict(get_pricing_policy(db))
    record = update_pricing_policy(db, {**values, "updated_by": "operator"})
    after = policy_dict(record)
    for shop in db.scalars(select(Shop).order_by(Shop.id)):
        db.add(AuditEventRecord(
            shop_id=shop.id,
            actor_id="operator",
            action="pricing_policy_updated",
            entity_type="pricing_policy",
            entity_id="1",
            details_json=json.dumps({"before": before, "after": after}, ensure_ascii=False, default=str),
        ))
    db.commit()
    return after


@app.post("/api/v1/pricing/quotes")
def calculate_pricing_quotes(payload: PricingQuotesRequest, db: Session = Depends(get_db)) -> dict:
    if db.get(Shop, payload.shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")
    if payload.policy:
        _validate_pricing_policy_values(payload.policy.model_dump())
    results = []
    for item in payload.items:
        quote = quote_source_price(
            db,
            shop_id=payload.shop_id,
            source_price_cny=item.source_price_cny,
            weight_g=item.weight_g,
            length_mm=item.length_mm,
            width_mm=item.width_mm,
            height_mm=item.height_mm,
            policy_values=payload.policy.model_dump() if payload.policy else None,
        )
        results.append({"source_sku": item.source_sku, **quote})
    return {"policy": policy_dict(get_pricing_policy(db)), "results": results}


@app.get("/api/v1/shops/{shop_id}/marketing/promotions")
def list_marketing_promotions(shop_id: int, db: Session = Depends(get_db)) -> list[dict]:
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient
    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        actions = client.list_promotions().get("result", [])
    return [{**action, "protected": is_protected_promotion(action.get("action_type"))} for action in actions]

@app.get("/api/v1/marketing/promotions")
def list_all_marketing_promotions(db: Session = Depends(get_db)) -> list[dict]:
    results = []
    for shop in db.scalars(select(Shop).order_by(Shop.id)):
        try:
            results.extend([{**a, "shop_id": shop.id, "shop_name": shop.name} for a in list_marketing_promotions(shop.id, db)])
        except Exception as exc:
            results.append({"shop_id": shop.id, "shop_name": shop.name, "load_error": str(exc), "protected": True})
    return results


class ExitAllPromotionsRequest(BaseModel):
    confirmed: bool = False


@app.post("/api/v1/marketing/promotions/exit-all")
def exit_all_marketing_promotions(payload: ExitAllPromotionsRequest, db: Session = Depends(get_db)) -> dict:
    if not payload.confirmed:
        raise HTTPException(status_code=422, detail="必须明确确认后才能退出营销活动")
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient
    summary = {"removed_products": 0, "completed_actions": [], "protected_actions": [], "failures": []}
    for shop in db.scalars(select(Shop).order_by(Shop.id)):
        shop_events = []
        try:
            client_id, api_key = _credentials(db, shop.id)
            with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
                for action in client.list_promotions().get("result", []):
                    action_type = str(action.get("action_type") or "")
                    action_id = int(action.get("id") or 0)
                    if is_protected_promotion(action_type):
                        summary["protected_actions"].append({"shop": shop.name, "action_id": action_id, "type": action_type})
                        continue
                    if not action.get("is_participating"):
                        continue
                    try:
                        product_ids = []
                        last_id = ""
                        while True:
                            page = client.list_promotion_products(action_id=action_id, limit=1000, last_id=last_id)
                            product_ids.extend(product_ids_from_action_page(page))
                            next_id = str((page.get("result") or {}).get("last_id") or "")
                            if not next_id or next_id == last_id:
                                break
                            last_id = next_id
                        for start in range(0, len(product_ids), 1000):
                            client.deactivate_promotion_products(action_id=action_id, product_ids=product_ids[start:start + 1000])
                        event = {"shop": shop.name, "action_id": action_id, "title": action.get("title", ""), "removed": len(product_ids)}
                        summary["completed_actions"].append(event); shop_events.append(event)
                        summary["removed_products"] += len(product_ids)
                    except Exception as exc:
                        summary["failures"].append({"shop": shop.name, "action_id": action_id, "error": str(exc)})
            db.add(AuditEventRecord(shop_id=shop.id, actor_id="operator", action="promotion_exit_all", entity_type="shop", entity_id=str(shop.id), details_json=json.dumps(shop_events, ensure_ascii=False)))
            db.commit()
        except Exception as exc:
            summary["failures"].append({"shop": shop.name, "error": str(exc)})
    return summary




@app.post("/api/v1/shops", response_model=ShopRead, status_code=status.HTTP_201_CREATED)
def create_shop(payload: ShopCreate, db: Session = Depends(get_db)) -> Shop:
    shop = Shop(**payload.model_dump())
    db.add(shop)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Shop name already exists") from exc
    db.refresh(shop)
    return shop


@app.get("/api/v1/shops", response_model=list[ShopRead])
def list_shops(db: Session = Depends(get_db)) -> list[Shop]:
    return list(db.scalars(select(Shop).order_by(Shop.id)))


@app.get("/api/v1/shops/{shop_id}", response_model=ShopRead)
def get_shop(shop_id: int, db: Session = Depends(get_db)) -> Shop:
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=404, detail="Shop not found")
    return shop


@app.patch("/api/v1/shops/{shop_id}", response_model=ShopRead)
def update_shop(shop_id: int, payload: ShopUpdate, db: Session = Depends(get_db)) -> Shop:
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=404, detail="Shop not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(shop, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Shop name already exists") from exc
    db.refresh(shop)
    return shop


@app.delete("/api/v1/shops/{shop_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shop(shop_id: int, db: Session = Depends(get_db)) -> Response:
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=404, detail="Shop not found")
    has_business_data = any(
        db.scalar(select(model.id).where(model.shop_id == shop_id).limit(1)) is not None
        for model in (ProductRecord, FbsPostingRecord, AuditEventRecord)
    )
    if has_business_data:
        raise HTTPException(status_code=409, detail="店铺已有业务数据，请先停用，不可删除")
    db.query(SyncState).filter(SyncState.shop_id == shop_id).delete()
    db.query(SyncRun).filter(SyncRun.shop_id == shop_id).delete()
    db.query(OzonAttributeDictionaryQueryCacheRecord).filter(OzonAttributeDictionaryQueryCacheRecord.shop_id == shop_id).delete()
    db.query(OzonAttributeDictionaryValueRecord).filter(OzonAttributeDictionaryValueRecord.shop_id == shop_id).delete()
    db.query(OzonAttributeCacheRecord).filter(OzonAttributeCacheRecord.shop_id == shop_id).delete()
    db.query(OzonCategoryCacheRecord).filter(OzonCategoryCacheRecord.shop_id == shop_id).delete()
    db.delete(shop)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.put("/api/v1/shops/{shop_id}/credentials/ozon", response_model=OzonCredentialStatus)
def upsert_ozon_credential(
    shop_id: int, payload: OzonCredentialUpsert, db: Session = Depends(get_db)
) -> ApiCredential:
    """Save Ozon Seller Client-Id + Api-Key encrypted at rest; never returns Api-Key."""
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="Shop not found")
    try:
        encrypted_key = encrypt_secret(payload.api_key.get_secret_value())
    except CredentialEncryptionUnavailable as exc:
        raise HTTPException(status_code=503, detail="Credential encryption is not configured") from exc
    credential = db.scalar(select(ApiCredential).where(ApiCredential.shop_id == shop_id, ApiCredential.provider == "ozon"))
    if credential is None:
        credential = ApiCredential(shop_id=shop_id, provider="ozon")
        db.add(credential)
    credential.client_id_reference = payload.client_id
    credential.encrypted_secret_placeholder = encrypted_key
    credential.key_identifier = payload.key_label or f"ozon-{shop_id}"
    credential.status = "configured"
    db.commit()
    db.refresh(credential)
    return credential


@app.get("/api/v1/shops/{shop_id}/credentials/ozon", response_model=OzonCredentialStatus)
def get_ozon_credential_status(shop_id: int, db: Session = Depends(get_db)) -> ApiCredential:
    credential = db.scalar(select(ApiCredential).where(ApiCredential.shop_id == shop_id, ApiCredential.provider == "ozon"))
    if credential is None:
        raise HTTPException(status_code=404, detail="Ozon credential is not configured")
    return credential


@app.post("/api/v1/shops/{shop_id}/sync/products", response_model=SyncRunRead)
def run_product_sync(shop_id: int, payload: ProductSyncRequest, db: Session = Depends(get_db)):
    return sync_products(db, shop_id, limit=payload.limit, last_id=payload.last_id)


@app.post("/api/v1/shops/{shop_id}/sync/fbs-postings", response_model=SyncRunRead)
def run_fbs_posting_sync(shop_id: int, payload: FbsPostingSyncRequest, db: Session = Depends(get_db)):
    return sync_fbs_postings(db, shop_id, since=payload.since, to=payload.to, limit=payload.limit, offset=payload.offset, status=payload.status)


@app.post("/api/v1/shops/{shop_id}/sync/fbs-product-images", response_model=SyncRunRead)
def run_fbs_product_image_sync(shop_id: int, db: Session = Depends(get_db)):
    return sync_fbs_product_images(db, shop_id)


@app.get("/api/v1/shops/{shop_id}/sync-runs", response_model=list[SyncRunRead])
def list_sync_runs(shop_id: int, db: Session = Depends(get_db)) -> list[SyncRun]:
    return list(db.scalars(select(SyncRun).where(SyncRun.shop_id == shop_id).order_by(SyncRun.id.desc()).limit(100)))


@app.post(
    "/api/v1/shops/{shop_id}/auto-sync",
    response_model=list[AutoSyncDecisionRead],
    status_code=status.HTTP_202_ACCEPTED,
)
def auto_sync_shop_view(
    shop_id: int,
    payload: AutoSyncRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> list[dict[str, str | None]]:
    try:
        decisions = request_auto_sync(db, shop_id, payload.view)
    except AutoSyncShopNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    for decision in decisions:
        if decision["status"] == "started" and decision["lease_owner"]:
            background_tasks.add_task(run_auto_sync_resource, shop_id, decision["resource"], decision["lease_owner"])
    return decisions


@app.get("/api/v1/shops/{shop_id}/products", response_model=list[ProductRead])
def list_products(shop_id: int, db: Session = Depends(get_db)) -> list[ProductRecord]:
    return list(db.scalars(select(ProductRecord).where(ProductRecord.shop_id == shop_id).order_by(ProductRecord.updated_at.desc()).limit(500)))


@app.get("/api/v1/shops/{shop_id}/fbs-postings", response_model=list[FbsPostingRead])
def list_fbs_postings(shop_id: int, status_filter: str | None = None, db: Session = Depends(get_db)) -> list[FbsPostingRecord]:
    statement = select(FbsPostingRecord).where(FbsPostingRecord.shop_id == shop_id)
    if status_filter:
        statement = statement.where(FbsPostingRecord.normalized_status == status_filter)
    return list(db.scalars(statement.order_by(FbsPostingRecord.pack_by.asc().nulls_last(), FbsPostingRecord.id.desc()).limit(500)))


@app.get("/api/v1/shops/{shop_id}/fbs-postings/{posting_id}", response_model=FbsPostingDetailRead)
def get_fbs_posting(shop_id: int, posting_id: int, db: Session = Depends(get_db)) -> FbsPostingRecord:
    posting = db.scalar(select(FbsPostingRecord).where(FbsPostingRecord.id == posting_id, FbsPostingRecord.shop_id == shop_id))
    if posting is None:
        raise HTTPException(status_code=404, detail="FBS order not found")
    return posting


@app.get("/api/v1/shops/{shop_id}/listing-drafts", response_model=list[ListingDraftRead])
def list_listing_drafts(shop_id: int, db: Session = Depends(get_db)) -> list[ListingDraftRecord]:
    return list(db.scalars(select(ListingDraftRecord).where(ListingDraftRecord.shop_id == shop_id).order_by(ListingDraftRecord.id.desc()).limit(500)))


@app.get("/api/v1/shops/{shop_id}/listing-templates")
def list_listing_templates(shop_id: int, db: Session = Depends(get_db)) -> list[dict]:
    return [apply_listing_template(template) for template in db.scalars(
        select(ListingTemplateRecord).where(ListingTemplateRecord.shop_id == shop_id).order_by(ListingTemplateRecord.name)
    )]


def _normalize_listing_attributes(db: Session, shop_id: int, category_id: str, type_id: str, attributes) -> list[dict]:
    templates = {row.attribute_id: row for row in db.scalars(select(OzonGlobalAttributeCacheRecord).where(
        OzonGlobalAttributeCacheRecord.category_id == str(category_id),
        OzonGlobalAttributeCacheRecord.type_id == str(type_id),
    ))}
    normalized: list[dict] = []
    for attribute in attributes:
        template = templates.get(str(attribute.attribute_id))
        if template is None:
            raise HTTPException(status_code=422, detail=f"属性 {attribute.attribute_id} 不属于当前店铺所选类目")
        value_id, value_text = attribute.value_id, attribute.value_text
        if template.dictionary_id and (value_id or value_text):
            try:
                value_id, value_text = normalize_dictionary_attribute_value(
                    db, shop_id=shop_id, category_id=str(category_id), type_id=str(type_id),
                    attribute=template, value_id=value_id, value_text=value_text,
                )
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        normalized.append({
            "attribute_id": str(attribute.attribute_id), "name": template.name,
            "value_id": value_id, "value_text": value_text,
        })
    return normalized


@app.post("/api/v1/shops/{shop_id}/listing-templates", status_code=status.HTTP_201_CREATED)
def save_listing_template(shop_id: int, payload: ListingTemplateCreate, db: Session = Depends(get_db)) -> dict:
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")
    if db.scalar(select(OzonGlobalCategoryCacheRecord.id).where(
        OzonGlobalCategoryCacheRecord.category_id == payload.category_id,
        OzonGlobalCategoryCacheRecord.type_id == payload.type_id,
    )) is None:
        raise HTTPException(status_code=422, detail="模板必须绑定当前店铺已缓存的 Ozon 类目")
    if db.scalar(select(ListingTemplateRecord.id).where(
        ListingTemplateRecord.shop_id == shop_id,
        ListingTemplateRecord.name == payload.name.strip(),
    )) is not None:
        raise HTTPException(status_code=409, detail="已存在同名模板，请换一个名称")
    attributes = _normalize_listing_attributes(db, shop_id, payload.category_id, payload.type_id, payload.attributes)
    return apply_listing_template(create_listing_template(
        db, shop_id, payload.name, payload.category_id, payload.type_id, attributes,
        description=payload.description,
    ))


@app.post("/api/v1/shops/{shop_id}/listing-drafts", response_model=ListingDraftRead, status_code=status.HTTP_201_CREATED)
def create_listing_draft(shop_id: int, payload: ListingDraftCreate, db: Session = Depends(get_db)) -> ListingDraftRecord:
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")
    # Promote any legacy shop-scoped metadata before validating against the
    # single global category/attribute source.
    promote_legacy_listing_caches(db, category_id=payload.category_id, type_id=payload.type_id)
    if payload.category_id and payload.type_id and db.scalar(select(OzonGlobalCategoryCacheRecord.id).where(OzonGlobalCategoryCacheRecord.category_id == payload.category_id, OzonGlobalCategoryCacheRecord.type_id == payload.type_id)) is None:
        raise HTTPException(status_code=422, detail="所选 Ozon 类目不存在，请重新选择")
    draft = ListingDraftRecord(shop_id=shop_id, offer_id=normalize_offer_id(payload.offer_id), title=payload.title, description=payload.description, category_id=payload.category_id, type_id=payload.type_id, primary_image_url=payload.primary_image_url, video_url=payload.video_url, images_json=json.dumps(payload.images, ensure_ascii=False) if payload.images else None, watermark_config_json=json.dumps(payload.watermark_config, ensure_ascii=False) if payload.watermark_config else None, learning_attribute_ids_json=json.dumps(payload.learn_attribute_ids, ensure_ascii=False), source_product_id=payload.source_product_id)
    attribute_records = []
    normalized_attributes = _normalize_listing_attributes(db, shop_id, payload.category_id, payload.type_id, payload.attributes) if payload.category_id and payload.type_id else []
    for attribute in normalized_attributes:
        attribute_records.append(ListingAttributeValueRecord(**attribute))
    draft.attribute_values.extend(attribute_records)
    try:
        normalized_skus = normalize_offer_ids([variant.seller_sku for variant in payload.variants])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    for variant, normalized_sku in zip(payload.variants, normalized_skus):
        values = variant.model_dump(exclude={"image_urls"})
        values["seller_sku"] = normalized_sku
        if variant.image_urls is not None:
            values["image_urls_json"] = json.dumps(variant.image_urls, ensure_ascii=False)
            values["image_url"] = variant.image_urls[0] if variant.image_urls else None
        draft.variants.append(ListingVariantRecord(**values))
    db.add(draft)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该店铺已存在相同 Offer ID 的上架草稿") from exc
    db.refresh(draft)
    return draft


@app.post("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}/validate", response_model=ListingValidationRead)
def validate_listing(shop_id: int, draft_id: int, db: Session = Depends(get_db)) -> dict:
    draft = db.scalar(select(ListingDraftRecord).where(ListingDraftRecord.id == draft_id, ListingDraftRecord.shop_id == shop_id))
    if draft is None:
        raise HTTPException(status_code=404, detail="上架草稿不存在")
    issues = validate_listing_draft(db, draft)
    return {"draft_id": draft.id, "status": draft.status, "issues": issues}

def _build_price_obj(variant) -> dict:
    """Build Ozon price object; omit old_price if not set."""
    price_val = str(variant.price_cny or variant.calculated_price_cny or "0")
    price_obj = {
        "price": price_val,
        "min_price": str(variant.min_price_cny or "0"),
        "vat": "0",
    }
    if variant.old_price_cny is not None:
        price_obj["old_price"] = str(variant.old_price_cny)
    return price_obj


def _publicize_listing_images(draft: ListingDraftRecord) -> tuple[list[str], dict[str, str]]:
    """Upload images and apply a configured PNG watermark once per settings hash."""
    import base64
    import io
    from pathlib import Path
    from urllib.parse import unquote, urlparse
    from PIL import Image
    from .oss_upload import get_bucket, upload_bytes

    images = json.loads(draft.images_json) if draft.images_json else []
    if not images and draft.primary_image_url:
        images = [draft.primary_image_url]
    is_local = lambda value: "127.0.0.1" in value.lower() or "localhost" in value.lower()
    watermark = json.loads(draft.watermark_config_json) if draft.watermark_config_json else None
    enabled = bool(watermark and watermark.get("enabled") and watermark.get("image_data_url"))
    config_hash = hashlib.sha256(json.dumps({k: watermark.get(k) for k in ("image_data_url", "position", "scale", "opacity")}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24] if enabled else ""
    applied = bool(enabled and watermark.get("applied_hash") == config_hash)
    if applied:
        return images, {}
    urls = list(images)
    for variant in draft.variants:
        if variant.image_url:
            urls.append(variant.image_url)
        urls.extend(variant.image_urls or [])
    for attribute in draft.attribute_values:
        if attribute.value_text and is_local(attribute.value_text):
            urls.extend(re.findall(r"https?://(?:127\.0\.0\.1|localhost)(?::\d+)?/[^\"'\s\\]+", attribute.value_text, flags=re.IGNORECASE))
    urls = list(dict.fromkeys(u for u in urls if u))
    if not urls or (not enabled and not any(is_local(u) for u in urls)):
        return images, {}

    frontend_dir = (Path(__file__).resolve().parents[2] / "frontend").resolve()
    roots = {"/translated/": (frontend_dir / "translated").resolve(), "/generated/": (frontend_dir / "generated").resolve()}
    def read_bytes(url: str) -> bytes:
        if not is_local(url):
            response = httpx.get(url, timeout=25.0, follow_redirects=True)
            response.raise_for_status()
            return response.content
        path = unquote(urlparse(url).path)
        marker = next((m for m in roots if m in path), None)
        if not marker:
            raise HTTPException(status_code=422, detail=f"不支持的本地图片地址：{url}")
        root = roots[marker]
        local_path = (root / path.split(marker, 1)[1]).resolve()
        try:
            local_path.relative_to(root)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"本地图片路径越界，已阻止提交：{url}")
        if not local_path.is_file():
            raise HTTPException(status_code=422, detail=f"本地图片不存在，已阻止提交：{url}")
        return local_path.read_bytes()

    mark = None
    if enabled and not applied:
        try:
            raw = str(watermark["image_data_url"]); encoded = raw.split(",", 1)[1] if "," in raw else raw
            mark = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGBA")
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"水印 PNG 无法读取：{exc}") from exc

    def apply_mark(source: bytes) -> bytes:
        base = Image.open(io.BytesIO(source)).convert("RGBA")
        layer = mark.copy()
        scale = max(0.05, min(float(watermark.get("scale", 1)), 2.0)); opacity = max(0.0, min(float(watermark.get("opacity", .65)), 1.0))
        target_w = max(1, int(base.width * .22 * scale)); target_h = max(1, int(layer.height * target_w / max(1, layer.width)))
        layer.thumbnail((target_w, target_h), Image.Resampling.LANCZOS)
        if opacity < 1: layer.putalpha(layer.getchannel("A").point(lambda p: int(p * opacity)))
        margin = max(8, int(min(base.size) * .025)); xmid = (base.width-layer.width)//2; ymid = (base.height-layer.height)//2
        pos = {"tl":(margin,margin),"tm":(xmid,margin),"tr":(base.width-layer.width-margin,margin),"ml":(margin,ymid),"mm":(xmid,ymid),"mr":(base.width-layer.width-margin,ymid),"bl":(margin,base.height-layer.height-margin),"bm":(xmid,base.height-layer.height-margin),"br":(base.width-layer.width-margin,base.height-layer.height-margin)}
        base.alpha_composite(layer, dest=pos.get(str(watermark.get("position", "br")), pos["br"]))
        out = io.BytesIO(); base.convert("RGB").save(out, format="JPEG", quality=94, optimize=True); return out.getvalue()

    bucket = get_bucket(); mappings: dict[str, str] = {}
    for url in urls:
        if not enabled and not is_local(url):
            continue
        payload = apply_mark(read_bytes(url)) if enabled and not applied else read_bytes(url)
        digest = hashlib.sha256(payload).hexdigest()[:24]
        suffix = ".jpg" if enabled else (Path(unquote(urlparse(url).path)).suffix.lower() if Path(unquote(urlparse(url).path)).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg")
        content_type = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(suffix, "image/jpeg")
        try:
            mappings[url] = upload_bytes(payload, f"ozon-erp/images/{time.strftime('%Y%m%d')}/{digest}{suffix}", content_type=content_type, verify=True, bucket=bucket)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"图片上传 OSS 失败，已阻止提交：{Path(unquote(urlparse(url).path)).name}（{exc}）") from exc

    images = [mappings.get(url, url) for url in images]; draft.images_json = json.dumps(images, ensure_ascii=False)
    if draft.primary_image_url: draft.primary_image_url = mappings.get(draft.primary_image_url, draft.primary_image_url)
    for variant in draft.variants:
        if variant.image_url: variant.image_url = mappings.get(variant.image_url, variant.image_url)
        if variant.image_urls is not None:
            variant.image_urls = [mappings.get(url, url) for url in variant.image_urls]
    for attribute in draft.attribute_values:
        if attribute.value_text:
            for old_url, new_url in mappings.items(): attribute.value_text = attribute.value_text.replace(old_url, new_url)
    if enabled and not applied:
        watermark["applied_hash"] = config_hash; draft.watermark_config_json = json.dumps(watermark, ensure_ascii=False)
    return images, mappings


@app.post("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}/submit")
def submit_listing_to_ozon(shop_id: int, draft_id: int, db: Session = Depends(get_db)) -> dict:
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient

    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.id == draft_id,
        ListingDraftRecord.shop_id == shop_id,
    ))
    if draft is None:
        raise HTTPException(status_code=404, detail="上架草稿不存在")

    duplicate_shops = conflicting_published_shops(db, draft)
    if duplicate_shops:
        labels = "、".join(f"{row['shop_name']}（{row['offer_id']}）" for row in duplicate_shops)
        raise HTTPException(
            status_code=409,
            detail=f"同一 1688 货源商品已在其他 Ozon 店铺发布：{labels}。为避免重复铺货，本次提交已阻止。",
        )

    issues = validate_listing_draft(db, draft)
    if issues:
        raise HTTPException(status_code=422, detail="; ".join(i["message"] for i in issues[:5]))

    # An import can update an existing Offer, but Ozon does not allow that
    # operation to move the card to another category/type.  The local draft may
    # have been changed after a prior successful import, so verify the actual
    # Ozon cards before creating another paid/async import task.
    client_id, api_key = _credentials(db, shop_id)
    existing_offer_ids = [normalize_offer_id(variant.seller_sku) for variant in draft.variants]
    try:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            listed = client.list_products(filter={"offer_id": existing_offer_ids}, limit=min(1000, max(1, len(existing_offer_ids))))
            existing_ids = [item.get("product_id") for item in listed.get("result", {}).get("items", []) if item.get("product_id")]
            existing_cards = client.get_product_info(product_ids=existing_ids).get("items", []) if existing_ids else []
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"提交前无法读取 Ozon 已有商品卡，已阻止提交：{exc}") from exc
    incompatible_cards = [card for card in existing_cards if (
        str(card.get("description_category_id") or "") != str(draft.category_id)
        or str(card.get("type_id") or "") != str(draft.type_id)
    )]
    if incompatible_cards:
        example = incompatible_cards[0]
        raise HTTPException(
            status_code=422,
            detail=("该 Offer 已在 Ozon 创建，不能通过重新导入变更类目。"
                    f"Ozon 当前为 category_id={example.get('description_category_id')} / type_id={example.get('type_id')}，"
                    f"草稿为 category_id={draft.category_id} / type_id={draft.type_id}。"
                    "请从 Ozon 现有商品卡恢复类目和属性，或使用新的 Offer ID 创建新卡。"),
        )

    # Once a card exists, route an attributes-only edit to Ozon's narrow
    # endpoint.  This avoids needless import tasks while preserving the same
    # Ozon Offer/product identity.  Any title, description, media, price,
    # dimensions, barcode, stock, category/type or SKU change stays on the
    # full import path below.
    prior_event = db.scalar(select(AuditEventRecord).where(
        AuditEventRecord.shop_id == shop_id,
        AuditEventRecord.entity_type == "listing_draft",
        AuditEventRecord.entity_id == str(draft.id),
        AuditEventRecord.action.in_(["listing_submitted", "listing_attributes_updated"]),
    ).order_by(AuditEventRecord.created_at.desc()))
    if existing_cards and prior_event:
        try:
            prior_details = json.loads(prior_event.details_json or "{}")
            prior_snapshot = prior_details.get("change_signature")
        except (TypeError, ValueError):
            prior_snapshot = None
        current_snapshot = _listing_change_signature(draft)
        if isinstance(prior_snapshot, dict):
            if _listing_change_hash(prior_snapshot) == _listing_change_hash(current_snapshot):
                return {
                    "ok": True, "submission_mode": "no_changes", "task_id": None,
                    "updated_offer_ids": existing_offer_ids,
                    "message": "没有检测到待提交的改动；未调用 Ozon，也未创建导入任务。",
                }
            if _listing_change_hash(_listing_non_attribute_signature(prior_snapshot)) == _listing_change_hash(_listing_non_attribute_signature(current_snapshot)):
                result = update_listing_attributes_on_ozon(shop_id, draft_id, db)
                result["auto_routed"] = True
                result["message"] = "系统识别为仅属性修改，已更新原 Ozon 商品属性，未创建导入任务。"
                return result

    images, oss_mappings = _publicize_listing_images(draft)

    attr_cache = {}
    if draft.category_id and draft.type_id:
        for row in db.scalars(select(OzonGlobalAttributeCacheRecord).where(
            OzonGlobalAttributeCacheRecord.category_id == draft.category_id,
            OzonGlobalAttributeCacheRecord.type_id == draft.type_id,
        )):
            attr_cache[row.name] = row

    # Build set of is_aspect attribute IDs to exclude from product-level attrs
    variant_attr_ids = set()
    for row in attr_cache.values():
        if row.is_aspect:
            variant_attr_ids.add(row.attribute_id)

    product_attrs = []
    for av in draft.attribute_values:
        if not av.value_text:
            continue
        # Skip variant-level (is_aspect) attributes - they go in item_attrs only
        if av.attribute_id in variant_attr_ids:
            continue
        attr_obj = {"complex_id": 0, "id": int(av.attribute_id) if av.attribute_id.isdigit() else 0}
        # Check if this is a collection (multi-value) attribute
        attr_cached = None
        for ac in attr_cache.values():
            if ac.attribute_id == av.attribute_id:
                attr_cached = ac
                break
        is_collection = attr_cached.is_collection if attr_cached else False
        # Pipe-separated values for collection attributes: "val1|val2"
        if is_collection and "|" in (av.value_text or ""):
            texts = av.value_text.split("|")
            raw_vids = str(av.value_id).split("|") if av.value_id else []
            vals = []
            for idx, txt in enumerate(texts):
                v = {"value": txt.strip()}
                if idx < len(raw_vids):
                    rv = raw_vids[idx].strip()
                    if rv and rv not in ("None", "none", "null", "0", ""):
                        try:
                            v["dictionary_value_id"] = int(rv)
                        except (ValueError, TypeError):
                            pass
                vals.append(v)
            attr_obj["values"] = vals
        else:
            val_obj = {"value": av.value_text}
            raw_vid = str(av.value_id).strip() if av.value_id is not None else ""
            if raw_vid and raw_vid not in ("None", "none", "null", "0", ""):
                try:
                    val_obj["dictionary_value_id"] = int(raw_vid)
                except (ValueError, TypeError):
                    pass
            attr_obj["values"] = [val_obj]
        product_attrs.append(attr_obj)

    items = []
    for variant in draft.variants:
        # Product attributes contain nested values lists.  A shallow list copy
        # lets a later SKU-specific edit mutate an earlier item's payload.
        item_attrs = copy.deepcopy(product_attrs)
        if variant.variant_values_json:
            try:
                vv = json.loads(variant.variant_values_json)
                # Extract packed value_ids (stored under __ids__ key)
                packed_ids = vv.pop("__ids__", {}) if isinstance(vv, dict) else {}
                for attr_name, attr_value in vv.items():
                    if not attr_value:
                        continue
                    cached = attr_cache.get(attr_name)
                    if not cached:
                        continue
                    va = {"complex_id": int(cached.complex_id) if cached.complex_id and cached.complex_id.isdigit() else 0, "id": int(cached.attribute_id)}
                    # Check if this is a multi-value (comma-separated) attribute
                    raw_ids = packed_ids.get(attr_name, [])
                    if isinstance(raw_ids, list) and len(raw_ids) > 1:
                        # Multi-value: split text and create multiple value objects
                        texts = str(attr_value).split(",") if "," in str(attr_value) else str(attr_value).split("|")
                        vals = []
                        for idx, txt in enumerate(texts):
                            v = {"value": txt.strip()}
                            if idx < len(raw_ids):
                                try:
                                    v["dictionary_value_id"] = int(raw_ids[idx])
                                except (ValueError, TypeError):
                                    pass
                            vals.append(v)
                        va["values"] = vals
                    elif isinstance(raw_ids, list) and len(raw_ids) == 1:
                        # Single value with known ID
                        val_obj = {"value": str(attr_value)}
                        try:
                            val_obj["dictionary_value_id"] = int(raw_ids[0])
                        except (ValueError, TypeError):
                            pass
                        va["values"] = [val_obj]
                    else:
                        # Only collection attributes may carry more than one
                        # value. A free-text variant label can naturally have
                        # commas (for example, "лопатка, 39 см") and must be
                        # submitted to Ozon as one value, not split apart.
                        raw_texts = (str(attr_value).split(",") if cached.is_collection else [str(attr_value)])
                        vals = []
                        for txt in raw_texts:
                            txt = txt.strip()
                            val_obj = {"value": txt}
                            if cached.dictionary_id:
                                dict_val = db.scalar(select(OzonGlobalDictValueRecord).where(
                                    OzonGlobalDictValueRecord.category_id == draft.category_id,
                                    OzonGlobalDictValueRecord.type_id == draft.type_id,
                                    OzonGlobalDictValueRecord.attribute_id == cached.attribute_id,
                                    OzonGlobalDictValueRecord.value == txt,
                                ))
                                if dict_val:
                                    try:
                                        val_obj["dictionary_value_id"] = int(dict_val.value_id)
                                    except (ValueError, TypeError):
                                        val_obj["dictionary_value_id"] = dict_val.value_id
                            vals.append(val_obj)
                        va["values"] = vals
                    item_attrs.append(va)
            except Exception:
                pass

        _price = str(variant.price_cny or variant.calculated_price_cny or "0")
        _old_price_raw = str(variant.old_price_cny).strip() if variant.old_price_cny else ""
        _old_price = _old_price_raw if _old_price_raw and _old_price_raw not in ("0", "0.0", "0.00", "None") else ""
        _min_price = str(variant.min_price_cny or "0")
        item = {
            "offer_id": normalize_offer_id(variant.seller_sku),
            "name": draft.title,
            "description_category_id": int(draft.category_id) if draft.category_id else 0,
            "type_id": int(draft.type_id) if draft.type_id else 0,
            "price": _price,
            "min_price": _min_price,
            "vat": "0",
            "weight": int(variant.weight_g or 0),
            "weight_unit": "g",
            "length": int(variant.length_mm or 0),
            "width": int(variant.width_mm or 0),
            "height": int(variant.height_mm or 0),
            "depth": int(variant.height_mm or 0),
            "images": build_variant_image_list(variant.image_url, images, variant_image_urls=variant.image_urls),
            "description": draft.description or "",
            "attributes": item_attrs,
        }
        if _old_price:
            item["old_price"] = _old_price
        if variant.barcode:
            item["barcode"] = variant.barcode
        items.append(item)

    payload_text = json.dumps(items, ensure_ascii=False).lower()
    if "127.0.0.1" in payload_text or "localhost" in payload_text:
        raise HTTPException(status_code=422, detail="提交数据仍包含本地图片地址，已阻止写入 Ozon")

    # Sync warehouses if none exist for this shop
    wh_rows = db.scalars(select(Warehouse).where(Warehouse.shop_id == shop_id)).all()
    if not wh_rows:
        try:
            with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
                wh_result = client.list_warehouses()
                for wh in wh_result.get("warehouses", []):
                    db_wh = Warehouse(
                        shop_id=shop_id,
                        name=wh.get("name", ""),
                        pickup_point=wh.get("address_info", {}).get("address", "") if wh.get("address_info") else "",
                    )
                    db_wh.warehouse_id = str(wh.get("warehouse_id", ""))
                    db.add(db_wh)
                db.commit()
                wh_rows = db.scalars(select(Warehouse).where(Warehouse.shop_id == shop_id)).all()
        except Exception:
            pass

    try:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            result = client.create_products(items=items)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ozon API error: {exc}")

    task_id = result.get("result", {}).get("task_id", "")
    if not task_id:
        raise HTTPException(status_code=502, detail="Ozon 未返回导入任务号，提交状态未写入 ERP")

    # Import is asynchronous. Barcode generation is best-effort here, but stock is
    # deliberately NOT written in this request. The persisted monitor waits until
    # every Offer ID exists and every SKU reaches Ozon's price_sent state.
    barcode_msg = ""
    import time as _time
    product_ids = []
    imported_items = []
    full_import_success = False

    # Retry import info polling (Ozon import is async, may take several seconds)
    for _attempt in range(4):
        _time.sleep(3)
        try:
            with OzonSellerClient(client_id=client_id, api_key=api_key) as _poll_client:
                import_info = _poll_client.get_import_info(task_id=str(task_id)) if task_id else {}
                imported_items = import_info.get("result", {}).get("items", [])
                accepted = [it for it in imported_items if it.get("product_id") and it.get("status") in ("imported", "skipped") and not any(
                    str(err.get("level") or "").strip().lower() not in {"warning", "warn", "info", "notice"}
                    for err in ((it.get("errors") or []) if isinstance(it.get("errors"), list) else [it.get("errors")])
                    if isinstance(err, dict)
                )]
                full_import_success = len(accepted) == len(items) and {str(it.get("offer_id")) for it in accepted} == {str(it["offer_id"]) for it in items}
                # Keep every successfully imported SKU even when another row
                # in the same task failed. Inventory monitoring is per Offer,
                # so a partial task must not discard usable product IDs.
                product_ids = [it.get("product_id") for it in accepted]
                if full_import_success:
                    break
        except Exception:
            pass

    try:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            accepted = [it for it in imported_items if it.get("product_id") and it.get("status") in ("imported", "skipped") and not any(
                str(err.get("level") or "").strip().lower() not in {"warning", "warn", "info", "notice"}
                for err in ((it.get("errors") or []) if isinstance(it.get("errors"), list) else [it.get("errors")])
                if isinstance(err, dict)
            )]
            full_import_success = len(accepted) == len(items) and {str(it.get("offer_id")) for it in accepted} == {str(it["offer_id"]) for it in items}
            product_ids = [it.get("product_id") for it in accepted]

            # Generate barcodes for imported products
            if product_ids:
                try:
                    bc_result = client.generate_barcodes(product_ids=product_ids)
                    barcode_msg = "barcodes generated"
                except Exception as bc_exc:
                    barcode_msg = f"barcode gen failed: {bc_exc}"

    except Exception as post_exc:
        pass  # Post-import steps failed - don't block the response

    draft.status = "submitted"
    draft.import_task_id = str(task_id) if task_id else None
    draft.stock_sync_status = "waiting_product"
    draft.stock_sync_message = "持续检查 Ozon SKU；全部进入 price_sent 后自动提交并回读库存"
    draft.stock_sync_attempts = 0
    from datetime import datetime as _dt, timedelta as _td
    draft.stock_sync_next_at = _dt.utcnow() + _td(seconds=15)
    # Store the first product_id from import results for later feedback sync
    draft.ozon_product_id = product_ids[0] if product_ids else None
    import_errors = []
    for item in imported_items:
        errors = item.get("errors") or []
        if isinstance(errors, dict):
            errors = [errors]
        for error in errors:
            if isinstance(error, dict):
                texts = error.get("texts", {}) if isinstance(error.get("texts"), dict) else {}
                import_errors.append({
                    "type": "ozon_error", "offer_id": item.get("offer_id", ""),
                    "code": error.get("code", ""), "field": error.get("field", ""), "level": error.get("level", ""),
                    "attribute_id": error.get("attribute_id"), "attribute_name": error.get("attribute_name", ""),
                    "description": error.get("message") or texts.get("message") or texts.get("description") or texts.get("short_description") or error.get("code", "Ozon 导入失败"),
                })
            else:
                import_errors.append({"type": "ozon_error", "offer_id": item.get("offer_id", ""), "description": str(error)})
    import_errors = _deduplicate_ozon_issues(import_errors)
    draft.ozon_issues_json = json.dumps(import_errors, ensure_ascii=False) if import_errors else None
    # Ozon puts advisory corrections in the same errors array as blocking
    # failures. Keep warnings visible, but do not stop stock polling when all
    # submitted SKUs were imported successfully.
    blocking_import_errors = [
        issue for issue in import_errors
        if str(issue.get("level") or "").strip().lower() not in {"warning", "warn", "info", "notice"}
    ]
    if blocking_import_errors and not product_ids:
        draft.stock_sync_status = "import_failed"
        draft.stock_sync_message = f"Ozon 导入失败：{blocking_import_errors[0]['description']}"
        draft.stock_sync_next_at = None
    elif blocking_import_errors and product_ids:
        draft.stock_sync_status = "partial"
        draft.stock_sync_message = f"Ozon 已生成 {len(product_ids)}/{len(items)} 个 SKU；失败项保留回执，成功项继续轮询库存"
        draft.stock_sync_next_at = _dt.utcnow() + _td(seconds=60)
    elif import_errors:
        draft.stock_sync_status = "waiting_product"
        draft.stock_sync_message = "Ozon 已导入并返回提示，继续轮询 price_sent 与仓库库存"
        draft.stock_sync_next_at = _dt.utcnow() + _td(seconds=60)
    pipeline = None
    if draft.source_product_id:
        pipeline = db.scalar(select(PipelineProductRecord).where(
            PipelineProductRecord.shop_id == shop_id,
            PipelineProductRecord.source_product_id == draft.source_product_id,
        ))
        if pipeline is None:
            pipeline = PipelineProductRecord(shop_id=shop_id, source_product_id=draft.source_product_id)
            db.add(pipeline)
        pipeline.matched_category_id = draft.category_id
        pipeline.matched_type_id = draft.type_id
        pipeline.listing_draft_id = draft.id
        pipeline.task_id = str(task_id) if task_id else None
        pipeline.publish_status = "imported" if product_ids else "submitted"
        pipeline.pipeline_stage = "published" if product_ids else "submitted"
    db.add(AuditEventRecord(
        shop_id=shop_id, actor_id="operator", action="listing_submitted",
        entity_type="listing_draft", entity_id=str(draft.id),
        details_json=json.dumps({
            "offer_id": draft.offer_id, "source_product_id": draft.source_product_id,
            "task_id": str(task_id), "items_submitted": len(items),
            "ozon_imported": bool(product_ids), "ozon_product_ids": product_ids,
            "submission_category_type": [
                {"offer_id": item["offer_id"], "description_category_id": item["description_category_id"], "type_id": item["type_id"]}
                for item in items
            ],
            "oss_replacements": oss_mappings, "ozon_errors": import_errors,
            "change_signature": _listing_change_signature(draft),
        }, ensure_ascii=False),
    ))
    db.commit()

    learned = {"category": 0, "attributes": 0}
    if product_ids and task_id:
        learned = finalize_successful_listing_memories(db, draft, task_id=str(task_id))

    msg_parts = [f"submitted {len(items)} variants, task_id: {task_id}"]
    if barcode_msg:
        msg_parts.append(barcode_msg)
    msg_parts.append("Ozon 返回导入问题，已显示在编辑器中" if import_errors else "stock monitor started")

    return {
        "ok": True,
        "task_id": task_id,
        "items_submitted": len(items),
        "learned": learned,
        "import_errors": import_errors,
        "message": " | ".join(msg_parts) if task_id else "done",
    }


@app.post("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}/attributes/update")
def update_listing_attributes_on_ozon(shop_id: int, draft_id: int, db: Session = Depends(get_db)) -> dict:
    """Update attributes on existing Ozon Offers without creating an import task."""
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonRateLimitError, OzonSellerClient

    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.id == draft_id,
        ListingDraftRecord.shop_id == shop_id,
    ))
    if draft is None:
        raise HTTPException(status_code=404, detail="上架草稿不存在")
    if not draft.variants:
        raise HTTPException(status_code=422, detail="草稿没有可更新属性的 SKU")

    attr_cache = {}
    if draft.category_id and draft.type_id:
        for row in db.scalars(select(OzonGlobalAttributeCacheRecord).where(
            OzonGlobalAttributeCacheRecord.category_id == draft.category_id,
            OzonGlobalAttributeCacheRecord.type_id == draft.type_id,
        )):
            attr_cache[row.name] = row
    variant_attr_ids = {row.attribute_id for row in attr_cache.values() if row.is_aspect}

    base_attributes: list[dict] = []
    for value in draft.attribute_values:
        if not value.value_text or value.attribute_id in variant_attr_ids:
            continue
        try:
            attribute_id = int(value.attribute_id)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"属性 {value.name} 的 ID 无效，未向 Ozon 提交")
        cached = next((row for row in attr_cache.values() if row.attribute_id == value.attribute_id), None)
        texts = str(value.value_text).split("|") if cached and cached.is_collection else [str(value.value_text)]
        ids = str(value.value_id or "").split("|")
        values = []
        for index, text_value in enumerate(texts):
            item_value = {"value": text_value.strip()}
            raw_id = ids[index].strip() if index < len(ids) else ""
            if raw_id and raw_id.lower() not in {"none", "null", "0"}:
                try:
                    item_value["dictionary_value_id"] = int(raw_id)
                except ValueError:
                    raise HTTPException(status_code=422, detail=f"属性 {value.name} 的菜单值无效，请从下拉菜单重新选择")
            values.append(item_value)
        base_attributes.append({"complex_id": 0, "id": attribute_id, "values": values})

    update_items: list[dict] = []
    for variant in draft.variants:
        attributes = copy.deepcopy(base_attributes)
        if variant.variant_values_json:
            try:
                source_values = json.loads(variant.variant_values_json)
            except (TypeError, ValueError, json.JSONDecodeError) as exc:
                raise HTTPException(status_code=422, detail=f"SKU {variant.seller_sku} 的属性数据格式错误，未向 Ozon 提交") from exc
            identifiers = source_values.pop("__ids__", {}) if isinstance(source_values, dict) else {}
            for name, raw_value in source_values.items():
                cached = attr_cache.get(name)
                if not cached or not raw_value:
                    continue
                raw_ids = identifiers.get(name, []) if isinstance(identifiers, dict) else []
                raw_ids = raw_ids if isinstance(raw_ids, list) else [raw_ids]
                values = []
                # Only collection/dictionary attributes may contain multiple
                # values.  A single-value aspect such as Ozon's color name
                # can legitimately contain punctuation (for example a comma
                # before the size) and must remain one value.
                if cached.is_collection:
                    text_values = str(raw_value).replace("|", ",").split(",")
                else:
                    text_values = [str(raw_value)]
                for index, text_value in enumerate(text_values):
                    entry = {"value": text_value.strip()}
                    if index < len(raw_ids) and str(raw_ids[index]).strip():
                        try:
                            entry["dictionary_value_id"] = int(raw_ids[index])
                        except (TypeError, ValueError):
                            raise HTTPException(status_code=422, detail=f"SKU {variant.seller_sku} 的属性 {name} 未选择有效菜单值")
                    values.append(entry)
                attributes.append({
                    "complex_id": int(cached.complex_id) if str(cached.complex_id or "").isdigit() else 0,
                    "id": int(cached.attribute_id),
                    "values": values,
                })
        if not attributes:
            raise HTTPException(status_code=422, detail="没有可更新的产品属性；价格、尺重和图片需使用完整提交")
        update_items.append({"offer_id": normalize_offer_id(variant.seller_sku), "attributes": attributes})

    client_id, api_key = _credentials(db, shop_id)
    offer_ids = [item["offer_id"] for item in update_items]
    try:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            listed = client.list_products(filter={"offer_id": offer_ids}, limit=len(offer_ids))
            existing = {str(item.get("offer_id")) for item in listed.get("result", {}).get("items", [])}
            missing = [offer_id for offer_id in offer_ids if offer_id not in existing]
            if missing:
                raise HTTPException(status_code=409, detail=f"以下 Offer 尚未存在于 Ozon，不能只更新属性：{', '.join(missing)}。请使用完整提交。")
            result = client.update_product_attributes(items=update_items)
    except HTTPException:
        raise
    except OzonRateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ozon 属性更新失败：{exc}") from exc

    db.add(AuditEventRecord(
        shop_id=shop_id, actor_id="operator", action="listing_attributes_updated",
        entity_type="listing_draft", entity_id=str(draft.id),
        details_json=json.dumps({
            "submission_mode": "attributes_update", "offer_ids": offer_ids,
            "attribute_ids": [[attribute["id"] for attribute in item["attributes"]] for item in update_items],
            "import_task_id": None, "response": result,
            "change_signature": _listing_change_signature(draft),
        }, ensure_ascii=False),
    ))
    db.commit()
    return {
        "ok": True, "submission_mode": "attributes_update", "updated_offer_ids": offer_ids,
        "task_id": None,
        "message": f"已更新原 Ozon 商品的 {len(update_items)} 个 Offer 属性，未创建导入任务。",
    }


class ImageTranslateRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=20)
    source_lang: str = Field(default="CHS")
    target_lang: str = Field(default="RUS")


@app.post("/api/v1/image/translate")
def translate_images(payload: ImageTranslateRequest) -> dict:
    """Translate selected images through Xiangji's Alibaba image engine.

    Xiangji's public URL API only defines GetImageTranslate for one image per
    request.  The editor can still submit several selections; process them in
    order so one rejected source image does not discard successful results.
    """
    import os
    from urllib.parse import urlparse

    user_key = os.environ.get("XIANGJI_PRIVATE_KEY", "")
    img_trans_key = os.environ.get("XIANGJI_IMG_TRANS_KEY", "")
    if not user_key or not img_trans_key:
        raise HTTPException(status_code=500, detail="象寄 API 密钥未配置")

    results: list[dict] = []
    raw_results: list[dict] = []

    for index, image_url in enumerate(payload.urls):
        parsed = urlparse(image_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            results.append({
                "index": index, "source_url": image_url, "translated_url": None,
                "error": "图片地址必须是可公开访问的 HTTP(S) URL", "request_id": None,
            })
            continue

        commit_time = str(int(time.time()))
        sign_str = f"{commit_time}_{user_key}_{img_trans_key}"
        params = {
            "Action": "GetImageTranslate",
            "SourceLanguage": payload.source_lang,
            "TargetLanguage": payload.target_lang,
            # httpx encodes this query value exactly once, as Xiangji requires.
            "Url": image_url,
            "ImgTransKey": img_trans_key,
            "CommitTime": commit_time,
            "Sign": hashlib.md5(sign_str.encode()).hexdigest().lower(),
            "NeedWatermark": "0",
            "Qos": "BestQuality",
        }
        try:
            response = httpx.post(
                "https://api.tosoiot.com/", params=params, timeout=120.0,
            )
            response.raise_for_status()
            result = response.json()
            if not isinstance(result, dict):
                raise ValueError("象寄返回不是 JSON 对象")
        except Exception as exc:
            results.append({
                "index": index, "source_url": image_url, "translated_url": None,
                "error": f"象寄请求失败: {exc}", "request_id": None,
            })
            continue

        raw_results.append(result)
        request_id = result.get("RequestId") or result.get("requestId")
        data_field = result.get("Data") or result.get("data") or {}
        translated_url = data_field.get("SslUrl") or data_field.get("Url") if isinstance(data_field, dict) else None
        if result.get("Code") in (200, 0, "200", "0") and translated_url:
            results.append({
                "index": index, "source_url": image_url, "translated_url": translated_url,
                "error": None, "request_id": request_id,
            })
        else:
            message = result.get("Message") or "象寄未返回翻译图片"
            code = result.get("Code")
            results.append({
                "index": index, "source_url": image_url, "translated_url": None,
                "error": f"象寄错误 {code}: {message}", "request_id": request_id,
            })

    translated = [item["translated_url"] for item in results if item["translated_url"]]
    return {"ok": bool(translated), "results": results, "translated": translated, "raw": raw_results}


@app.post("/api/v1/image/translate-tencent")
def translate_images_tencent(payload: ImageTranslateRequest) -> dict:
    """Translate images via Tencent Cloud ImageTranslateLLM API.
    Downloads images, sends as Base64. Returns saved image URLs.
    Rate limit: 1 req/sec, so we add a delay between calls.
    """
    import os
    import base64
    import time as _time
    secret_id = os.environ.get("TENCENT_SECRET_ID", "")
    secret_key = os.environ.get("TENCENT_SECRET_KEY", "")
    if not secret_id or not secret_key:
        raise HTTPException(status_code=500, detail="腾讯云密钥未配置")

    try:
        from tencentcloud.common import credential as tc_cred
        from tencentcloud.tmt.v20180321 import tmt_client, models as tmt_models
    except ImportError:
        raise HTTPException(status_code=500, detail="tencentcloud-sdk-python-tmt 未安装")

    cred = tc_cred.Credential(secret_id, secret_key)
    client = tmt_client.TmtClient(cred, "ap-beijing")

    # Tencent accepts only JPG/JPEG/PNG input and the Base64 value must be
    # below 9 MB. Keep a result for every input index so a partial batch can
    # never replace the wrong image in the editor.
    allowed_types = {"image/jpeg", "image/jpg", "image/png"}
    max_base64_bytes = 9 * 1024 * 1024
    results = []

    for i, img_url in enumerate(payload.urls):
        if i > 0:
            _time.sleep(1.1)
        item = {"index": i, "source_url": img_url, "translated_url": None, "error": None, "request_id": None}
        try:
            # Download image and convert to Base64
            dl_resp = httpx.get(img_url, timeout=30.0, follow_redirects=True)
            if dl_resp.status_code != 200:
                item["error"] = f"下载失败（HTTP {dl_resp.status_code}）"
                results.append(item)
                continue
            content_type = dl_resp.headers.get("content-type", "").split(";", 1)[0].lower()
            if content_type not in allowed_types:
                item["error"] = f"图片格式不支持（{content_type or '未提供 Content-Type'}；仅支持 JPG/JPEG/PNG）"
                results.append(item)
                continue
            img_b64 = base64.b64encode(dl_resp.content).decode("utf-8")
            if len(img_b64.encode("ascii")) > max_base64_bytes:
                item["error"] = "图片 Base64 编码超过腾讯云 9MB 限制"
                results.append(item)
                continue

            req = tmt_models.ImageTranslateLLMRequest()
            req.Data = img_b64
            req.Target = payload.target_lang.lower()
            req.Mode = 1  # lite version

            resp = client.ImageTranslateLLM(req)

            if resp.Data:
                out_bytes = base64.b64decode(resp.Data)
                filename = f"trans_{int(_time.time()*1000)}_{i}.jpg"
                save_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "frontend", "translated")
                save_dir = os.path.abspath(save_dir)
                os.makedirs(save_dir, exist_ok=True)
                filepath = os.path.join(save_dir, filename)
                with open(filepath, "wb") as f:
                    f.write(out_bytes)
                item["translated_url"] = f"http://127.0.0.1:5500/translated/{filename}"
                item["request_id"] = getattr(resp, "RequestId", None)
            else:
                item["error"] = "腾讯云返回了空图片数据"
        except Exception as exc:
            item["error"] = str(exc) or type(exc).__name__
            item["error_code"] = getattr(exc, "get_code", lambda: None)()
            item["request_id"] = getattr(exc, "get_request_id", lambda: None)()
        results.append(item)

    # Save translations to cache directly (do not rely on frontend POST)
    translated_results = [item for item in results if item["translated_url"]]
    if translated_results:
        try:
            cache = _load_translation_cache()
            for item in translated_results:
                cache[item["source_url"]] = item["translated_url"]
            _save_translation_cache(cache)
        except Exception:
            pass

    return {
        "ok": bool(translated_results),
        "results": results,
        "translated": [item["translated_url"] for item in translated_results],
        "errors": [item for item in results if item["error"]],
        "count": len(translated_results),
    }





# ── Image translation cache (persists original→translated URL mapping) ──
_TRANSLATION_CACHE_FILE = os.path.join(os.path.dirname(__file__), "translation_cache.json")


def _load_translation_cache() -> dict:
    if os.path.exists(_TRANSLATION_CACHE_FILE):
        try:
            with open(_TRANSLATION_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_translation_cache(cache: dict) -> None:
    try:
        with open(_TRANSLATION_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


@app.get("/api/v1/image/translation-cache")
def get_translation_cache() -> dict:
    """Return all cached original→translated image URL mappings."""
    return {"cache": _load_translation_cache()}


@app.post("/api/v1/image/translation-cache")
def add_translation_cache(payload: dict) -> dict:
    """Add entries to the translation cache. Body: {"mappings": {"orig_url": "translated_url"}}"""
    mappings = payload.get("mappings", {})
    if not mappings:
        raise HTTPException(status_code=422, detail="mappings is required")
    cache = _load_translation_cache()
    for k, v in mappings.items():
        if k and v:
            cache[k] = v
    _save_translation_cache(cache)
    return {"ok": True, "count": len(cache)}


# Apply translation cache to source product images
@app.get("/api/v1/image/translation-cache/apply")
def apply_translation_cache(urls: str = Query(default="")) -> dict:
    """Given comma-separated URLs, return translated URLs where cached."""
    cache = _load_translation_cache()
    url_list = [u.strip() for u in urls.split(",") if u.strip()]
    result = {}
    for u in url_list:
        if u in cache:
            result[u] = cache[u]
    return {"translations": result}
@app.post("/api/v1/shops/{shop_id}/metadata/categories")
def sync_categories(shop_id: int, db: Session = Depends(get_db)) -> dict[str, int]:
    run = sync_category_cache(db, shop_id)
    if run.status != "succeeded":
        raise HTTPException(status_code=502, detail=run.error_summary or "Ozon 类目同步失败")
    return {"records": run.records_changed}


# ── Collection box (unified source products + drafts view) ──

def _collection_review_summary(db: Session, source_product_id: int, draft: ListingDraftRecord | None) -> dict:
    product = db.get(SourceProductRecord, source_product_id)
    raw = json.loads(product.raw_json or "{}") if product and product.raw_json else {}
    package = raw.get("packageInfo") or {}
    source_variants = list(db.scalars(select(SourceVariantRecord).where(
        SourceVariantRecord.source_product_id == source_product_id,
    )))
    media = list(db.scalars(select(SourceMediaRecord).where(
        SourceMediaRecord.source_product_id == source_product_id,
        SourceMediaRecord.media_type == "image",
    )))
    variants = list(draft.variants) if draft else []
    package_keys = ("weightG", "lengthMm", "widthMm", "heightMm")
    package_complete = all(package.get(key) not in (None, "", 0, "0") for key in package_keys)
    image_urls = [m.url for m in media if m.url]
    has_chinese_text = bool(re.search(r"[\\u4e00-\\u9fff]", (draft.description if draft else "") or ""))
    return {
        "package": package,
        "package_complete": package_complete,
        "variant_count": len(variants) or len(source_variants),
        "variants_with_package": sum(1 for v in variants if v.weight_g and v.length_mm and v.width_mm and v.height_mm),
        "source_variant_count": len(source_variants),
        "image_count": len(image_urls),
        "has_chinese_text": has_chinese_text,
        "draft_exists": bool(draft),
        "draft_id": draft.id if draft else None,
        "submitted": bool(draft and draft.status == "submitted"),
    }

@app.get("/api/v1/collection-box")
def list_collection_box(
    shop_id: int = Query(default=0, ge=0),
    source_shop: str = Query(default="", max_length=300),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
    paged: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> dict | list[dict]:
    """Return unified list of collected source products with their listing draft status."""
    conditions = [SourceProductShopRecord.is_deleted.is_(False)]
    if shop_id:
        conditions.append(SourceProductShopRecord.shop_id == shop_id)
    if source_shop.strip():
        conditions.append(SourceProductRecord.source_shop_name == source_shop.strip())
    joined = select(SourceProductShopRecord).join(
        SourceProductRecord, SourceProductRecord.id == SourceProductShopRecord.source_product_id
    ).where(*conditions)
    total = db.scalar(select(func.count(SourceProductShopRecord.id)).join(
        SourceProductRecord, SourceProductRecord.id == SourceProductShopRecord.source_product_id
    ).where(*conditions)) or 0
    source_shops = [value for value in db.scalars(select(SourceProductRecord.source_shop_name).join(
        SourceProductShopRecord, SourceProductShopRecord.source_product_id == SourceProductRecord.id
    ).where(
        SourceProductShopRecord.is_deleted.is_(False),
        SourceProductRecord.source_shop_name.is_not(None),
        SourceProductRecord.source_shop_name != "",
    ).distinct().order_by(SourceProductRecord.source_shop_name)).all() if value]
    link_query = joined.order_by(SourceProductShopRecord.id.desc())
    if paged:
        link_query = link_query.offset((page - 1) * page_size).limit(page_size)
    else:
        # Backward-compatible response for older clients. New collection-box
        # UI always requests paged=true and is no longer capped at 500 total.
        link_query = link_query.limit(500)
    source_links = list(db.scalars(link_query))
    source_products = {row.id: row for row in db.scalars(select(SourceProductRecord).where(
        SourceProductRecord.id.in_([link.source_product_id for link in source_links] or [-1])
    ))}
    media_by_product = {}
    if source_products:
        for media in db.scalars(select(SourceMediaRecord).where(SourceMediaRecord.source_product_id.in_(source_products.keys())).order_by(SourceMediaRecord.sort_order.asc())):
            if media.media_type == "video":
                media_by_product.setdefault(media.source_product_id, []).append(media.url)

    # Get all drafts indexed by source_product_id
    drafts_by_sp = {}
    drafts = list(db.scalars(select(ListingDraftRecord).order_by(ListingDraftRecord.id.desc())))
    for d in drafts:
        key = (d.source_product_id, d.shop_id)
        if d.source_product_id and key not in drafts_by_sp:
            drafts_by_sp[key] = d

    # Feedback is an append-only audit stream keyed by shop + KC/Offer ID.
    # Keep it independent from the current draft so recreating a draft does
    # not erase the Ozon responses already received for that KC.
    feedback_by_offer: dict[tuple[int, str], list[dict]] = {}
    feedback_events = db.scalars(select(AuditEventRecord).where(
        AuditEventRecord.action == "listing_feedback_synced",
        AuditEventRecord.shop_id.in_([link.shop_id for link in source_links] or [-1]),
    ).order_by(AuditEventRecord.created_at.desc())).all()
    for event in feedback_events:
        try:
            details = json.loads(event.details_json or "{}")
        except (TypeError, ValueError):
            continue
        offer_key = str(details.get("offer_id") or "").strip()
        if not offer_key:
            continue
        feedback_by_offer.setdefault((event.shop_id, offer_key), []).append({
            "id": event.id,
            "synced_at": event.created_at.isoformat() if event.created_at else "",
            "offer_id": offer_key,
            "draft_id": details.get("draft_id"),
            "ozon_product_id": details.get("ozon_product_id"),
            "overall_rating": details.get("overall_rating"),
            "moderation_status": details.get("moderation_status") or "",
            "validation_status": details.get("validation_status") or "",
            "issues": details.get("issues") or [],
            "groups": details.get("groups") or [],
        })

    # Get shop names
    shops = {s.id: s.name for s in db.scalars(select(Shop))}

    result = []
    for link in source_links:
        sp = source_products.get(link.source_product_id)
        if sp is None:
            continue
        row_shop_id = link.shop_id
        draft = drafts_by_sp.get((sp.id, row_shop_id))
        # Determine status
        if not draft:
            status = "未编辑"
        elif draft.moderation_status == "declined":
            status = "待修改"
        elif draft.status == "submitted":
            status = "已提交"
        elif draft.status in ("validation_failed", "ready_for_approval"):
            status = "待修改"
        else:
            status = "保存"

        result.append({
            "source_product_id": sp.id,
            "title": sp.title or "",
            "source_platform": sp.source_platform or "",
            "source_shop_name": sp.source_shop_name or "",
            "source_shop_key": sp.source_shop_key or "",
            "shop_id": row_shop_id,
            "shop_name": shops.get(row_shop_id, ""),
            "collected_at": sp.created_at.isoformat() if sp.created_at else "",
            "main_image_url": sp.main_image_url or "",
            "video_urls": media_by_product.get(sp.id, []),
            "draft_id": draft.id if draft else None,
            "draft_status": status,
            "offer_id": draft.offer_id if draft else "",
            "category_id": draft.category_id if draft else None,
            "quality_rating": draft.quality_rating if draft else None,
            "moderation_status": (draft.moderation_status if draft else None) or "",
            "ozon_issues": json.loads(draft.ozon_issues_json) if draft and draft.ozon_issues_json else [],
            "stock_sync_status": draft.stock_sync_status if draft else None,
            "stock_sync_message": draft.stock_sync_message if draft else None,
            "stock_sync_attempts": int(draft.stock_sync_attempts or 0) if draft else 0,
            "source_offer_id": sp.source_product_id,
            "source_duplicate_status": source_publication_status(
                db, sp.source_platform, sp.source_product_id,
                current_shop_id=row_shop_id,
            ),
            # Compact evidence for the collection-box fast review drawer. The
            # drawer must never invent a value; missing data stays explicit so
            # the operator can resolve only the exceptions.
            "review_summary": _collection_review_summary(db, sp.id, draft),
            "feedback_history": feedback_by_offer.get((row_shop_id, str(draft.offer_id if draft else "")), []),
            "feedback_count": len(feedback_by_offer.get((row_shop_id, str(draft.offer_id if draft else "")), [])),
        })
    if paged:
        return {
            "items": result,
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total + page_size - 1) // page_size),
            "source_shops": source_shops,
            "ozon_shops": [{"id": shop_key, "name": shop_name} for shop_key, shop_name in shops.items()],
        }
    return result

@app.delete("/api/v1/collection-box/{source_product_id}")
def remove_collection_box_item(source_product_id: int, db: Session = Depends(get_db)) -> dict:
    """Delete a source product from collection box across ALL shops."""
    product = db.scalar(select(SourceProductRecord).where(SourceProductRecord.id == source_product_id))
    if product is None:
        raise HTTPException(status_code=404, detail="采集商品不存在")
    drafts = db.scalars(select(ListingDraftRecord).where(ListingDraftRecord.source_product_id == source_product_id)).all()
    for draft in drafts:
        db.query(ListingAttributeValueRecord).where(ListingAttributeValueRecord.draft_id == draft.id).delete()
        db.query(ListingVariantRecord).where(ListingVariantRecord.draft_id == draft.id).delete()
        db.delete(draft)
    db.query(SourceProductShopRecord).where(
        SourceProductShopRecord.source_product_id == source_product_id,
    ).update({"is_deleted": True}, synchronize_session=False)
    db.commit()
    return {"ok": True, "removed_source_product_id": source_product_id, "removed_drafts": len(drafts)}




class CollectionBoxBatchRequest(BaseModel):
    items: list[dict]


@app.post("/api/v1/collection-box/refresh-selected")
def refresh_collection_box_selected(payload: CollectionBoxBatchRequest, db: Session = Depends(get_db)) -> dict:
    """Refresh Ozon feedback for selected source products across ALL shops."""
    refreshed = 0
    skipped = 0
    errors = []
    seen = []
    for item in payload.items or []:
        sp_id = item.get("source_product_id")
        if not sp_id or sp_id in seen:
            continue
        seen.append(sp_id)
        drafts = db.scalars(select(ListingDraftRecord).where(
            ListingDraftRecord.source_product_id == sp_id,
            ListingDraftRecord.offer_id.is_not(None),
            ListingDraftRecord.offer_id != "",
        )).all()
        if not drafts:
            skipped += 1
            continue
        for draft in drafts:
            try:
                sync_listing_feedback(shop_id=draft.shop_id, draft_id=draft.id, db=db)
                refreshed += 1
            except Exception as exc:
                errors.append({"source_product_id": sp_id, "draft_id": draft.id, "shop_id": draft.shop_id, "error": str(exc)})
    db.commit()
    return {"ok": True, "refreshed": refreshed, "skipped": skipped, "errors": errors}

@app.post("/api/v1/collection-box/delete-selected")
def delete_collection_box_selected(payload: CollectionBoxBatchRequest, db: Session = Depends(get_db)) -> dict:
    """Delete selected source products globally (all shops, all drafts)."""
    removed_products = 0
    removed_drafts = 0
    errors = []
    seen = []
    for item in payload.items or []:
        sp_id = item.get("source_product_id")
        if not sp_id or sp_id in seen:
            continue
        seen.append(sp_id)
        try:
            product = db.scalar(select(SourceProductRecord).where(SourceProductRecord.id == sp_id))
            if product is None:
                errors.append({"source_product_id": sp_id, "error": "采集商品不存在"})
                continue
            drafts = db.scalars(select(ListingDraftRecord).where(
                ListingDraftRecord.source_product_id == sp_id,
            )).all()
            for draft in drafts:
                db.query(ListingAttributeValueRecord).where(ListingAttributeValueRecord.draft_id == draft.id).delete()
                db.query(ListingVariantRecord).where(ListingVariantRecord.draft_id == draft.id).delete()
                db.delete(draft)
                removed_drafts += 1
            db.query(SourceProductShopRecord).where(
                SourceProductShopRecord.source_product_id == sp_id,
            ).update({"is_deleted": True}, synchronize_session=False)
            removed_products += 1
        except Exception as exc:
            errors.append({"source_product_id": sp_id, "error": str(exc)})
    db.commit()
    return {"ok": True, "removed_products": removed_products, "removed_drafts": removed_drafts, "errors": errors}

@app.get("/api/v1/shops/{shop_id}/import-info/{task_id}")
def check_import_info(shop_id: int, task_id: str, db: Session = Depends(get_db)) -> dict:
    """Check Ozon product import task status."""
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient
    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        result = client.get_import_info(task_id=task_id)
    return result


class OzonProductIdsRequest(BaseModel):
    product_ids: list[int] = Field(min_length=1, max_length=100)


class OzonProductArchiveRequest(OzonProductIdsRequest):
    confirm: bool = False
    reason: str = Field(min_length=1, max_length=500)


@app.post("/api/v1/shops/{shop_id}/ozon-products/archive")
def archive_ozon_products(
    shop_id: int,
    payload: OzonProductArchiveRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Archive explicit Ozon product IDs with confirmation and an audit record."""
    if not payload.confirm:
        raise HTTPException(status_code=422, detail="归档 Ozon 商品必须传 confirm=true")
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient
    product_ids = sorted(set(int(product_id) for product_id in payload.product_ids if int(product_id) > 0))
    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        result = client.archive_products(product_ids=product_ids)
    if result.get("result") is not True:
        raise HTTPException(status_code=502, detail="Ozon 未确认归档请求")
    db.add(AuditEventRecord(
        shop_id=shop_id, actor_id="operator_confirmed", action="ozon_products_archived",
        entity_type="ozon_product", entity_id=",".join(str(product_id) for product_id in product_ids),
        details_json=json.dumps({"reason": payload.reason, "product_ids": product_ids, "ozon_response": result}, ensure_ascii=False),
    ))
    db.commit()
    return {"ok": True, "product_ids": product_ids, "ozon_response": result}


@app.post("/api/v1/shops/{shop_id}/ozon-products/status")
def read_ozon_product_statuses(
    shop_id: int,
    payload: OzonProductIdsRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Read back exact Ozon product states after a write action.

    Reuses the explicit-ID request schema so callers cannot accidentally scan a
    whole shop while checking the outcome of a constrained operation. It
    deliberately has no confirmation field because it never writes to Ozon or
    local business state.
    """
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient

    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")
    product_ids = sorted(set(int(product_id) for product_id in payload.product_ids if int(product_id) > 0))
    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        result = client.get_product_info(product_ids=product_ids)
    items = result.get("items", []) or result.get("result", {}).get("items", [])
    return {
        "ok": True,
        "product_ids": product_ids,
        "items": items,
        "missing_product_ids": sorted(
            set(product_ids) - {int(item.get("id")) for item in items if item.get("id")}
        ),
    }




@app.get("/api/v1/shops/{shop_id}/ozon-products/search")
def search_ozon_products(shop_id: int, query: str = Query(default="", max_length=100), limit: int = Query(default=50, ge=1, le=200), db: Session = Depends(get_db)) -> list[dict]:
    """Search products on Ozon by offer_id. Lists all and filters locally (Ozon API filter has proto bug)."""
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient
    client_id, api_key = _credentials(db, shop_id)
    matches = []
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        last_id = ""
        while len(matches) < limit:
            result = client.list_products(limit=100, last_id=last_id)
            res = result.get("result", {})
            items = res.get("items", [])
            if not items:
                break
            for it in items:
                offer = it.get("offer_id", "")
                if not query or query.lower() in offer.lower():
                    matches.append({"product_id": it.get("product_id"), "offer_id": offer})
                    if len(matches) >= limit:
                        break
            last_id = res.get("last_id", "")
            if not last_id or len(items) < 100:
                break
    return matches
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient
    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        filt = {"offer_id": query} if query else {}
        result = client.list_products(limit=limit, filter=filt)
    items = result.get("result", {}).get("items", [])
    return [{"product_id": it.get("product_id"), "offer_id": it.get("offer_id", "")} for it in items]


@app.post("/api/v1/shops/{shop_id}/ozon-products/{product_id}/pull")
def pull_ozon_product_to_draft(
    shop_id: int,
    product_id: int,
    overwrite: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> dict:
    """Pull the complete Ozon model/card (all related variants) into one draft."""
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient

    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        # 1. Resolve the selected SKU's Ozon model, then find every seller SKU in that model.
        info_res = client.get_product_info(product_ids=[product_id])
        items = info_res.get("items", []) or info_res.get("result", {}).get("items", [])
        if not items:
            raise HTTPException(status_code=404, detail="Ozon 上未找到该商品")
        selected_info = items[0]
        model_id = (selected_info.get("model_info") or {}).get("model_id")
        card_infos = [selected_info]
        if model_id:
            all_product_ids: list[int] = []
            last_id = ""
            while True:
                page = client.list_products(limit=1000, last_id=last_id)
                page_result = page.get("result", {})
                page_items = page_result.get("items", [])
                all_product_ids.extend(int(row["product_id"]) for row in page_items if row.get("product_id"))
                last_id = page_result.get("last_id", "")
                if not last_id or len(page_items) < 1000:
                    break
            card_infos = []
            for offset in range(0, len(all_product_ids), 1000):
                batch = client.get_product_info(product_ids=all_product_ids[offset:offset + 1000])
                batch_items = batch.get("items", []) or batch.get("result", {}).get("items", [])
                card_infos.extend(
                    row for row in batch_items
                    if (row.get("model_info") or {}).get("model_id") == model_id
                )
            if not card_infos:
                card_infos = [selected_info]

        card_infos.sort(key=lambda row: str(row.get("offer_id", "")))
        card_product_ids = [int(row["id"]) for row in card_infos if row.get("id")]
        attr_res = client.get_product_attributes_v4(product_ids=card_product_ids)
        result_raw = attr_res.get("result", [])
        attrs_by_product = {int(row["id"]): row for row in result_raw if row.get("id")}

        # Ozon stores only child Offer IDs. Recover the ERP ParentSKU from their stable common prefix.
        child_offer_ids = [str(row.get("offer_id", "")) for row in card_infos if row.get("offer_id")]
        if len(child_offer_ids) > 1:
            import os
            common_offer_prefix = os.path.commonprefix(child_offer_ids)
            if common_offer_prefix.endswith(("-", "_", " ", ".")):
                offer_id = common_offer_prefix.rstrip("-_ .")
            else:
                split_at = max(common_offer_prefix.rfind(sep) for sep in ("-", "_", " ", "."))
                offer_id = common_offer_prefix[:split_at].rstrip("-_ .") if split_at > 0 else common_offer_prefix
            offer_id = offer_id or child_offer_ids[0]
        else:
            offer_id = child_offer_ids[0]

        pinfo = card_infos[0]
        pattr = attrs_by_product.get(int(pinfo.get("id", 0)), {})
        title = pinfo.get("name", "")
        description = pinfo.get("description", "")
        category_id = str(pinfo.get("description_category_id", "")) if pinfo.get("description_category_id") else None
        type_id = str(pinfo.get("type_id", "")) if pinfo.get("type_id") else None

        # Shared gallery uses the first item; each variant keeps its own Ozon primary/color image below.
        images = []
        for img in pinfo.get("images", []):
            url = img if isinstance(img, str) else img.get("file_name") or img.get("url", "")
            if url:
                images.append(url)

        # 2. Look up cached metadata: v4 values do not include attribute names/aspect flags.
        attr_name_map = {}
        aspect_attr_ids: set[str] = set()
        if category_id and type_id:
            cached_attrs = list(db.scalars(select(OzonGlobalAttributeCacheRecord).where(
                    OzonGlobalAttributeCacheRecord.category_id == category_id,
                OzonGlobalAttributeCacheRecord.type_id == type_id,
            )))
            for ca in cached_attrs:
                attr_name_map[str(ca.attribute_id)] = ca.name or ""
                if ca.is_aspect:
                    aspect_attr_ids.add(str(ca.attribute_id))

        # Also regard any value that differs between variants as a variant dimension.
        attr_signatures: dict[str, set[tuple[tuple[str, str], ...]]] = {}
        for product_attrs in attrs_by_product.values():
            for attr in product_attrs.get("attributes", []):
                aid = str(attr.get("id", ""))
                signature = tuple(sorted(
                    (str(v.get("dictionary_value_id") or ""), str(v.get("value") or ""))
                    for v in attr.get("values", [])
                ))
                attr_signatures.setdefault(aid, set()).add(signature)
        varying_attr_ids = {aid for aid, signatures in attr_signatures.items() if len(signatures) > 1}
        system_variant_exclusions = {
            aid for aid in varying_attr_ids
            if any(token in (attr_name_map.get(aid, "") or "").lower() for token in ("卖家代码", "артикул продавца", "offer id"))
        }
        variant_attr_ids = aspect_attr_ids | (varying_attr_ids - system_variant_exclusions)

        # 3. Existing drafts are never destructively refreshed without explicit confirmation.
        existing = db.scalar(select(ListingDraftRecord).where(
            ListingDraftRecord.shop_id == shop_id,
            ListingDraftRecord.offer_id == offer_id,
        ))
        if not existing and child_offer_ids:
            existing = db.scalar(
                select(ListingDraftRecord)
                .join(ListingVariantRecord, ListingVariantRecord.draft_id == ListingDraftRecord.id)
                .where(ListingDraftRecord.shop_id == shop_id, ListingVariantRecord.seller_sku.in_(child_offer_ids))
            )
        if existing and not overwrite:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "OZON_DRAFT_EXISTS",
                    "message": "该 Ozon 商品卡已存在草稿。重新拉取会用 Ozon 当前数据覆盖草稿属性和变体。",
                    "draft_id": existing.id,
                    "variant_count": len(card_infos),
                },
            )
        if existing:
            draft = existing
            # Preserve the ERP's established ParentSKU when refreshing an existing card.
            offer_id = draft.offer_id
            draft.title = title
            draft.description = description
            draft.category_id = category_id
            draft.type_id = type_id
            draft.primary_image_url = images[0] if images else None
            draft.images_json = json.dumps(images, ensure_ascii=False) if images else None
            draft.ozon_product_id = product_id
            draft.status = "draft"
            db.query(ListingAttributeValueRecord).where(ListingAttributeValueRecord.draft_id == draft.id).delete()
            db.query(ListingVariantRecord).where(ListingVariantRecord.draft_id == draft.id).delete()
        else:
            draft = ListingDraftRecord(
                shop_id=shop_id, offer_id=offer_id, title=title, description=description,
                category_id=category_id, type_id=type_id,
                primary_image_url=images[0] if images else None,
                images_json=json.dumps(images, ensure_ascii=False) if images else None,
                ozon_product_id=product_id, status="draft",
            )
            db.add(draft)
            db.flush()

        # 4. Store only card-level attributes. Variant/aspect values live on each SKU row.
        product_attrs = pattr.get("attributes", []) if pattr else []
        for attr in product_attrs:
            attr_id = str(attr.get("id", ""))
            if not attr_id or attr_id in variant_attr_ids:
                continue
            attr_name = attr_name_map.get(attr_id, attr.get("name", "") or f"attr_{attr_id}")
            values = attr.get("values", [])
            value_texts = [str(val.get("value")) for val in values if val.get("value")]
            value_ids = [
                str(val.get("dictionary_value_id")) for val in values
                if val.get("dictionary_value_id") and int(val.get("dictionary_value_id")) > 0
            ]
            if value_texts or value_ids:
                db.add(ListingAttributeValueRecord(
                    draft_id=draft.id,
                    attribute_id=attr_id,
                    name=attr_name,
                    value_text="|".join(value_texts) if value_texts else None,
                    value_id="|".join(value_ids) if value_ids else None,
                ))

        # 5. Rebuild every Ozon child SKU as one variant row.
        for item_info in card_infos:
            pid = int(item_info.get("id", 0))
            item_attrs = attrs_by_product.get(pid, {})
            variant_values: dict[str, str] = {}
            variant_value_ids: dict[str, list[str]] = {}
            for attr in item_attrs.get("attributes", []):
                aid = str(attr.get("id", ""))
                if aid not in variant_attr_ids:
                    continue
                attr_name = attr_name_map.get(aid, attr.get("name", "") or f"attr_{aid}")
                texts = [str(v.get("value", "")) for v in attr.get("values", []) if v.get("value")]
                ids = [str(v.get("dictionary_value_id")) for v in attr.get("values", []) if v.get("dictionary_value_id")]
                if texts:
                    variant_values[attr_name] = ", ".join(texts)
                if ids:
                    variant_value_ids[attr_name] = ids
            packed = dict(variant_values)
            if variant_value_ids:
                packed["__ids__"] = variant_value_ids

            item_images = item_attrs.get("images") or item_info.get("images") or []
            primary = item_attrs.get("primary_image") or item_info.get("primary_image") or item_attrs.get("color_image") or item_info.get("color_image")
            if isinstance(primary, list):
                primary = primary[0] if primary else None
            image_url = primary or (item_images[0] if item_images else None)
            barcodes = item_info.get("barcodes") or item_attrs.get("barcodes") or []
            stocks = (item_info.get("stocks") or {}).get("stocks", [])
            stock = sum(int(row.get("present") or 0) for row in stocks if row.get("source") == "fbs")

            db.add(ListingVariantRecord(
                draft_id=draft.id,
                seller_sku=str(item_info.get("offer_id", "")),
                weight_g=item_attrs.get("weight") or None,
                length_mm=item_attrs.get("depth") or None,
                width_mm=item_attrs.get("width") or None,
                height_mm=item_attrs.get("height") or None,
                price_cny=item_info.get("price") or None,
                old_price_cny=item_info.get("old_price") or None,
                min_price_cny=str(item_info.get("min_price")) if item_info.get("min_price") else None,
                barcode=str(barcodes[0]) if barcodes else None,
                stock=stock,
                image_url=image_url,
                variant_values_json=json.dumps(packed, ensure_ascii=False) if packed else None,
            ))

        db.commit()
        db.refresh(draft)

    return {
        "draft_id": draft.id,
        "offer_id": offer_id,
        "title": title,
        "product_id": product_id,
        "variant_count": len(card_infos),
        "message": f"已从 Ozon 拉取完整商品卡，共 {len(card_infos)} 个变体，保存到草稿 {draft.id}",
    }


@app.post("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}/stock-monitor")
def run_listing_stock_monitor_now(shop_id: int, draft_id: int, db: Session = Depends(get_db)) -> dict:
    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.id == draft_id,
        ListingDraftRecord.shop_id == shop_id,
    ))
    if draft is None:
        raise HTTPException(status_code=404, detail="上架草稿不存在")

    if not draft.variants:
        raise HTTPException(status_code=422, detail="草稿没有 SKU 变体")
    # A manual "check" must never turn into a second stock write for an
    # already confirmed listing. Ozon rate-limits repeated stock updates and
    # the prior behaviour could overwrite a completed state with a retry.
    if draft.stock_sync_status == "completed" and draft.stock_synced_at:
        return {
            "status": "completed",
            "confirmed": len(draft.variants),
            "message": draft.stock_sync_message or "Ozon 库存已确认",
            "stock_synced_at": draft.stock_synced_at,
        }
    return monitor_listing_stock(db, draft)


@app.post("/api/v1/shops/{shop_id}/inventory-reconciliation")
def reconcile_shop_inventory(
    shop_id: int,
    max_details: int = Query(default=500, ge=1, le=5000),
    db: Session = Depends(get_db),
) -> dict:
    """Read every Ozon product/FBS stock row, including products without drafts.

    The route is deliberately read-only toward Ozon. It is the prerequisite
    for a later, explicitly approved stock repair; calling it cannot invoke
    ``/v2/products/stocks`` or submit a listing.
    """
    try:
        result = audit_shop_fbs_inventory(db, shop_id, max_details=max_details)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    db.add(AuditEventRecord(
        shop_id=shop_id,
        actor_id="operator",
        action="ozon_fbs_inventory_reconciled",
        entity_type="shop",
        entity_id=str(shop_id),
        details_json=json.dumps(result["summary"], ensure_ascii=False),
    ))
    db.commit()
    return result


# ── OSS image upload (replace localhost URLs with public OSS URLs) ──

class OssUploadRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=50)


@app.post("/api/v1/image/upload-to-oss")
def upload_images_to_oss(payload: OssUploadRequest) -> dict:
    """Upload localhost image URLs to Aliyun OSS and return public URLs.

    For URLs that are already public (not localhost), they are returned as-is.
    For localhost URLs under /translated/ or /generated/, the local file is
    uploaded to OSS and the public URL is returned. Missing/invalid local
    files fail closed instead of silently returning a URL Ozon cannot read.
    """
    from .oss_upload import get_bucket, upload_bytes
    import hashlib as _hashlib
    from pathlib import Path
    from urllib.parse import unquote, urlparse

    bucket = None
    result = {}
    for url in payload.urls:
        if "127.0.0.1" not in url and "localhost" not in url:
            result[url] = url
            continue
        # Extract and constrain local file path from localhost URL.
        try:
            frontend_root = Path(__file__).resolve().parents[2] / "frontend"
            parsed_path = unquote(urlparse(url).path)
            roots = {"/translated/": (frontend_root / "translated").resolve(), "/generated/": (frontend_root / "generated").resolve()}
            marker = next((key for key in roots if key in parsed_path), None)
            if not marker:
                raise HTTPException(status_code=422, detail=f"不支持的本地图片路径：{url}")
            root = roots[marker]
            local_path = (root / parsed_path.split(marker, 1)[1]).resolve()
            try:
                local_path.relative_to(root)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=f"本地图片路径越界：{url}") from exc
            if not local_path.is_file():
                raise HTTPException(status_code=422, detail=f"本地图片不存在：{local_path.name}")
            img_bytes = local_path.read_bytes()
            # Generate OSS object key
            digest = _hashlib.sha256(img_bytes).hexdigest()[:24]
            date_str = time.strftime("%Y%m%d")
            suffix = local_path.suffix.lower() if local_path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg"
            content_type = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(suffix, "image/jpeg")
            object_key = f"ozon-erp/images/{date_str}/{digest}{suffix}"
            if bucket is None:
                bucket = get_bucket()
            oss_url = upload_bytes(img_bytes, object_key, content_type=content_type, verify=True, bucket=bucket)
            result[url] = oss_url
        except Exception as exc:
            if isinstance(exc, HTTPException):
                raise exc
            raise HTTPException(status_code=502, detail=f"OSS 图片上传失败：{url}（{exc}）") from exc

    uploaded_count = sum(1 for k, v in result.items() if k != v)
    return {"mappings": result, "uploaded": uploaded_count}


@app.get("/api/v1/shops/{shop_id}/metadata/categories")
def list_categories(
    shop_id: int,
    query: str | None = None,
    category_id: str | None = Query(default=None, max_length=32),
    type_id: str | None = Query(default=None, max_length=32),
    limit: int = Query(default=80, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[dict[str, str]]:
    statement = select(OzonGlobalCategoryCacheRecord).where(
        OzonGlobalCategoryCacheRecord.type_id != "",
    )
    # The editor also uses this established metadata endpoint to hydrate a
    # saved draft's category label.  An ID lookup avoids relying on the first
    # page of the global category cache, where the saved category may not be.
    if category_id:
        statement = statement.where(OzonGlobalCategoryCacheRecord.category_id == category_id)
    if type_id:
        statement = statement.where(OzonGlobalCategoryCacheRecord.type_id == type_id)
    if query:
        q = query[:100].strip()
        # Exact / starts-with matches rank higher than mid-string matches
        from sqlalchemy import case, func
        zh_exact = func.lower(OzonGlobalCategoryCacheRecord.title_zh) == q.lower()
        zh_start = func.lower(OzonGlobalCategoryCacheRecord.title_zh).like(q.lower() + "%")
        zh_contains = OzonGlobalCategoryCacheRecord.title_zh.like("%" + q + "%")
        ru_contains = OzonGlobalCategoryCacheRecord.title.like("%" + q + "%")
        statement = statement.where(or_(zh_contains, ru_contains))
        rank = case(
            (zh_exact, 0),
            (zh_start, 1),
            (zh_contains, 2),
            else_=3,
        )
        statement = statement.order_by(rank, OzonGlobalCategoryCacheRecord.title_zh)
    else:
        statement = statement.order_by(OzonGlobalCategoryCacheRecord.title_zh)
    rows = db.scalars(statement.limit(limit))
    seen = set()
    result = []
    for row in rows:
        key = (row.category_id, row.type_id)
        if key in seen: continue
        seen.add(key)
        result.append({
            "category_id": row.category_id, "type_id": row.type_id,
            "title": row.title, "title_zh": row.title_zh or ""
        })
    return result


@app.get("/api/v1/shops/{shop_id}/metadata/categories/{category_id}/types/{type_id}/attributes")
def list_category_attributes(shop_id: int, category_id: int, type_id: int, db: Session = Depends(get_db)) -> list[dict]:
    return get_category_attributes(db, shop_id, str(category_id), str(type_id))


@app.get("/api/v1/shops/{shop_id}/metadata/categories/{category_id}/types/{type_id}/attributes/{attribute_id}/values")
def list_category_attribute_values(shop_id: int, category_id: int, type_id: int, attribute_id: int, query: str = Query(default="", max_length=100), limit: int = Query(default=50, ge=1, le=100), db: Session = Depends(get_db)) -> list[dict]:
    return search_category_attribute_values(db, shop_id, str(category_id), str(type_id), str(attribute_id), query, limit)


@app.get("/api/v1/shops/{shop_id}/metadata/categories/{category_id}/types/{type_id}/cached-values")
def list_cached_category_attribute_values(shop_id: int, category_id: int, type_id: int, limit_per_attribute: int = Query(default=100, ge=1, le=200), db: Session = Depends(get_db)) -> dict[str, list[dict]]:
    # shop_id is retained in the URL for frontend/API compatibility.  Metadata
    # itself is global; this route never uses the shop as a cache partition.
    return get_cached_category_attribute_values(db, str(category_id), str(type_id), limit_per_attribute=limit_per_attribute)



# ---------------------------------------------------------------------------
# AI assistance endpoints (DeepSeek)
# ---------------------------------------------------------------------------

class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    target_lang: str = Field(default="ru", max_length=4)
    context: str = Field(default="", max_length=2000)


@app.post("/api/v1/ai/translate")
def ai_translate(payload: TranslateRequest) -> dict:
    try:
        return translate_text(payload.text, target_lang=payload.target_lang, context=payload.context)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class SuggestAttributeRequest(BaseModel):
    attribute_name: str = Field(min_length=1, max_length=500)
    attribute_description: str = Field(default="", max_length=2000)
    product_title: str = Field(min_length=1, max_length=500)
    product_description: str = Field(default="", max_length=10000)
    dictionary_options: list[dict] | None = Field(default=None)


@app.post("/api/v1/ai/suggest-attribute")
def ai_suggest_attribute(payload: SuggestAttributeRequest) -> dict:
    try:
        return suggest_attribute_value(
            payload.attribute_name,
            payload.attribute_description,
            payload.product_title,
            payload.product_description,
            dictionary_options=payload.dictionary_options,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class GenerateDescriptionRequest(BaseModel):
    product_title: str = Field(min_length=1, max_length=500)
    source_description: str = Field(default="", max_length=10000)
    specs: list[dict] | None = Field(default=None)
    target_lang: str = Field(default="ru", max_length=4)


class AutoFillRequest(BaseModel):
    category_id: str = Field(min_length=1)
    type_id: str = Field(min_length=1)
    source_product_id: int | None = Field(default=None)
    offer_id: str = Field(default="")


@app.post("/api/v1/shops/{shop_id}/auto-fill")
def auto_fill_attrs(shop_id: int, payload: AutoFillRequest, db: Session = Depends(get_db)) -> dict:
    """Three-layer funnel auto-fill: hardcoded -> hard match -> AI fallback.
    Returns fillable attribute values with method labels.
    """
    source_product = None
    if payload.source_product_id:
        row = db.scalar(select(SourceProductRecord).where(
            SourceProductRecord.id == payload.source_product_id,
        ))
        if row:
            import json as _json
            raw = row.raw_json
            if isinstance(raw, str):
                try:
                    raw = _json.loads(raw)
                except (ValueError, TypeError):
                    raw = {}
            source_product = {
                "title": row.title,
                "raw_json": raw,
                "variants": raw.get("variants", []) if isinstance(raw, dict) else [],
            }
    results = auto_fill_attributes(
        db, shop_id, payload.category_id, payload.type_id,
        source_product=source_product, offer_id=payload.offer_id,
    )
    # Summary stats
    stats = {"hardcoded": 0, "hard_match": 0, "ai_match": 0, "manual": 0, "skip": 0, "inferred": 0}
    for r in results:
        stats[r["method"]] = stats.get(r["method"], 0) + 1
    return {"results": results, "stats": stats}


@app.post("/api/v1/ai/generate-description")
def ai_generate_description(payload: GenerateDescriptionRequest) -> dict:
    try:
        return generate_description(
            payload.product_title,
            payload.source_description,
            payload.specs,
            target_lang=payload.target_lang,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class GenerateRichContentRequest(BaseModel):
    description: str = Field(default="", max_length=10000)
    image_urls: list[str] = Field(default_factory=list)
    shop_name: str = Field(default="", max_length=200)


@app.post("/api/v1/ai/generate-rich-content")
def ai_generate_rich_content(payload: GenerateRichContentRequest) -> dict:
    try:
        return generate_rich_content(payload.description, payload.image_urls, shop_name=payload.shop_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc



class MatchCategoryRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    material: str = Field(default="", max_length=200)
    brand: str = Field(default="", max_length=200)
    source_product_id: int | None = None



# ── FBS Warehouse sync & matching


class WarehouseMatchRequest(BaseModel):
    weight_g: float = Field(gt=0)
    price_cny: float = Field(gt=0)
    length_mm: float = Field(gt=0)
    width_mm: float = Field(gt=0)
    height_mm: float = Field(gt=0)
RMB_SHIPPING_LEVELS = [
    {"name": "Extra Small", "weight_min": 1, "weight_max": 500, "price_min": 0.01, "price_max": 135, "sum_max": 90, "longest_max": 0, "rate_per_kg": 25, "fixed_fee": 3},
    {"name": "Budget", "weight_min": 500, "weight_max": 30000, "price_min": 0.01, "price_max": 135, "sum_max": 150, "longest_max": 80, "rate_per_kg": 17, "fixed_fee": 23},
    {"name": "Small", "weight_min": 1, "weight_max": 2000, "price_min": 135.01, "price_max": 635, "sum_max": 150, "longest_max": 80, "rate_per_kg": 25, "fixed_fee": 16},
    {"name": "Big", "weight_min": 2001, "weight_max": 30000, "price_min": 135.01, "price_max": 635, "sum_max": 250, "longest_max": 150, "rate_per_kg": 17, "fixed_fee": 36},
]


def _match_warehouse_level(weight_g: float, price_cny: float, length_mm: float, width_mm: float, height_mm: float) -> dict | None:
    """Match SKU to a warehouse level based on weight, price, and dimensions.
    Returns the matched level dict or None if no match.
    Multiple matches -> pick lowest shipping fee.
    """
    dims_cm = sorted([length_mm / 10, width_mm / 10, height_mm / 10], reverse=True)
    sum_cm = sum(dims_cm)
    longest_cm = dims_cm[0]
    weight_kg = weight_g / 1000

    candidates = []
    for level in RMB_SHIPPING_LEVELS:
        if not (level["weight_min"] <= weight_g <= level["weight_max"]):
            continue
        if not (level["price_min"] <= price_cny <= level["price_max"]):
            continue
        if sum_cm > level["sum_max"]:
            continue
        if level["longest_max"] > 0 and longest_cm > level["longest_max"]:
            continue
        fee = level["rate_per_kg"] * weight_kg + level["fixed_fee"]
        candidates.append({**level, "shipping_fee_cny": round(fee, 2), "sum_cm": round(sum_cm, 1), "longest_cm": round(longest_cm, 1)})

    if not candidates:
        return None
    return min(candidates, key=lambda c: c["shipping_fee_cny"])


@app.get("/api/v1/shops/{shop_id}/warehouses")
def list_shop_warehouses(shop_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """Fetch and cache FBS warehouses from Ozon API."""
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")
    client_id, api_key = _credentials(db, shop_id)
    try:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            resp = client.list_warehouses()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ozon API 错误: {exc}")
    warehouses = resp.get("warehouses", [])
    # Cache to DB
    db.query(Warehouse).filter(Warehouse.shop_id == shop_id).delete()
    for wh in warehouses:
        db.add(Warehouse(
            shop_id=shop_id,
            name=wh.get("name", ""),
            pickup_point=wh.get("pickup_point", "") if isinstance(wh.get("pickup_point"), str) else "",
            cutoff_time=str(wh.get("cutoff_time", "")),
            workdays=str(wh.get("workdays", "")),
            carrier=str(wh.get("carrier", "")),
        ))
    db.commit()
    return [{"name": wh.get("name", ""), "carrier": wh.get("carrier", "")} for wh in warehouses]


@app.post("/api/v1/shops/{shop_id}/match-warehouse")
def match_warehouse(shop_id: int, payload: WarehouseMatchRequest, db: Session = Depends(get_db)) -> dict:
    """Match a SKU to the correct warehouse level based on weight, price, dimensions."""
    level = _match_warehouse_level(
        weight_g=payload.weight_g,
        price_cny=payload.price_cny,
        length_mm=payload.length_mm,
        width_mm=payload.width_mm,
        height_mm=payload.height_mm,
    )
    if level is None:
        return {"matched": False, "level": None, "error": "PRICING_SHIPPING_LEVEL_MISSING", "message": "尺重或售价不匹配任何仓库等级"}
    return {"matched": True, "level": level["name"], "shipping_fee_cny": level["shipping_fee_cny"], "details": level}


# ── Offer ID auto-generation ─────────────────────────────────────────────
@app.get("/api/v1/shops/{shop_id}/next-offer-id")
def get_next_offer_id(shop_id: int, db: Session = Depends(get_db)) -> dict:
    """Generate the next sequential offer ID for a shop."""
    shop = db.get(Shop, shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="店铺不存在")
    # Derive prefix from shop name: transliterate Cyrillic to Latin (homoglyph), first 2 ASCII alphanumeric
    _CYR_LAT = {
        "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H",
        "О": "O", "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X",
        "Л": "L", "И": "I", "Д": "D", "Г": "G", "Ф": "F", "П": "P",
        "Б": "B", "З": "Z", "Й": "Y", "Ы": "Y", "Э": "E", "Ё": "E",
        "Ж": "J", "Ц": "C", "Ч": "C", "Ш": "S", "Щ": "S", "Ю": "U",
        "Я": "A", "Ъ": "", "Ь": "",
    }
    raw = shop.name.upper()
    latin = "".join(_CYR_LAT.get(c, c) for c in raw)
    prefix = "".join(c for c in latin if c.isalnum() and c.isascii())[:2] or "SK"
    # Find max sequence number from existing offer IDs matching the prefix pattern
    max_num = 0
    all_offer_ids = [r[0] for r in db.execute(select(ListingDraftRecord.offer_id).where(ListingDraftRecord.shop_id == shop_id)).all()]
    all_offer_ids += [r[0] for r in db.execute(select(ProductRecord.offer_id).where(ProductRecord.shop_id == shop_id)).all()]
    for oid in all_offer_ids:
        if oid and oid.startswith(prefix):
            num_part = oid[len(prefix):]
            if num_part.isdigit():
                max_num = max(max_num, int(num_part))
    next_num = max_num + 1
    offer_id = f"{prefix}{next_num:06d}"
    return {"offer_id": offer_id, "prefix": prefix, "sequence": next_num}


# ── Category tree (for manual browsing) ──────────────────────────────────
_category_tree_cache: dict[str, tuple[float, list]] = {}
_CATEGORY_TREE_TTL = 86400  # 24 hours

def _build_category_tree(items: list, parent_category_id: str = "") -> list[dict]:
    """Transform Ozon nested tree into a simplified structure for the frontend."""
    result = []
    for item in items:
        if not isinstance(item, dict) or item.get("disabled") is True:
            continue
        cat_id = item.get("description_category_id")
        type_id = item.get("type_id")
        # Ozon type leaves commonly omit description_category_id. Carry the
        # nearest category ID down so the UI receives a complete ID pair.
        if type_id is not None:
            result.append({
                "id": str(type_id),
                "category_id": str(cat_id or parent_category_id),
                "name": item.get("type_name", ""),
                "type": "type",
            })
        elif cat_id is not None:
            category_id = str(cat_id)
            children = _build_category_tree(item.get("children", []), category_id)
            result.append({
                "id": category_id,
                "name": item.get("category_name", ""),
                "type": "category",
                "children": children,
                "children_count": len(children),
            })
    return result


@app.get("/api/v1/shops/{shop_id}/metadata/category-tree")
def get_category_tree_endpoint(shop_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """Return the Ozon category tree (Chinese) for manual drill-down browsing.
    Cached in memory for 24 hours."""
    cache_key = str(shop_id)
    cached = _category_tree_cache.get(cache_key)
    if cached and (_time.time() - cached[0]) < _CATEGORY_TREE_TTL:
        return cached[1]

    from .sync_service import _credentials, SyncConfigurationError
    try:
        client_id, api_key = _credentials(db, shop_id)
    except SyncConfigurationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    from .integrations.ozon_seller import OzonSellerClient
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        response = client.get_category_tree("ZH_HANS")
    tree = _build_category_tree(response.get("result", []))
    _category_tree_cache[cache_key] = (_time.time(), tree)
    return tree


# ── Category match history ──────────────────────────────────────────────
class CategoryMatchHistoryRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    category_id: str = Field(min_length=1, max_length=64)
    type_id: str = Field(min_length=1, max_length=64)
    category_title_zh: str = Field(default="", max_length=500)
    source: str = Field(default="manual", max_length=20)


def _extract_title_keywords(title: str) -> str:
    """Extract meaningful keywords from a Chinese product title for matching."""
    import re as _re
    suffixes = ["包", "鞋", "衣", "裤", "裙", "帽", "表", "灯", "杯", "壳", "架", "盒",
                "箱", "袋", "垫", "毯", "枕", "碗", "盘", "壶", "锅", "刀", "剪",
                "链", "绳", "带", "扣", "环", "钩", "管", "棒", "板", "贴", "膜",
                "器", "机", "线", "充", "耳", "玩具", "收纳", "整理", "装饰",
                "配件", "套装", "工具", "仪器", "模具"]
    keywords = set()
    for suffix in suffixes:
        idx = title.rfind(suffix)
        if idx >= 0:
            start = max(0, idx - 4)
            keywords.add(title[start:idx + len(suffix)])
            keywords.add(suffix)
    parts = _re.split(r"[\s,，、/\\[\]\(\)（）【】]+", title)
    for part in parts:
        part = part.strip()
        if 2 <= len(part) <= 8:
            keywords.add(part)
    keywords = {k for k in keywords if 1 <= len(k) <= 8}
    return " ".join(sorted(keywords, key=len, reverse=True))


@app.post("/api/v1/shops/{shop_id}/category-match-history")
def save_category_match_history(shop_id: int, payload: CategoryMatchHistoryRequest, db: Session = Depends(get_db)) -> dict:
    """Save a category selection so future similar titles can auto-match."""
    keywords = _extract_title_keywords(payload.title)
    title_hash = hashlib.md5(keywords.encode("utf-8")).hexdigest()

    existing = db.scalar(select(CategoryMatchHistoryRecord).where(
        CategoryMatchHistoryRecord.shop_id == shop_id,
        CategoryMatchHistoryRecord.title_hash == title_hash,
    ))
    if existing:
        existing.hit_count += 1
        existing.category_id = payload.category_id
        existing.type_id = payload.type_id
        existing.category_title_zh = payload.category_title_zh
        existing.title = payload.title
        existing.title_keywords = keywords
        existing.source = payload.source
    else:
        db.add(CategoryMatchHistoryRecord(
            shop_id=shop_id,
            title=payload.title,
            title_keywords=keywords,
            title_hash=title_hash,
            category_id=payload.category_id,
            type_id=payload.type_id,
            category_title_zh=payload.category_title_zh,
            source=payload.source,
        ))
    db.commit()
    return {"status": "ok", "keywords": keywords, "hit_count": (existing.hit_count if existing else 1)}


@app.get("/api/v1/shops/{shop_id}/category-match-history")
def list_category_match_history(shop_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """List recent category match history entries."""
    rows = db.scalars(select(CategoryMatchHistoryRecord).where(
        CategoryMatchHistoryRecord.shop_id == shop_id,
    ).order_by(CategoryMatchHistoryRecord.updated_at.desc()).limit(100))
    return [{"title": r.title, "keywords": r.title_keywords, "category_id": r.category_id,
             "type_id": r.type_id, "category_title_zh": r.category_title_zh,
             "source": r.source, "hit_count": r.hit_count} for r in rows]


class CategoryDecisionRequest(BaseModel):
    source_product_id: int | None = None
    title: str = Field(default="", max_length=500)
    material: str = Field(default="", max_length=200)
    category_id: str = Field(min_length=1, max_length=64)
    type_id: str = Field(min_length=1, max_length=64)
    category_title: str = Field(default="", max_length=500)
    learning_mode: str = Field(pattern="^(confirm|remember|one_off)$")
    actor: str = Field(default="operator", max_length=128)


class DecisionMemoryStatusRequest(BaseModel):
    status: str = Field(pattern="^(active|disabled|revoked)$")
    actor: str = Field(default="operator", max_length=128)


@app.post("/api/v1/shops/{shop_id}/decision-memory/category")
def save_category_decision(shop_id: int, payload: CategoryDecisionRequest, db: Session = Depends(get_db)) -> dict:
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")
    try:
        memory = record_category_decision(
            db, shop_id=shop_id, source_product_id=payload.source_product_id,
            title=payload.title, material=payload.material, category_id=payload.category_id,
            type_id=payload.type_id, category_title=payload.category_title,
            learning_mode=payload.learning_mode, actor=payload.actor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "recorded" if memory else "one_off", "memory_id": memory.id if memory else None}


@app.get("/api/v1/shops/{shop_id}/decision-memory")
def list_decision_memory(shop_id: int, decision_type: str | None = None, db: Session = Depends(get_db)) -> list[dict]:
    query = select(DecisionMemoryRecord).where(DecisionMemoryRecord.shop_id == shop_id)
    if decision_type:
        query = query.where(DecisionMemoryRecord.decision_type == decision_type)
    rows = db.scalars(query.order_by(DecisionMemoryRecord.updated_at.desc()).limit(200)).all()
    return [{
        "id": row.id, "decision_type": row.decision_type, "source_product_id": row.source_product_id,
        "title": row.title, "domain": row.domain, "decision": json.loads(row.decision_value_json),
        "source": row.source, "trust_score": float(row.trust_score), "status": row.status,
        "confirmation_count": row.confirmation_count, "ozon_success_count": row.ozon_success_count,
        "rejection_count": row.rejection_count, "updated_at": row.updated_at,
    } for row in rows]


@app.post("/api/v1/shops/{shop_id}/decision-memory/{memory_id}/status")
def update_decision_memory_status(shop_id: int, memory_id: int, payload: DecisionMemoryStatusRequest, db: Session = Depends(get_db)) -> dict:
    memory = db.scalar(select(DecisionMemoryRecord).where(
        DecisionMemoryRecord.id == memory_id, DecisionMemoryRecord.shop_id == shop_id,
    ))
    if memory is None:
        raise HTTPException(status_code=404, detail="记忆不存在")
    before = memory.status
    allowed_transitions = {
        "active": {"disabled", "revoked"},
        "disabled": {"active", "revoked"},
        "negative": {"revoked"},
        "revoked": set(),
    }
    if payload.status == before:
        return {"id": memory.id, "status": memory.status}
    if payload.status not in allowed_transitions.get(before, set()):
        raise HTTPException(status_code=409, detail=f"不允许从 {before} 变更为 {payload.status}")
    memory.status = payload.status
    db.add(DecisionFeedbackRecord(
        memory_id=memory.id, shop_id=shop_id, source_product_id=memory.source_product_id,
        action=payload.status, actor=payload.actor,
        before_json=json.dumps({"status": before}), after_json=json.dumps({"status": payload.status}),
    ))
    db.commit()
    return {"id": memory.id, "status": memory.status}


class HashtagRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=5000)
    category_zh: str = Field(default="", max_length=200)


@app.post("/api/v1/ai/generate-hashtags")
def generate_hashtags(payload: HashtagRequest) -> dict:
    """Generate Russian search hashtags for a product.\r?\n
    Target 30 tags; 20-30 valid tags are accepted. Each tag is 1-2 words,
    prefixed with # and space-separated. No marketing/promo/banned words,
    brands, or numbers.
    """
    try:
        from .ai_service import generate_product_hashtags
        hashtags = generate_product_hashtags(payload.title, payload.description, payload.category_zh)
        return {"hashtags": hashtags}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI生成失败: {e}")


@app.post("/api/v1/shops/{shop_id}/ai/match-category")
def ai_match_category(shop_id: int, payload: MatchCategoryRequest, db: Session = Depends(get_db)) -> dict:
    """Chinese-to-Chinese fuzzy category matching. No AI, no translation.

    Extracts product type keywords from the Chinese title and searches
    the title_zh field in the local Ozon category cache.
    """
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")

    import re as _re

    title = payload.title.strip()
    # Marketing phrases are not product nouns. In particular, the old keyword
    # extractor saw the "包" in "包邮" and incorrectly recalled bag/accessory
    # categories for kitchen products such as 锅铲.
    category_title = _re.sub(r"^(?:包邮|厂家直销|现货|批发|热卖|爆款|特价|促销|新品)+", "", title)
    category_title = _re.sub(r"(?:包邮|厂家直销|现货|批发|热卖|爆款|特价|促销|新品)", "", category_title)
    title_lower = category_title.lower()
    mold_context = "模具" in category_title
    culinary_mold = mold_context and any(word in category_title for word in ("蛋糕","烘焙","甜品","冰格","糖果","巧克力","厨房","食品","饼干"))
    kitchen_tool_context = any(word in category_title for word in ("锅铲", "铲子", "炒菜", "不粘锅", "厨具", "厨房", "锅刷", "洗碗刷"))

    def category_compatible(category_title: str) -> bool:
        value=(category_title or "").lower()
        if culinary_mold:
            if any(word in value for word in ("服装","首饰","徽章","胸针","收纳","饰品")): return False
            return any(word in value for word in ("烹饪","烘焙","炊具","冰格","糖果","厨房","模具"))
        if kitchen_tool_context and any(word in value for word in ("配饰", "包/袋", "箱包", "首饰", "服装")):
            return False
        if mold_context and any(word in value for word in ("服装","首饰","徽章","胸针")): return False
        return True

    # Legacy click-history is intentionally not used for ranking. It contains
    # unverified selections and must not be allowed to teach future automation.
    try:
        memory_candidates = recommend_categories(
            db, shop_id=shop_id, title=title, material=payload.material,
            source_product_id=payload.source_product_id, limit=5,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ── 2. Normal keyword matching ──
    # Common product suffixes in Chinese e-commerce
    suffixes = ["包", "鞋", "衣", "裤", "裙", "帽", "表", "灯", "杯", "壳", "架", "盒",
                "箱", "袋", "垫", "毯", "枕", "碗", "盘", "壶", "锅", "刀", "剪",
                "链", "绳", "带", "扣", "环", "钩", "管", "棒", "板", "贴", "膜",
                "器", "机", "线", "充", "耳", "玩具", "收纳", "整理", "装饰",
                "配件", "套装", "工具", "仪器",
                # Additional product-type suffixes
                "模具", "烛台", "香薰", "挂件", "贴纸", "手链", "项链", "耳环",
                "花瓶", "相框", "钟表", "音响", "支架", "底座", "夹子",
                # Jewelry & accessories
                "胸针", "徽章", "戒指", "耳钉", "项链", "手链", "手镯", "脚链",
                "发夹", "发箍", "发带", "发圈", "发饰", "头饰",
                "腰带", "皮带", "领带", "围巾", "丝巾", "手套", "袜子",
                "眼镜", "墨镜", "帽子", "雨伞", "阳伞",
                # Home & kitchen
                "抱枕", "靠垫", "坐垫", "地垫", "地毯", "挂毯", "窗帘",
                "毛巾", "浴巾", "牙刷", "牙膏", "梳子", "镜子",
                "餐具", "茶具", "咖啡具", "酒具", "保鲜盒", "便当盒",
                "水壶", "水杯", "保温杯", "花瓶", "花盆", "收纳盒", "收纳箱",
                "砧板", "菜板", "烤盘", "烤网", "蒸笼", "炒锅", "汤锅",
                "围裙", "隔热垫", "手套", "百洁布", "清洁刷",
                # Stationery & office
                "笔记本", "记事本", "便签", "贴纸", "胶带", "印章", "印泥",
                "书签", "笔筒", "文件袋", "文件夹", "计算器", "订书机",
                # Beauty & personal care
                "面膜", "面霜", "精华", "口红", "唇釉", "粉底", "眼影",
                "化妆刷", "美妆蛋", "粉扑", "卸妆棉", "棉签",
                # Auto & tools
                "手机壳", "手机套", "数据线", "充电器", "耳机", "音箱",
                "鼠标", "键盘", "U盘", "硬盘", "支架",
                # Pet & toys
                "玩具", "宠物玩具", "磨牙棒", "猫抓板", "狗窝", "猫窝",
                # Craft & DIY
                "滴油", "珐琅", "手工皂", "蜡烛", "石膏", "滴胶"]

    keywords = set()
    # Extract compound words ending with product suffixes
    for suffix in suffixes:
        idx = category_title.rfind(suffix)
        if idx >= 0:
            start = max(0, idx - 4)
            keywords.add(category_title[start:idx + len(suffix)])
            keywords.add(suffix)
            start2 = max(0, idx - 2)
            keywords.add(category_title[start2:idx + len(suffix)])

    # Split by separators and take meaningful words
    parts = _re.split(r"[\s,，、/\\\[\]\(\)（）【】]+", category_title)
    for part in parts:
        part = part.strip()
        if 2 <= len(part) <= 8:
            keywords.add(part)

    keywords = {k for k in keywords if 1 <= len(k) <= 8}
    if not keywords:
        # Fallback: split the title into chunks by common separators and
        # use any 2-6 character Chinese segment as a weak keyword.
        # This guarantees at least some candidates for unusual titles.
        parts = _re.split(r"[\s,，、/\\\[\]\(\)（）【】\-·]+", category_title)
        for part in parts:
            part = part.strip()
            if 2 <= len(part) <= 6:
                keywords.add(part)
        # Also slide a 2-char window over Chinese runs for more recall
        for i in range(len(category_title) - 1):
            chunk = category_title[i:i+2]
            if all("\u4e00" <= ch <= "\u9fff" for ch in chunk):
                keywords.add(chunk)
        keywords = {k for k in keywords if 2 <= len(k) <= 8}
    if not keywords:
        return {"candidates": [], "keywords": []}


    # ── Context-aware keyword penalties ──
    # When "模具" (mold) appears in the title, product-type words like "盒", "收纳"
    # describe what the mold MAKES, not the product itself. Deprioritize them.
    context_penalties = {}
    if "模具" in category_title:
        for dep in ["收纳盒", "收纳", "盒", "箱", "袋", "碗", "盘", "杯", "壶"]:
            if dep in keywords:
                context_penalties[dep] = -100  # Heavy penalty
    if "贴纸" in category_title or "贴膜" in category_title:
        for dep in ["手机", "电脑", "平板"]:
            if dep in keywords:
                context_penalties[dep] = -80
    # When "挂绳" or "手绳" is in title, "手机" is just the usage, not the product
    if "挂绳" in category_title or "手绳" in category_title or "腕带" in category_title:
        for dep in ["手机"]:
            if dep in keywords:
                context_penalties[dep] = -80

    # Boost keywords that appear multiple times in the title (strong product type signal)
    keyword_freq = {}
    for kw in keywords:
        keyword_freq[kw] = category_title.count(kw)

    # Search title_zh in category cache with smart scoring
    seen = {}
    for kw in sorted(keywords, key=len, reverse=True):
        rows = db.scalars(select(OzonGlobalCategoryCacheRecord).where(
                OzonGlobalCategoryCacheRecord.type_id != "",
            OzonGlobalCategoryCacheRecord.title_zh.like(f"%{kw}%"),
        ).limit(200)).all()
        for row in rows:
            if not category_compatible(row.title_zh or row.title or ""): continue
            key = (row.category_id, row.type_id)
            title_zh = row.title_zh or ""
            parts = title_zh.split(" / ")
            leaf = parts[-1].strip() if parts else title_zh
            parent = " / ".join(parts[:-1]).strip() if len(parts) > 1 else ""

            kw_len = len(kw)
            if kw in leaf:
                base = kw_len * 20
                leaf_bonus = max(0, 10 - len(leaf)) * 3
                start_bonus = 50 if leaf.startswith(kw) else 0
                short_bonus = 30 if len(leaf) <= 3 else (15 if len(leaf) <= 5 else 0)
                exact_bonus = (100 if len(kw) >= 2 else 30) if leaf == kw else 0
                type_bonus = 200 if leaf.startswith(kw + "/") else 0
                compound_penalty = -30 if (leaf.startswith(kw) and len(leaf) > len(kw) + 1
                                           and not leaf.startswith(kw + "/")) else 0
                # Context penalty: e.g. "收纳盒" when "模具" is in title
                ctx_pen = context_penalties.get(kw, 0)
                # Frequency boost: keyword appearing multiple times = strong signal
                freq_bonus = (keyword_freq.get(kw, 1) - 1) * 40
                score = base + leaf_bonus + start_bonus + short_bonus + exact_bonus + type_bonus + compound_penalty + ctx_pen + freq_bonus
            elif kw in parent:
                ctx_pen = context_penalties.get(kw, 0)
                score = kw_len * 5 + ctx_pen
            else:
                score = kw_len * 3

            if key not in seen:
                seen[key] = {
                    "category_id": row.category_id, "type_id": row.type_id,
                    "title": row.title, "title_zh": title_zh,
                    "score": score, "matched": [kw],
                }
            else:
                seen[key]["score"] += score
                seen[key]["matched"].append(kw)

    candidates = sorted(seen.values(), key=lambda c: c["score"], reverse=True)[:10]

    if culinary_mold:
        for candidate in candidates:
            label=candidate.get("title_zh") or candidate.get("title") or ""
            if "冰格、糖果模具" in label: candidate["score"] += 900
            elif "烹饪模具" in label: candidate["score"] += 800
            elif "烘焙模具" in label: candidate["score"] += 700
        candidates=sorted(candidates,key=lambda c:c["score"],reverse=True)[:10]

    # Merge only trusted memory (explicitly confirmed/corrected or Ozon-verified).
    if memory_candidates:
        for memory_candidate in memory_candidates:
            key = (memory_candidate["category_id"], memory_candidate["type_id"])
            existing = next((candidate for candidate in candidates if (candidate["category_id"], candidate["type_id"]) == key), None)
            if existing is None:
                candidates.insert(0, memory_candidate)
            else:
                existing.update({
                    "source": "trusted_memory", "confidence": memory_candidate["confidence"],
                    "evidence": memory_candidate["evidence"], "memory_id": memory_candidate["memory_id"],
                    "score": max(existing["score"], memory_candidate["score"]),
                })
        candidates = sorted(candidates, key=lambda c: (
            c.get("source") == "trusted_memory",
            c["score"]
        ), reverse=True)[:10]

    # Use the configured OpenAI-compatible model (Volcano Ark, DeepSeek, or a
    # later provider) only for genuinely ambiguous new products. It may rank
    # existing Ozon candidates, never invent IDs or write decision memory.
    ai_reranked = False
    ai_reason = ""
    ai_enabled = os.getenv("CATEGORY_AI_RERANK_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
    top_score = float(candidates[0].get("score", 0)) if candidates else 0.0
    next_score = float(candidates[1].get("score", 0)) if len(candidates) > 1 else 0.0
    ambiguous = len(candidates) > 1 and (top_score < 320 or top_score - next_score < max(100, top_score * 0.35))
    if ai_enabled and not memory_candidates and ambiguous:
        try:
            ai_result = match_category_with_ai(title, candidates[:10], material=payload.material, brand=payload.brand)
            best = ai_result.get("best")
            if best:
                selected_key = (str(best.get("category_id")), str(best.get("type_id")))
                selected = next((row for row in candidates if (str(row.get("category_id")), str(row.get("type_id"))) == selected_key), None)
                if selected:
                    candidates.remove(selected)
                    selected["source"] = "ai_rerank"
                    selected["ai_reason"] = str(ai_result.get("reason") or "")[:300]
                    selected["ai_model"] = ai_result.get("model")
                    candidates.insert(0, selected)
                    ai_reranked = True
                    ai_reason = selected["ai_reason"]
        except RuntimeError:
            # Missing/unavailable AI must not block the deterministic matcher.
            pass

    return {"candidates": candidates, "keywords": sorted(keywords, key=len, reverse=True),
            "memory_matched": len(memory_candidates) > 0, "ai_reranked": ai_reranked,
            "ai_reason": ai_reason}

# ---------------------------------------------------------------------------
# Ozon quality feedback sync + auto-fix
# ---------------------------------------------------------------------------

def _record_listing_feedback(
    db: Session,
    draft: ListingDraftRecord,
    *,
    ozon_product_id=None,
    overall_rating=None,
    moderation_status="",
    validation_status="",
    issues=None,
    groups=None,
    ozon_errors=None,
) -> None:
    """Append the Ozon response under the stable KC/Offer ID audit key."""
    details = {
        "offer_id": draft.offer_id,
        "draft_id": draft.id,
        "source_product_id": draft.source_product_id,
        "ozon_product_id": ozon_product_id,
        "overall_rating": overall_rating,
        "moderation_status": moderation_status or "",
        "validation_status": validation_status or "",
        "issues": issues or [],
        "groups": groups or [],
        "ozon_errors": ozon_errors or [],
    }
    db.add(AuditEventRecord(
        shop_id=draft.shop_id,
        actor_id="ozon-feedback-sync",
        action="listing_feedback_synced",
        entity_type="listing_offer",
        entity_id=str(draft.offer_id),
        details_json=json.dumps(details, ensure_ascii=False),
    ))


def _backfill_legacy_feedback(db: Session) -> None:
    """Preserve ratings/issues written before the feedback audit stream existed."""
    drafts = db.scalars(select(ListingDraftRecord).where(
        or_(ListingDraftRecord.quality_rating.is_not(None), ListingDraftRecord.ozon_issues_json.is_not(None)),
    )).all()
    if not drafts:
        return
    offer_ids = {str(d.offer_id) for d in drafts if d.offer_id}
    existing = set(db.scalars(select(AuditEventRecord.entity_id).where(
        AuditEventRecord.action == "listing_feedback_synced",
        AuditEventRecord.entity_id.in_(offer_ids or ["__none__"]),
    )).all())
    changed = False
    for draft in drafts:
        if not draft.offer_id or str(draft.offer_id) in existing:
            continue
        try:
            issues = json.loads(draft.ozon_issues_json or "[]")
        except (TypeError, ValueError):
            issues = []
        _record_listing_feedback(
            db, draft, ozon_product_id=draft.ozon_product_id,
            overall_rating=draft.quality_rating,
            moderation_status=draft.moderation_status or "",
            validation_status="legacy_backfill", issues=issues,
        )
        changed = True
    if changed:
        db.commit()

@app.post("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}/sync-feedback")
def sync_listing_feedback(shop_id: int, draft_id: int, db: Session = Depends(get_db)) -> dict:
    """Fetch product quality rating + attributes from Ozon, compare with draft, return issues."""
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient

    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.id == draft_id,
        ListingDraftRecord.shop_id == shop_id,
    ))
    if draft is None:
        raise HTTPException(status_code=404, detail="草稿不存在")

    # Prefer the persistent Ozon product ID. A rejected import has no product
    # ID yet, so its authoritative feedback is the import task, not an Offer ID
    # lookup that can only return a misleading "product not found" error.
    ozon_pid = draft.ozon_product_id
    client_id, api_key = _credentials(db, shop_id)
    if not ozon_pid and draft.import_task_id:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            import_info = client.get_import_info(task_id=draft.import_task_id)
        task_items = import_info.get("result", {}).get("items", []) or []
        product_ids = [item.get("product_id") for item in task_items if item.get("product_id")]
        if product_ids:
            ozon_pid = product_ids[0]
            draft.ozon_product_id = ozon_pid
            db.commit()
        else:
            task_issues = []
            for item in task_items:
                errors = item.get("errors") or []
                if isinstance(errors, dict):
                    errors = [errors]
                for error in errors:
                    if isinstance(error, dict):
                        message = error.get("message") or error.get("description") or error.get("code") or json.dumps(error, ensure_ascii=False)
                        task_issues.append({
                            "type": "ozon_error", "code": error.get("code", ""),
                            "field": error.get("field", ""), "level": error.get("level", ""),
                            "attribute_id": error.get("attribute_id"), "attribute_name": error.get("attribute_name", ""),
                            "message": message, "auto_fixable": _is_ozon_error_fixable(error.get("code", ""), error.get("field", "")),
                        })
                    else:
                        task_issues.append({"type": "ozon_error", "code": "", "field": "", "level": "", "message": str(error), "auto_fixable": False})
            if not task_issues:
                task_issues.append({"type": "import_task_status", "description": "Ozon 导入任务尚未返回商品 ID，请稍后再次同步反馈。", "auto_fixable": False})
            task_issues = _deduplicate_ozon_issues(task_issues)
            draft.quality_rating = None
            draft.moderation_status = None
            draft.ozon_issues_json = json.dumps(task_issues, ensure_ascii=False)
            _record_listing_feedback(
                db, draft, ozon_product_id=None, overall_rating=None,
                validation_status="import_task", issues=task_issues,
            )
            mark_bulk_items_for_ozon_feedback(db, draft, task_issues)
            db.commit()
            return {
                "ok": True, "ozon_product_id": None, "overall_rating": None,
                "moderation_status": "", "validation_status": "import_task",
                "groups": [], "issues": task_issues, "ozon_errors": task_issues,
                "ozon_title": "", "draft_title": draft.title,
            }

    if not ozon_pid:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            products = client.list_products(filter={"offer_id": [draft.offer_id]}, limit=5)
            items = products.get("result", {}).get("items", [])
            if not items:
                raise HTTPException(status_code=404, detail="Ozon 上未找到该商品 (offer_id=" + draft.offer_id + ")")
            ozon_pid = items[0].get("product_id")
            if ozon_pid:
                draft.ozon_product_id = ozon_pid
                db.commit()

    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        # 1. Get product info first — for SKU IDs, errors, moderation status
        product_info = client.get_product_info(product_ids=[ozon_pid])
        product_items = product_info.get("items", [])
        product_detail = product_items[0] if product_items else {}
        ozon_errors = product_detail.get("errors", [])
        ozon_statuses = product_detail.get("statuses", {})

        # Extract real Ozon SKU IDs from sources (rating-by-sku needs SKU IDs, not product IDs)
        sku_ids = []
        for src in (product_detail.get("sources") or []):
            if src.get("sku"):
                sku_ids.append(src["sku"])

        # 2. Get content rating (0-100 score + improvement suggestions)
        rating_data = {}
        if sku_ids:
            rating_resp = client.get_product_rating_by_sku(skus=sku_ids)
            rating_products = rating_resp.get("products", [])
            if rating_products:
                # Same product card shares one content rating across all SKUs
                rating_data = rating_products[0]

        # 3. Get actual stored attributes
        attrs_resp = client.get_product_attributes_v4(product_ids=[ozon_pid])
        attrs_result = attrs_resp.get("result", [])
        ozon_attrs = attrs_result[0] if attrs_result else {}

    # Add Ozon's actual error messages first (these are the real issues)
    issues = []
    for err in ozon_errors:
        texts = err.get("texts", {}) if isinstance(err.get("texts"), dict) else {}
        message = err.get("message") or texts.get("message") or texts.get("description") or texts.get("short_description") or err.get("code", "")
        issues.append({
            "type": "ozon_error",
            "code": err.get("code", ""),
            "field": err.get("field", ""),
            "level": err.get("level", ""),
            "message": message,
            "auto_fixable": _is_ozon_error_fixable(err.get("code", ""), err.get("field", "")),
        })

    # Add rating condition issues
    # A newly imported product may be approved before Ozon has generated a
    # content rating.  Missing rating data is not a real zero score.
    overall_rating = rating_data.get("rating")
    for group in rating_data.get("groups", []):
        group_name = group.get("name", "")
        group_key = group.get("key", "")
        for cond in group.get("conditions", []):
            if not cond.get("fulfilled", False):
                issues.append({
                    "type": "rating_condition",
                    "group": group_name,
                    "group_key": group_key,
                    "key": cond.get("key", ""),
                    "description": cond.get("description", ""),
                    "cost": cond.get("cost", 0),
                    "auto_fixable": _is_auto_fixable(cond.get("key", "")),
                })

    # Check improve_attributes
    for group in rating_data.get("groups", []):
        for imp_attr in group.get("improve_attributes", []):
            issues.append({
                "type": "missing_attribute",
                "group": group.get("name", ""),
                "attribute_id": imp_attr.get("id"),
                "attribute_name": imp_attr.get("name", ""),
                "auto_fixable": True,
            })

    # Check title for repetition (compare draft title with Ozon stored title)
    ozon_title = ozon_attrs.get("name", "")
    if ozon_title:
        title_issues = _check_title_issues(ozon_title)
        for ti in title_issues:
            issues.append({"type": "title_issue", **ti, "auto_fixable": True})

    # Check color attribute has dictionary_value_id
    for attr in (ozon_attrs.get("attributes") or []):
        attr_id = attr.get("attribute_id") or attr.get("id")
        for val in (attr.get("values") or []):
            if not val.get("dictionary_value_id") and val.get("value"):
                # Check if this attribute should have a dictionary value
                attr_cached = None
                for ac in (db.scalars(select(OzonGlobalAttributeCacheRecord).where(
                            OzonGlobalAttributeCacheRecord.category_id == draft.category_id,
                    OzonGlobalAttributeCacheRecord.type_id == draft.type_id,
                    OzonGlobalAttributeCacheRecord.attribute_id == str(attr_id),
                )) if draft.category_id and draft.type_id else []):
                    attr_cached = ac
                    break
                if attr_cached and attr_cached.dictionary_id:
                    issues.append({
                        "type": "dict_value_missing",
                        "attribute_id": str(attr_id),
                        "attribute_name": attr_cached.name,
                        "current_value": val.get("value"),
                        "auto_fixable": True,
                    })

    # Extract moderation status
    mod_status = ""
    val_status = ""
    if isinstance(ozon_statuses, dict):
        mod_status = ozon_statuses.get("moderate_status", "")
        val_status = ozon_statuses.get("validation_status", "")

    # Build compact issues for storage
    compact_issues = []
    for iss in issues:
        compact_issues.append({
            "type": iss.get("type", ""),
            "description": iss.get("description", iss.get("message", "")),
            "field": iss.get("field", ""),
            "attribute_name": iss.get("attribute_name", ""),
            "auto_fixable": iss.get("auto_fixable", False),
        })
    for oe in ozon_errors:
        texts = oe.get("texts", {}) if isinstance(oe.get("texts"), dict) else {}
        compact_issues.append({
            "type": "ozon_error",
            "code": oe.get("code", ""),
            "field": oe.get("field", ""),
            "description": texts.get("description", texts.get("message", "")),
            "level": oe.get("level", ""),
        })

    # Store rating, moderation status, and issues on draft for collection box display
    draft.quality_rating = overall_rating
    draft.moderation_status = mod_status
    draft.ozon_issues_json = json.dumps(compact_issues, ensure_ascii=False) if compact_issues else None
    _record_listing_feedback(
        db, draft, ozon_product_id=ozon_pid, overall_rating=overall_rating,
        moderation_status=mod_status, validation_status=val_status,
        issues=issues, groups=rating_data.get("groups", []), ozon_errors=ozon_errors,
    )
    mark_bulk_items_for_ozon_feedback(db, draft, compact_issues)
    db.commit()

    return {
        "ok": True,
        "ozon_product_id": ozon_pid,
        "overall_rating": overall_rating,
        "moderation_status": mod_status,
        "validation_status": val_status,
        "groups": rating_data.get("groups", []),
        "issues": issues,
        "ozon_errors": ozon_errors,
        "ozon_title": ozon_title,
        "draft_title": draft.title,
    }


def _is_ozon_error_fixable(code: str, field: str) -> bool:
    """Check if an Ozon error can be auto-fixed."""
    normalized_code = (code or "").upper()
    if normalized_code in {"BR_ASSORTMENT", "VALUE_MIN_LIMIT"}:
        return True
    # Title issues -> AI retranslate
    if "name" in field.lower() or "назван" in field.lower() or "title" in field.lower():
        return True
    # Color/attribute value issues -> dictionary lookup
    if "color" in field.lower() or "цвет" in field.lower() or "attribute" in field.lower() or "значен" in field.lower():
        return True
    # Image issues -> can potentially fix URLs
    if "image" in field.lower() or "изображ" in field.lower() or "фото" in field.lower():
        return True
    # Rich content issues -> regenerate
    if "rich" in field.lower() or "json" in field.lower() or "контент" in field.lower():
        return True
    return False


def _deduplicate_ozon_issues(issues: list[dict]) -> list[dict]:
    """Ozon may repeat an identical error for one SKU in import responses."""
    result: list[dict] = []
    seen: set[tuple[str, str, str, str]] = set()
    for issue in issues:
        key = (
            str(issue.get("offer_id") or ""),
            str(issue.get("code") or ""),
            str(issue.get("field") or ""),
            str(issue.get("description") or issue.get("message") or ""),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(issue)
    return result


def _is_auto_fixable(condition_key: str) -> bool:
    """Check if a rating condition can be auto-fixed."""
    auto_fixable_keys = {
        "text_annotation_100_chars", "text_annotation_500_chars",
        "other__15_to_50_percent", "other_70_percent",
        "media_images_1_2", "media_images_3_4", "media_images_5_7",
    }
    return condition_key in auto_fixable_keys


def _check_title_issues(title: str) -> list[dict]:
    """Check title for common issues like word repetition."""
    issues = []
    if not title:
        return issues
    words = title.lower().split()
    word_counts = {}
    for w in words:
        clean = w.strip(chr(44) + chr(46) + chr(33) + chr(63) + chr(45) + chr(58) + chr(59) + chr(40) + chr(41) + chr(34) + chr(39))
        if len(clean) > 2:
            word_counts[clean] = word_counts.get(clean, 0) + 1
    repeated = {w: c for w, c in word_counts.items() if c > 1}
    if repeated:
        issues.append({
            "description": "标题中有重复词汇: " + ", ".join(f"{w}({c}次)" for w, c in repeated.items()),
            "repeated_words": repeated,
        })
    if len(title) > 200:
        issues.append({"description": "标题过长 (" + str(len(title)) + " 字符)，建议精简"})
    return issues


@app.post("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}/auto-fix")
def auto_fix_listing(shop_id: int, draft_id: int, db: Session = Depends(get_db)) -> dict:
    """Attempt to auto-fix common listing issues. Returns list of fixes applied."""
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient
    from .ai_service import translate_text, _chat
    from .pipeline.content_generation import _is_publishable_russian_text, _safe_category_fallback

    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.id == draft_id,
        ListingDraftRecord.shop_id == shop_id,
    ))
    if draft is None:
        raise HTTPException(status_code=404, detail="草稿不存在")

    fixes = []
    raw_issues = [issue for issue in json.loads(draft.ozon_issues_json or "[]") if isinstance(issue, dict)]
    issue_codes = {
        str(issue.get("code") or "").upper()
        for issue in raw_issues
    }
    issue_attribute_ids = {
        str(issue.get("attribute_id"))
        for issue in raw_issues if issue.get("attribute_id") is not None
    }

    # Ozon reports the hashtag single-value violation against the old import
    # payload.  The current payload builder already sends one space-separated
    # value, but a corrective resubmission still needs an explicit, auditable
    # normalization step so the scheduler can re-run the same payload path.
    if "ERROR_ATTRIBUTE_IS_NOT_COLLECTION" in issue_codes:
        for attr in draft.attribute_values:
            if str(attr.attribute_id) != "23171":
                continue
            normalized_tags = " ".join(sanitize_hashtags(
                re.sub(r"[|,;；，\n]+", " ", attr.value_text or ""),
                max_count=30,
            ))
            if normalized_tags != (attr.value_text or ""):
                attr.value_text = normalized_tags
                fixes.append({"field": "attribute.23171", "method": "rebuild_single_value_hashtag"})
            else:
                # Even when the text is already normalized, force the current
                # submit builder to be retried once for the old payload error.
                fixes.append({"field": "attribute.23171", "method": "rebuild_single_value_hashtag", "changed": False})
            break

    # 1. Chinese text is never valid Ozon Russian content. Re-translate the
    # saved draft in place, but only as a local correction; the operator still
    # decides when to submit the corrected listing.
    if draft.description and re.search(r"[\u4e00-\u9fff]", draft.description):
        try:
            translated = translate_text(
                draft.description,
                target_lang="ru",
                context="将商品描述完整翻译为自然俄文。保留参数、尺寸、数量和安全信息；不要保留中文字符。",
            )
            value = (translated.get("translated") or "").strip()
            if value and not re.search(r"[\u4e00-\u9fff]", value):
                old_description = draft.description
                draft.description = value[:10000]
                fixes.append({"field": "description", "old_length": len(old_description), "new_length": len(value), "method": "ai_retranslate_chinese"})
            else:
                fixes.append({"field": "description", "error": "翻译结果仍包含中文，未写回"})
        except Exception as exc:
            fixes.append({"field": "description", "error": str(exc)[:300]})

    # Ozon prohibits a product card that promises a random/assorted variant.
    # This ERP has explicit color SKU rows, so the generic supplier sentence is
    # both inaccurate and a moderation blocker. Remove it from every product
    # text surface only after Ozon has returned BR_ASSORTMENT.
    issue_text = " ".join(str(issue.get(key) or "") for issue in raw_issues for key in ("code", "field", "description", "message")).lower()
    if "BR_ASSORTMENT" in issue_codes or "组合商品" in issue_text or "assortment" in issue_text:
        assortment_patterns = (
            "Цвет: в ассортименте (уточняйте при заказе).",
            "Цвет: в ассортименте (уточняйте при заказе)",
            "Цвет: в ассортименте.",
            "в ассортименте (уточняйте при заказе)",
        )
        for target in [draft, *list(draft.attribute_values)]:
            field_name = "description" if target is draft else f"attribute.{target.attribute_id}"
            original = target.description if target is draft else target.value_text
            if not original:
                continue
            cleaned = original
            for phrase in assortment_patterns:
                cleaned = cleaned.replace(phrase, "")
            # Also cover the Russian wording returned by generated title/
            # annotation text, not just the exact sentence used by the first
            # auto-generated description.
            cleaned = re.sub(r"(?im)^.*(?:в ассортименте|по заказу|уточняйте при заказе|случайн(?:ый|ая|ые)|随机|混款|混色|按订单确认颜色|颜色随机).*$", "", cleaned)
            cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
            cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
            if cleaned != original:
                if target is draft:
                    target.description = cleaned
                else:
                    target.value_text = cleaned
                fixes.append({"field": field_name, "method": "remove_assortment_claim"})

        # Rich-content is persisted as a JSON attribute and is independently
        # submitted to Ozon. Clean every text node, otherwise the ordinary
        # description may be fixed while the same prohibited phrase remains in
        # the annotation payload.
        for value in draft.attribute_values:
            if value.attribute_id not in {"11254", "4191", "4180"} or not value.value_text:
                continue
            original = value.value_text
            cleaned = original
            try:
                parsed = json.loads(cleaned)
                def clean_rich(node):
                    if isinstance(node, dict):
                        for key, child in list(node.items()):
                            if isinstance(child, str):
                                child = re.sub(r"(?im)^.*(?:в ассортименте|по заказу|уточняйте при заказе|случайн(?:ый|ая|ые)|随机|混款|混色|按订单确认颜色|颜色随机).*$", "", child)
                                child = re.sub(r"[ \t]+\n", "\n", child)
                                node[key] = child.strip()
                            else:
                                clean_rich(child)
                    elif isinstance(node, list):
                        for child in node:
                            clean_rich(child)
                clean_rich(parsed)
                cleaned = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
            except (TypeError, ValueError):
                cleaned = re.sub(r"(?im)^.*(?:в ассортименте|по заказу|уточняйте при заказе|случайн(?:ый|ая|ые)|随机|混款|混色|按订单确认颜色|颜色随机).*$", "", cleaned).strip()
            if cleaned != original:
                value.value_text = cleaned
                fixes.append({"field": f"attribute.{value.attribute_id}", "method": "remove_assortment_claim"})

        title_cleaned = re.sub(r"(?im)^.*(?:в ассортименте|по заказу|уточняйте при заказе|случайн(?:ый|ая|ые)|随机|混款|混色|按订单确认颜色|颜色随机).*$", "", draft.title or "").strip()
        if title_cleaned != (draft.title or ""):
            draft.title = title_cleaned
            fixes.append({"field": "title", "method": "remove_assortment_claim"})

    # A literal zero in an optional measurement is not evidence of a real
    # product value. Ozon rejects it as below the minimum. Preserve required
    # fields for operator review, but omit optional placeholder zeroes.
    if "VALUE_MIN_LIMIT" in issue_codes:
        optional_attributes = {
            str(row.attribute_id): row
            for row in db.scalars(select(OzonGlobalAttributeCacheRecord).where(
                OzonGlobalAttributeCacheRecord.category_id == draft.category_id,
                OzonGlobalAttributeCacheRecord.type_id == draft.type_id,
            ))
            if not row.required
        }
        for value in list(draft.attribute_values):
            normalized = str(value.value_text or "").strip().replace(",", ".")
            fallback_measurement = any(token in (value.name or "") for token in ("容量", "体积", "功率", "мл", "кВт", "Мощность"))
            if value.attribute_id not in optional_attributes or (value.attribute_id not in issue_attribute_ids and not fallback_measurement):
                continue
            db.delete(value)
            fixes.append({
                "field": f"attribute.{value.attribute_id}",
                "attribute_name": value.name,
                "method": "remove_optional_zero_measurement",
            })

    # 2. Fix title repetition: re-translate with anti-repetition prompt
    title_words = draft.title.lower().split() if draft.title else []
    word_counts = {}
    for w in title_words:
        clean = w.strip(chr(44) + chr(46) + chr(33) + chr(63) + chr(45) + chr(58) + chr(59) + chr(40) + chr(41) + chr(34) + chr(39))
        if len(clean) > 2:
            word_counts[clean] = word_counts.get(clean, 0) + 1
    repeated = {w: c for w, c in word_counts.items() if c > 1}
    if repeated:
        try:
            # Get original Chinese title from source product
            sp = None
            if draft.source_product_id:
                sp = db.scalar(select(SourceProductRecord).where(SourceProductRecord.id == draft.source_product_id))
            source_title = sp.title if sp else draft.title
            ctx = "重新翻译商品标题，避免重复词汇。推荐格式：产品类型+核心特征+材质+用途。同一个俄语单词不要出现两次。"
            r = translate_text(source_title, target_lang="ru", context=ctx)
            candidate_title = str(r.get("translated") or "").strip()
            if _is_publishable_russian_text(candidate_title, minimum_cyrillic=4, single_line=True):
                old_title = draft.title
                draft.title = candidate_title[:255]
                fixes.append({"field": "title", "old": old_title, "new": candidate_title, "method": "ai_retranslate"})
            else:
                category = db.scalar(select(OzonGlobalCategoryCacheRecord).where(
                    OzonGlobalCategoryCacheRecord.category_id == draft.category_id,
                    OzonGlobalCategoryCacheRecord.type_id == draft.type_id,
                )) if draft.category_id and draft.type_id else None
                fallback = _safe_category_fallback(category.title if category else "")
                if fallback:
                    old_title = draft.title
                    draft.title = fallback[0]
                    fixes.append({"field": "title", "old": old_title, "new": fallback[0], "method": "ozon_category_safe_fallback"})
                else:
                    fixes.append({"field": "title", "error": "AI翻译结果不是可发布俄文，且没有Ozon俄文类目兜底，未写回"})
        except Exception as e:
            fixes.append({"field": "title", "error": str(e)})

    # 3. Fix color attributes missing dictionary_value_id
    if draft.category_id and draft.type_id:
        attr_cache = {}
        for ac in db.scalars(select(OzonGlobalAttributeCacheRecord).where(
            OzonGlobalAttributeCacheRecord.category_id == draft.category_id,
            OzonGlobalAttributeCacheRecord.type_id == draft.type_id,
        )):
            attr_cache[str(ac.attribute_id)] = ac

        for av in draft.attribute_values:
            attr_cached = attr_cache.get(av.attribute_id)
            if not attr_cached or not attr_cached.dictionary_id:
                continue
            if not av.value_id or str(av.value_id) in ("None", "none", "null", "0", ""):
                # Try to find the dictionary value by text
                if av.value_text:
                    try:
                        from .listing_metadata_service import search_category_attribute_values
                        vals = search_category_attribute_values(
                            db, shop_id, draft.category_id, draft.type_id, av.attribute_id, av.value_text, limit=5
                        )
                        if vals:
                            av.value_id = vals[0]["id"]
                            fixes.append({
                                "field": "attribute",
                                "attribute_id": av.attribute_id,
                                "attribute_name": av.name,
                                "old_value_id": None,
                                "new_value_id": vals[0]["id"],
                                "method": "dict_lookup",
                            })
                    except Exception:
                        pass

    # 4. Fix variant color values missing value_ids
    for variant in draft.variants:
        if not variant.variant_values_json:
            continue
        try:
            vv = json.loads(variant.variant_values_json)
            packed_ids = vv.pop("__ids__", {}) if isinstance(vv, dict) else {}
            for attr_name, attr_value in vv.items():
                if not packed_ids.get(attr_name):
                    cached = None
                    for ac in attr_cache.values():
                        if ac.name == attr_name and ac.dictionary_id:
                            cached = ac
                            break
                    if cached and attr_value:
                        from .listing_metadata_service import search_category_attribute_values
                        vals = search_category_attribute_values(
                            db, shop_id, draft.category_id, draft.type_id,
                            cached.attribute_id, attr_value, limit=5
                        )
                        if vals:
                            packed_ids[attr_name] = [vals[0]["id"]]
                            fixes.append({
                                "field": "variant_color",
                                "variant_sku": variant.seller_sku,
                                "attribute_name": attr_name,
                                "new_value_id": vals[0]["id"],
                                "method": "dict_lookup",
                            })
            if packed_ids:
                vv["__ids__"] = packed_ids
                variant.variant_values_json = json.dumps(vv, ensure_ascii=False)
        except Exception:
            pass

    db.commit()
    if fixes:
        # The old task remains immutable evidence in the audit stream. The
        # editable draft, however, is now awaiting a fresh submit and must not
        # keep rendering stale Ozon errors as if they belonged to the fix.
        draft.ozon_issues_json = None
        draft.stock_sync_status = "needs_resubmit"
        draft.stock_sync_message = "本地问题已修复，请保存并重新提交到 Ozon；旧 task 反馈已留档"
        db.commit()
    return {"ok": True, "fixes": fixes, "fix_count": len(fixes)}


# Source product detail (for listing editor
# ---------------------------------------------------------------------------

class SourcePackageUpdate(BaseModel):
    weight_g: float = Field(gt=0, le=1000000)
    length_mm: float = Field(gt=0, le=100000)
    width_mm: float = Field(gt=0, le=100000)
    height_mm: float = Field(gt=0, le=100000)


@app.put("/api/v1/shops/{shop_id}/pipeline/source-products/{sp_id}/package")
def update_source_product_package(shop_id:int,sp_id:int,payload:SourcePackageUpdate,db:Session=Depends(get_db))->dict:
    product=db.scalar(select(SourceProductRecord).join(SourceProductShopRecord,SourceProductShopRecord.source_product_id==SourceProductRecord.id).where(
        SourceProductRecord.id==sp_id,SourceProductShopRecord.shop_id==shop_id,SourceProductShopRecord.is_deleted.is_(False)))
    if not product: raise HTTPException(404,"采集商品不存在")
    package={"weightG":payload.weight_g,"lengthMm":payload.length_mm,"widthMm":payload.width_mm,"heightMm":payload.height_mm}
    raw=json.loads(product.raw_json or "{}") if product.raw_json else {}
    raw["packageInfo"]={**(raw.get("packageInfo") or {}),**package,"source":"manual_listing_editor"}
    product.raw_json=json.dumps(raw,ensure_ascii=False)
    variants=list(db.scalars(select(SourceVariantRecord).where(SourceVariantRecord.source_product_id==sp_id)))
    for variant in variants:
        variant_raw=json.loads(variant.raw_json or "{}") if variant.raw_json else {}
        variant_raw.update(package);variant_raw["packageSource"]="manual_listing_editor"
        variant.raw_json=json.dumps(variant_raw,ensure_ascii=False)
    linked_drafts = list(db.scalars(select(ListingDraftRecord).where(
        ListingDraftRecord.shop_id == shop_id,
        ListingDraftRecord.source_product_id == sp_id,
    )))
    updated_draft_ids = []
    auto_priced_variants = 0
    for draft in linked_drafts:
        before = {
            variant.seller_sku: {
                "weight_g": float(variant.weight_g) if variant.weight_g is not None else None,
                "length_mm": float(variant.length_mm) if variant.length_mm is not None else None,
                "width_mm": float(variant.width_mm) if variant.width_mm is not None else None,
                "height_mm": float(variant.height_mm) if variant.height_mm is not None else None,
            }
            for variant in draft.variants
        }
        for variant in draft.variants:
            variant.weight_g = payload.weight_g
            variant.length_mm = payload.length_mm
            variant.width_mm = payload.width_mm
            variant.height_mm = payload.height_mm
            # Package correction is the point at which the ERP has all quote
            # inputs. Recalculate the persisted automatic price immediately,
            # so a stale price from a prior dimension cannot survive.
            if variant.purchase_cost_cny is not None:
                calculation = PricingService().calculate(PriceInput(
                    purchase_cost=Decimal(variant.purchase_cost_cny),
                    weight_g=Decimal(str(payload.weight_g)),
                    length_mm=Decimal(str(payload.length_mm)),
                    width_mm=Decimal(str(payload.width_mm)),
                    height_mm=Decimal(str(payload.height_mm)),
                    policy=domain_policy(get_pricing_policy(db), shop_id),
                ))
                variant.calculated_price_cny = calculation.price
                variant.price_cny = calculation.price
                variant.old_price_cny = calculation.old_price
                variant.min_price_cny = calculation.min_price
                auto_priced_variants += 1
        updated_draft_ids.append(draft.id)
        db.add(AuditEventRecord(
            shop_id=shop_id, actor_id="erp-admin", action="listing_package_corrected",
            entity_type="listing_draft", entity_id=str(draft.id),
            details_json=json.dumps({"before": before, "after": package, "source_product_id": sp_id}, ensure_ascii=False),
        ))
    db.add(AuditEventRecord(shop_id=shop_id,actor_id="erp-admin",action="source_package_manually_updated",
        entity_type="source_product",entity_id=str(sp_id),details_json=json.dumps({**package,"variant_count":len(variants),"updated_draft_ids":updated_draft_ids},ensure_ascii=False)))
    db.commit()
    return {"ok":True,"packageInfo":package,"updated_variants":len(variants),"updated_draft_ids":updated_draft_ids,"auto_priced_variants":auto_priced_variants}


@app.post("/api/v1/shops/{shop_id}/pipeline/source-products/{sp_id}/refresh-official-detail")
def refresh_source_product_official_detail(shop_id: int, sp_id: int, db: Session = Depends(get_db)) -> dict:
    """Fill missing 1688 SKU prices/media from the official detail API.

    This is an explicit operator action from the editor. It only fills missing
    evidence and never replaces manually corrected price, package, image, or
    variant values.
    """
    product = db.scalar(select(SourceProductRecord).join(
        SourceProductShopRecord, SourceProductShopRecord.source_product_id == SourceProductRecord.id,
    ).where(SourceProductRecord.id == sp_id, SourceProductShopRecord.shop_id == shop_id, SourceProductShopRecord.is_deleted.is_(False)))
    if product is None:
        raise HTTPException(status_code=404, detail="采集商品不存在")
    offer_id = str(product.source_product_id or "").strip()
    try:
        details = get_product_details([offer_id])
    except Open1688Error as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not details:
        raise HTTPException(status_code=502, detail="1688 官方详情未返回商品")
    capture, _ = detail_to_capture(details[0])
    refreshed_prices = 0
    refreshed_video = False
    refreshed_media = 0
    # The original extension capture and the official 1688 detail response can
    # contain different gallery sets. Keep the operator's existing evidence
    # intact and append only new official URLs; never turn this refresh into a
    # five-image replacement operation.
    existing_image_urls = {
        str(url)
        for url in db.scalars(select(SourceMediaRecord.url).where(
            SourceMediaRecord.source_product_id == sp_id,
            SourceMediaRecord.media_type == "image",
        ))
        if url
    }
    next_image_sort_order = (db.scalar(select(func.max(SourceMediaRecord.sort_order)).where(
        SourceMediaRecord.source_product_id == sp_id,
        SourceMediaRecord.media_type == "image",
    )) or -1) + 1
    # Main gallery and long-form detail images are separate evidence streams
    # on 1688.  Merge both into the source snapshot, preserving ordering and
    # never replacing operator-selected public images.
    official_media_urls = list(capture.get("images") or []) + list(capture.get("detailImages") or [])
    for image_url in official_media_urls:
        image_url = str(image_url or "").strip()
        if not image_url or image_url in existing_image_urls:
            continue
        db.add(SourceMediaRecord(
            source_product_id=sp_id,
            media_type="image",
            url=image_url,
            sort_order=next_image_sort_order,
            is_primary=False,
        ))
        existing_image_urls.add(image_url)
        next_image_sort_order += 1
        refreshed_media += 1
    source_variants = list(db.scalars(select(SourceVariantRecord).where(SourceVariantRecord.source_product_id == sp_id)))
    official_by_sku = {
        str(v.get("source_sku") or v.get("skuId")): v
        for v in capture.get("skuVariants", [])
        if v.get("source_sku") or v.get("skuId")
    }
    for variant in source_variants:
        official = official_by_sku.get(str(variant.source_sku))
        if not official:
            continue
        official_price = official.get("price_cny") if official.get("price_cny") is not None else official.get("price")
        if variant.price_cny is None and official_price is not None:
            variant.price_cny = official_price
            refreshed_prices += 1
        official_image = str(official.get("image_url") or official.get("image") or "").strip()
        if official_image.lower() in {"none", "null", "undefined"}:
            official_image = ""
        if str(variant.image_url or "").strip().lower() in {"none", "null", "undefined"}:
            variant.image_url = None
        if (not variant.image_url) and official_image.startswith(("http://", "https://")):
            variant.image_url = official_image
        raw = json.loads(variant.raw_json or "{}") if variant.raw_json else {}
        for key in ("weightG", "lengthMm", "widthMm", "heightMm"):
            if not raw.get(key) and official.get(key):
                raw[key] = official[key]
        variant.raw_json = json.dumps(raw, ensure_ascii=False)

    video = capture.get("video") if isinstance(capture.get("video"), dict) else None
    if video and video.get("url"):
        video["url"] = _media_proxy_url(video["url"])
        existing_video = db.scalar(select(SourceMediaRecord).where(
            SourceMediaRecord.source_product_id == sp_id,
            SourceMediaRecord.media_type == "video",
        ))
        if existing_video is None:
            db.add(SourceMediaRecord(source_product_id=sp_id, media_type="video", url=video["url"], sort_order=999, is_primary=False))
            refreshed_video = True
        elif not existing_video.url:
            existing_video.url = video["url"]
            refreshed_video = True
        if not product.raw_json:
            raw_product = {}
        else:
            raw_product = json.loads(product.raw_json)
        raw_product["video"] = video
        product.raw_json = json.dumps(raw_product, ensure_ascii=False)

    for draft in db.scalars(select(ListingDraftRecord).where(
        ListingDraftRecord.shop_id == shop_id,
        ListingDraftRecord.source_product_id == sp_id,
    )):
        for draft_variant in draft.variants:
            official = official_by_sku.get(str(draft_variant.seller_sku).split("-")[-1])
            official_price = official.get("price_cny") if official and official.get("price_cny") is not None else (official.get("price") if official else None)
            if official and draft_variant.purchase_cost_cny is None and official_price is not None:
                draft_variant.purchase_cost_cny = official_price
                refreshed_prices += 1
            needs_requote = bool(
                official
                and official_price is not None
                and draft_variant.purchase_cost_cny is not None
                and abs(Decimal(str(draft_variant.purchase_cost_cny)) - Decimal(str(official_price))) < Decimal("0.01")
            )
            if official and (draft_variant.price_cny is None or needs_requote) and draft_variant.purchase_cost_cny is not None and all(
                value is not None for value in (draft_variant.weight_g, draft_variant.length_mm, draft_variant.width_mm, draft_variant.height_mm)
            ):
                # Use the same quote path as a newly imported SKU. The
                # persisted purchase cost includes the global purchase buffer;
                # never price a refreshed SKU from the raw supplier price.
                source_price = Decimal(str(official_price))
                quote = quote_source_price(
                    db,
                    shop_id=shop_id,
                    source_price_cny=source_price,
                    weight_g=Decimal(str(draft_variant.weight_g)),
                    length_mm=Decimal(str(draft_variant.length_mm)),
                    width_mm=Decimal(str(draft_variant.width_mm)),
                    height_mm=Decimal(str(draft_variant.height_mm)),
                )
                draft_variant.purchase_cost_cny = quote["purchase_cost_cny"]
                draft_variant.calculated_price_cny = quote["price_cny"]
                draft_variant.price_cny = quote["price_cny"]
                draft_variant.old_price_cny = quote["old_price_cny"]
                draft_variant.min_price_cny = quote["min_price_cny"]
        if refreshed_video and not draft.video_url:
            draft.video_url = video["url"]

    db.commit()
    return {
        "ok": True,
        "offer_id": offer_id,
        "official_image_count": len(official_media_urls),
        "refreshed_prices": refreshed_prices,
        "refreshed_media": refreshed_media,
        "refreshed_video": refreshed_video,
        "official_variant_count": len(official_by_sku),
        "message": (
            f"已从1688官方详情补回 {refreshed_prices} 个价格"
            + (f"，新增 {refreshed_media} 张图片" if refreshed_media else "")
            + ("，并补回视频" if refreshed_video else "")
        ),
    }


@app.post("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}/refresh-source-materials")
def refresh_listing_draft_source_materials(shop_id: int, draft_id: int, db: Session = Depends(get_db)) -> dict:
    """Apply the latest deduplicated 1688 snapshot to an existing draft.

    This is an explicit operator action. It merges new gallery media and
    refreshes matching SKU images; it never creates another draft or Ozon card.
    """
    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.id == draft_id, ListingDraftRecord.shop_id == shop_id,
    ))
    if draft is None:
        raise HTTPException(status_code=404, detail="上架草稿不存在")
    if not draft.source_product_id:
        raise HTTPException(status_code=422, detail="草稿没有关联1688货源")
    source = db.scalar(select(SourceProductRecord).where(SourceProductRecord.id == draft.source_product_id))
    if source is None:
        raise HTTPException(status_code=404, detail="关联货源不存在")

    media_rows = list(db.scalars(select(SourceMediaRecord).where(
        SourceMediaRecord.source_product_id == source.id,
    ).order_by(SourceMediaRecord.sort_order, SourceMediaRecord.id)))
    sku_urls = {str(row.image_url).strip() for row in db.scalars(select(SourceVariantRecord).where(
        SourceVariantRecord.source_product_id == source.id,
    )) if row.image_url and str(row.image_url).strip()}
    # Remove only SKU URLs from the public gallery slot. The source variant
    # rows and draft variant.image_url remain untouched and continue to be
    # submitted as each SKU's own first image.
    current_images = [url for url in list(draft.images or []) if str(url).strip() not in sku_urls]
    image_urls = [str(row.url).strip() for row in media_rows if row.media_type == "image" and str(row.url).strip() not in sku_urls and str(row.url or "").startswith(("http://", "https://"))]
    merged_images = list(dict.fromkeys(current_images + image_urls))
    draft.images_json = json.dumps(merged_images, ensure_ascii=False)
    if not draft.primary_image_url and merged_images:
        draft.primary_image_url = merged_images[0]

    source_variants = list(db.scalars(select(SourceVariantRecord).where(SourceVariantRecord.source_product_id == source.id)))
    by_sku = {str(row.source_sku).strip(): row for row in source_variants if row.source_sku}
    updated_sku_images = 0
    draft_offer_prefix = f"{normalize_offer_id(draft.offer_id)}-"
    for variant in draft.variants:
        seller_sku = normalize_offer_id(variant.seller_sku)
        # Draft variants are generated as <draft offer>-<source SKU>. Strip only
        # that known prefix: source SKU values may themselves contain hyphens.
        source_sku = seller_sku.removeprefix(draft_offer_prefix)
        matched = by_sku.get(source_sku)
        matched_image = str(matched.image_url or "").strip() if matched else ""
        if matched_image.lower() in {"none", "null", "undefined"}:
            matched_image = ""
        current_image = str(variant.image_url or "").strip()
        if current_image.lower() in {"none", "null", "undefined"}:
            variant.image_url = None
            current_image = ""
            updated_sku_images += 1
        if matched_image.startswith(("http://", "https://")) and current_image != matched_image:
            variant.image_url = matched_image
            updated_sku_images += 1
    video = next((row.url for row in media_rows if row.media_type == "video" and row.url), None)
    video_filled = False
    if video and not draft.video_url:
        draft.video_url = video
        video_filled = True
    db.add(AuditEventRecord(
        shop_id=shop_id, actor_id="operator", action="listing_source_materials_applied",
        entity_type="listing_draft", entity_id=str(draft.id),
        details_json=json.dumps({
            "source_product_id": source.id, "added_images": max(0, len(merged_images) - len(current_images)),
            "updated_sku_images": updated_sku_images, "video_filled": video_filled,
            "ozon_write": False,
        }, ensure_ascii=False),
    ))
    db.commit()
    return {
        "ok": True, "draft_id": draft.id, "source_product_id": source.id,
        "image_count": len(merged_images),
        "added_images": max(0, len(merged_images) - len(current_images)),
        "updated_sku_images": updated_sku_images, "video_filled": video_filled,
        "message": f"已将货源最新素材回填草稿：新增 {max(0, len(merged_images) - len(current_images))} 张图片，更新 {updated_sku_images} 个 SKU 图；尚未提交 Ozon。",
    }

@app.post("/api/v1/shops/{shop_id}/pipeline/source-products/{sp_id}/ensure-draft")
def ensure_source_product_draft(shop_id: int, sp_id: int, db: Session = Depends(get_db)) -> dict:
    """Create the minimal editable draft needed by quick-review image actions."""
    product = db.scalar(select(SourceProductRecord).join(
        SourceProductShopRecord, SourceProductShopRecord.source_product_id == SourceProductRecord.id,
    ).where(SourceProductRecord.id == sp_id, SourceProductShopRecord.shop_id == shop_id, SourceProductShopRecord.is_deleted.is_(False)))
    if product is None:
        raise HTTPException(status_code=404, detail="采集商品不存在")
    existing = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.shop_id == shop_id,
        ListingDraftRecord.source_product_id == sp_id,
    ))
    if existing is not None:
        try:
            match_resp = ai_match_category(
                shop_id=shop_id,
                payload=MatchCategoryRequest(title=product.title or existing.title or "", source_product_id=sp_id),
                db=db,
            )
        except Exception:
            match_resp = {"candidates": [], "keywords": []}
        current_category = None
        if existing.category_id and existing.type_id:
            cat_row = db.scalar(select(OzonGlobalCategoryCacheRecord).where(
                        OzonGlobalCategoryCacheRecord.category_id == existing.category_id,
                OzonGlobalCategoryCacheRecord.type_id == existing.type_id,
            ).limit(1))
            current_category = {
                "category_id": existing.category_id,
                "type_id": existing.type_id,
                "title_zh": cat_row.title_zh if cat_row else "",
                "title": cat_row.title if cat_row else "",
            }
        variants = []
        for v in existing.variants:
            variants.append({
                "id": v.id,
                "seller_sku": v.seller_sku,
                "purchase_cost_cny": float(v.purchase_cost_cny) if v.purchase_cost_cny is not None else None,
                "price_cny": float(v.price_cny) if v.price_cny is not None else None,
                "old_price_cny": float(v.old_price_cny) if v.old_price_cny is not None else None,
                "min_price_cny": float(v.min_price_cny) if v.min_price_cny is not None else None,
                "weight_g": float(v.weight_g) if v.weight_g is not None else None,
                "length_mm": float(v.length_mm) if v.length_mm is not None else None,
                "width_mm": float(v.width_mm) if v.width_mm is not None else None,
                "height_mm": float(v.height_mm) if v.height_mm is not None else None,
                "stock": v.stock,
                "image_url": v.image_url,
                "variant_values": v.variant_values_json or "",
            })
        return {
            "draft_id": existing.id, "created": False,
            "images": existing.images or [],
            "variants": variants,
            "current_category": current_category,
            "category_candidates": match_resp.get("candidates", [])[:5],
        }

    variants = list(db.scalars(select(SourceVariantRecord).where(
        SourceVariantRecord.source_product_id == sp_id,
    ).order_by(SourceVariantRecord.id)))
    media = list(db.scalars(select(SourceMediaRecord).where(
        SourceMediaRecord.source_product_id == sp_id,
        SourceMediaRecord.media_type == "image",
    ).order_by(SourceMediaRecord.sort_order, SourceMediaRecord.id)))
    source_video = db.scalar(select(SourceMediaRecord).where(
        SourceMediaRecord.source_product_id == sp_id,
        SourceMediaRecord.media_type == "video",
    ).order_by(SourceMediaRecord.sort_order, SourceMediaRecord.id))
    sku_urls = {str(v.image_url).strip() for v in variants if v.image_url and str(v.image_url).strip()}
    images = [m.url for m in media if m.url and str(m.url).strip() not in sku_urls and str(m.url).startswith(("http://", "https://"))]
    if not images and product.main_image_url and str(product.main_image_url).startswith(("http://", "https://")):
        images = [product.main_image_url]
    offer_id = normalize_offer_id(f"SRC{sp_id}")
    draft = ListingDraftRecord(
        shop_id=shop_id,
        offer_id=offer_id,
        title=product.title or f"采集商品 {sp_id}",
        description=None,
        primary_image_url=images[0] if images else None,
        video_url=source_video.url if source_video else None,
        images_json=json.dumps(images, ensure_ascii=False),
        source_product_id=sp_id,
        status="draft",
    )
    for index, variant in enumerate(variants):
        raw = json.loads(variant.raw_json or "{}") if variant.raw_json else {}
        def dimension(name: str):
            value = raw.get(name)
            try:
                return Decimal(str(value)) if value not in (None, "") else None
            except (TypeError, ValueError):
                return None
        seller_sku = normalize_offer_id(f"{offer_id}-{variant.source_sku or index + 1}")
        draft.variants.append(ListingVariantRecord(
            seller_sku=seller_sku,
            purchase_cost_cny=variant.price_cny,
            weight_g=dimension("weightG"),
            length_mm=dimension("lengthMm"),
            width_mm=dimension("widthMm"),
            height_mm=dimension("heightMm"),
            stock=variant.stock,
            image_url=variant.image_url,
            variant_values_json=variant.spec_name,
        ))
    db.add(draft)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(ListingDraftRecord).where(ListingDraftRecord.shop_id == shop_id, ListingDraftRecord.source_product_id == sp_id))
        if existing is None:
            raise HTTPException(status_code=409, detail="快速审核草稿创建冲突，请重试")
        return {"draft_id": existing.id, "created": False, "images": existing.images or []}
    db.refresh(draft)
    try:
        match_resp = ai_match_category(
            shop_id=shop_id,
            payload=MatchCategoryRequest(title=product.title or draft.title or "", source_product_id=sp_id),
            db=db,
        )
    except Exception:
        match_resp = {"candidates": [], "keywords": []}
    new_variants = []
    for v in draft.variants:
        new_variants.append({
            "id": v.id,
            "seller_sku": v.seller_sku,
            "purchase_cost_cny": float(v.purchase_cost_cny) if v.purchase_cost_cny is not None else None,
            "price_cny": float(v.price_cny) if v.price_cny is not None else None,
            "old_price_cny": float(v.old_price_cny) if v.old_price_cny is not None else None,
            "min_price_cny": float(v.min_price_cny) if v.min_price_cny is not None else None,
            "weight_g": float(v.weight_g) if v.weight_g is not None else None,
            "length_mm": float(v.length_mm) if v.length_mm is not None else None,
            "width_mm": float(v.width_mm) if v.width_mm is not None else None,
            "height_mm": float(v.height_mm) if v.height_mm is not None else None,
            "stock": v.stock,
            "image_url": v.image_url,
            "image_urls": v.image_urls,
            "variant_values": v.variant_values_json or "",
        })
    return {
        "draft_id": draft.id, "created": True, "images": images,
        "variants": new_variants,
        "current_category": None,
        "category_candidates": match_resp.get("candidates", [])[:5],
    }


class QuickCategoryApplyRequest(BaseModel):
    category_id: str = Field(min_length=1, max_length=64)
    type_id: str = Field(min_length=1, max_length=64)
    title_zh: str = Field(default="", max_length=200)


@app.post("/api/v1/shops/{shop_id}/pipeline/source-products/{sp_id}/apply-category")
def quick_apply_category(shop_id: int, sp_id: int, payload: QuickCategoryApplyRequest, db: Session = Depends(get_db)) -> dict:
    """Apply a matched category candidate to the draft (create minimal draft if missing)."""
    product = db.scalar(select(SourceProductRecord).join(
        SourceProductShopRecord, SourceProductShopRecord.source_product_id == SourceProductRecord.id,
    ).where(SourceProductRecord.id == sp_id, SourceProductShopRecord.shop_id == shop_id, SourceProductShopRecord.is_deleted.is_(False)))
    if product is None:
        raise HTTPException(status_code=404, detail="采集商品不存在")
    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.shop_id == shop_id,
        ListingDraftRecord.source_product_id == sp_id,
    ))
    created = False
    if draft is None:
        ensure_result = ensure_source_product_draft(shop_id=shop_id, sp_id=sp_id, db=db)
        draft = db.get(ListingDraftRecord, ensure_result["draft_id"])
        created = True
        if draft is None:
            raise HTTPException(status_code=500, detail="草稿创建失败")
    draft.category_id = payload.category_id
    draft.type_id = payload.type_id
    db.commit()
    db.refresh(draft)
    return {
        "draft_id": draft.id,
        "created": created,
        "category_id": draft.category_id,
        "type_id": draft.type_id,
        "title_zh": payload.title_zh,
    }
@app.get("/api/v1/shops/{shop_id}/pipeline/source-products/{sp_id}")
def get_source_product_detail(shop_id: int, sp_id: int, db: Session = Depends(get_db)) -> dict:
    product = db.scalar(select(SourceProductRecord).join(
        SourceProductShopRecord, SourceProductShopRecord.source_product_id == SourceProductRecord.id,
    ).where(SourceProductRecord.id == sp_id, SourceProductShopRecord.shop_id == shop_id, SourceProductShopRecord.is_deleted.is_(False)))
    # Bulk listing may assign a source to a target shop after the original
    # collection link was created under another shop. A draft's explicit
    # source_product_id is still an authorized, exact association for the
    # current editor and must populate the evidence panel.
    if product is None:
        product = db.scalar(select(SourceProductRecord).join(
            ListingDraftRecord, ListingDraftRecord.source_product_id == SourceProductRecord.id,
        ).where(
            SourceProductRecord.id == sp_id,
            ListingDraftRecord.shop_id == shop_id,
            ListingDraftRecord.source_product_id == sp_id,
        ))
    if product is None:
        raise HTTPException(status_code=404, detail="采集商品不存在")
    variants = list(db.scalars(select(SourceVariantRecord).where(
        SourceVariantRecord.source_product_id == sp_id,
    ).order_by(SourceVariantRecord.id)))
    media = list(db.scalars(select(SourceMediaRecord).where(
        SourceMediaRecord.source_product_id == sp_id,
    ).order_by(SourceMediaRecord.sort_order, SourceMediaRecord.id)))
    return {
        "id": product.id,
        "source_platform": product.source_platform,
        "source_product_id": product.source_product_id,
        "source_url": product.source_url,
        "title": product.title,
        "main_image_url": product.main_image_url,
        "category_hint": product.category_hint,
        "brand": product.brand,
        "material": product.material,
        "raw_json": product.raw_json,
        "packageInfo": (lambda r: r.get("packageInfo", {}))(json.loads(product.raw_json) if product.raw_json else {}),
        "variants": [
            {
                "id": v.id,
                "source_sku": v.source_sku,
                "spec_name": v.spec_name,
                "price_cny": float(v.price_cny) if v.price_cny else None,
                "stock": v.stock,
                "image_url": v.image_url or (lambda r: r.get("skuImageUrl") or r.get("sku_image_url") or r.get("image") or None)(json.loads(v.raw_json) if v.raw_json else {}),
                **(lambda r: {
                    "weightG": r.get("weightG", ""),
                    "lengthMm": r.get("lengthMm", ""),
                    "widthMm": r.get("widthMm", ""),
                    "heightMm": r.get("heightMm", ""),
                })(json.loads(v.raw_json) if v.raw_json else {}),
            }
            for v in variants
        ],
        "media": [
            {
                "id": m.id,
                "media_type": m.media_type,
                "url": m.url,
                "sort_order": m.sort_order,
                "is_primary": m.is_primary,
            }
            for m in media
        ],
    }


# ---------------------------------------------------------------------------
# Listing draft single get + update
# ---------------------------------------------------------------------------

@app.get("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}", response_model=ListingDraftRead)
def get_listing_draft(shop_id: int, draft_id: int, db: Session = Depends(get_db)):
    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.id == draft_id,
        ListingDraftRecord.shop_id == shop_id,
    ))
    if draft is None:
        raise HTTPException(status_code=404, detail="上架草稿不存在")
    # Historic batch drafts may have been created while SKU images were still
    # mixed into the public gallery. Repair that local, deterministic boundary
    # automatically on open: do not touch any variant image, only preserve
    # valid existing public images and fill the collected public detail images.
    # This is intentionally local-only and never performs an Ozon write.
    if draft.source_product_id:
        source = db.get(SourceProductRecord, draft.source_product_id)
        if source is not None:
            previous_images = list(draft.images or [])
            repaired_images = source_public_gallery(db, source, previous_images)
            if repaired_images != previous_images:
                draft.images_json = json.dumps(repaired_images, ensure_ascii=False)
                draft.primary_image_url = repaired_images[0] if repaired_images else None
                db.add(AuditEventRecord(
                    shop_id=shop_id,
                    actor_id="system",
                    action="listing_public_gallery_auto_repaired",
                    entity_type="listing_draft",
                    entity_id=str(draft.id),
                    details_json=json.dumps({
                        "source_product_id": source.id,
                        "previous_public_image_count": len(previous_images),
                        "public_image_count": len(repaired_images),
                        "ozon_write": False,
                    }, ensure_ascii=False),
                ))
                db.commit()
                db.refresh(draft)
    # Parse ozon_issues_json for frontend
    draft_dict = {
        "id": draft.id, "shop_id": draft.shop_id, "offer_id": draft.offer_id,
        "title": draft.title, "description": draft.description,
        "category_id": draft.category_id, "type_id": draft.type_id,
        "primary_image_url": draft.primary_image_url,
        "video_url": draft.video_url,
        "images": json.loads(draft.images_json) if draft.images_json else [],
        "watermark_config": json.loads(draft.watermark_config_json) if draft.watermark_config_json else None,
        "source_product_id": draft.source_product_id, "status": draft.status,
        "learning_attribute_ids": draft.learning_attribute_ids,
        "validation_json": draft.validation_json,
        "created_at": draft.created_at, "updated_at": draft.updated_at,
        "variants": [{"id": v.id, "draft_id": v.draft_id, "seller_sku": v.seller_sku,
            "purchase_cost_cny": float(v.purchase_cost_cny) if v.purchase_cost_cny else None,
            "weight_g": float(v.weight_g) if v.weight_g else None,
            "length_mm": float(v.length_mm) if v.length_mm else None,
            "width_mm": float(v.width_mm) if v.width_mm else None,
            "height_mm": float(v.height_mm) if v.height_mm else None,
            "barcode": v.barcode, "stock": v.stock, "name_ru": v.name_ru,
            "image_url": v.image_url,
            "image_urls": v.image_urls,
            "price_cny": float(v.price_cny) if v.price_cny else None,
            "old_price_cny": float(v.old_price_cny) if v.old_price_cny else None,
            "min_price_cny": v.min_price_cny,
            "calculated_price_cny": float(v.calculated_price_cny) if v.calculated_price_cny else None,
            "variant_values_json": v.variant_values_json,
        } for v in draft.variants],
        "attribute_values": [{"id": av.id, "draft_id": av.draft_id,
            "attribute_id": av.attribute_id, "name": av.name,
            "value_id": av.value_id, "value_text": av.value_text,
        } for av in draft.attribute_values],
        "quality_rating": draft.quality_rating,
        "moderation_status": draft.moderation_status,
        "ozon_issues": json.loads(draft.ozon_issues_json) if draft.ozon_issues_json else [],
        "import_task_id": draft.import_task_id,
        "stock_sync_status": draft.stock_sync_status,
        "stock_sync_message": draft.stock_sync_message,
        "stock_sync_attempts": int(draft.stock_sync_attempts or 0),
        "stock_sync_next_at": draft.stock_sync_next_at,
        "stock_synced_at": draft.stock_synced_at,
    }
    return draft_dict


class ListingDraftUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10000)
    category_id: str | None = Field(default=None, max_length=64)
    type_id: str | None = Field(default=None, max_length=64)
    primary_image_url: str | None = Field(default=None, max_length=2000)
    video_url: str | None = Field(default=None, max_length=2000)
    images: list[str] | None = Field(default=None, max_length=100)
    watermark_config: dict | None = Field(default=None)
    learn_attribute_ids: list[str] | None = Field(default=None, max_length=200)
    attributes: list[ListingAttributeValueCreate] | None = Field(default=None)
    variants: list[ListingVariantCreate] | None = Field(default=None)

ListingDraftUpdate.model_rebuild()


class ListingDraftImageTranslateRequest(BaseModel):
    """Images selected in quick review for Xiangji translation."""

    image_urls: list[str] = Field(min_length=1, max_length=20)
    target_lang: str = Field(default="ru", max_length=16)
    source_lang: str = Field(default="CHS", max_length=16)


@app.post("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}/translate-images")
def translate_listing_draft_images(
    shop_id: int,
    draft_id: int,
    payload: ListingDraftImageTranslateRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Translate quick-review images and persist successful replacements.

    The quick-review UI historically called this draft-scoped endpoint, while
    the provider implementation lived at /api/v1/image/translate. Keep the
    draft route as a thin adapter so the two entry points share one provider
    implementation and preserve partial successes.
    """
    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.id == draft_id,
        ListingDraftRecord.shop_id == shop_id,
    ))
    if draft is None:
        raise HTTPException(status_code=404, detail="上架草稿不存在")

    target_lang = (payload.target_lang or "ru").strip().upper()
    source_lang = (payload.source_lang or "CHS").strip().upper()
    # Xiangji's documented enum uses RUS, not the frontend shorthand RU.
    if target_lang == "RU":
        target_lang = "RUS"
    if source_lang in {"ZH", "CN", "ZH-CN"}:
        source_lang = "CHS"

    provider = translate_images(ImageTranslateRequest(
        urls=payload.image_urls,
        source_lang=source_lang,
        target_lang=target_lang,
    ))
    images = list(draft.images or [])
    results = []
    for item in provider.get("results", []):
        original_url = item.get("source_url")
        translated_url = item.get("translated_url")
        if translated_url and original_url in images:
            images[images.index(original_url)] = translated_url
        results.append({
            "index": item.get("index"),
            "original_url": original_url,
            "translated_url": translated_url,
            "error": item.get("error"),
            "request_id": item.get("request_id"),
        })

    successful = [item for item in results if item.get("translated_url")]
    if successful:
        draft.images_json = json.dumps(images, ensure_ascii=False)
        if draft.primary_image_url in {item.get("original_url") for item in successful}:
            draft.primary_image_url = next(
                item["translated_url"] for item in successful
                if item.get("original_url") == draft.primary_image_url
            )
        db.add(AuditEventRecord(
            shop_id=shop_id,
            actor_id="erp-admin",
            action="listing_images_translated",
            entity_type="listing_draft",
            entity_id=str(draft_id),
            details_json=json.dumps({
                "source_urls": [item.get("original_url") for item in successful],
                "translated_urls": [item.get("translated_url") for item in successful],
                "failed": [item for item in results if item.get("error")],
            }, ensure_ascii=False),
        ))
        db.commit()

    return {
        "ok": bool(successful),
        "draft_id": draft_id,
        "images": images,
        "results": results,
        "translated": [item["translated_url"] for item in successful],
        "errors": [item for item in results if item.get("error")],
    }


@app.put("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}", response_model=ListingDraftRead)
def update_listing_draft(shop_id: int, draft_id: int, payload: ListingDraftUpdate, db: Session = Depends(get_db)):
    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.id == draft_id,
        ListingDraftRecord.shop_id == shop_id,
    ))
    if draft is None:
        raise HTTPException(status_code=404, detail="上架草稿不存在")
    if payload.title is not None:
        draft.title = payload.title
    if payload.description is not None:
        draft.description = payload.description
    if payload.category_id is not None:
        draft.category_id = payload.category_id
    if payload.type_id is not None:
        draft.type_id = payload.type_id
    if payload.primary_image_url is not None:
        draft.primary_image_url = payload.primary_image_url
    # An explicit JSON null means the operator removed the video.  Pydantic
    # distinguishes it from an omitted field through model_fields_set; do not
    # silently keep a deleted source video on later draft reloads.
    if "video_url" in payload.model_fields_set:
        draft.video_url = payload.video_url
    if payload.images is not None:
        draft.images_json = json.dumps(payload.images, ensure_ascii=False)
    if payload.watermark_config is not None:
        draft.watermark_config_json = json.dumps(payload.watermark_config, ensure_ascii=False)
    if payload.learn_attribute_ids is not None:
        draft.learning_attribute_ids_json = json.dumps(payload.learn_attribute_ids, ensure_ascii=False)
    if payload.attributes is not None:
        if not draft.category_id or not draft.type_id:
            raise HTTPException(status_code=422, detail="请先选择 Ozon 类目和商品类型")
        normalized_attributes = _normalize_listing_attributes(
            db, shop_id, draft.category_id, draft.type_id, payload.attributes,
        )
        db.query(ListingAttributeValueRecord).where(ListingAttributeValueRecord.draft_id == draft_id).delete()
        for attr in normalized_attributes:
            draft.attribute_values.append(ListingAttributeValueRecord(**attr))
    if payload.variants is not None:
        db.query(ListingVariantRecord).where(ListingVariantRecord.draft_id == draft_id).delete()
        try:
            normalized_skus = normalize_offer_ids([var.seller_sku for var in payload.variants])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        for var, normalized_sku in zip(payload.variants, normalized_skus):
            values = var.model_dump(exclude={"image_urls"})
            values["seller_sku"] = normalized_sku
            if var.image_urls is not None:
                values["image_urls_json"] = json.dumps(var.image_urls, ensure_ascii=False)
                values["image_url"] = var.image_urls[0] if var.image_urls else None
            draft.variants.append(ListingVariantRecord(**values))
    db.commit()
    db.refresh(draft)
    return draft









