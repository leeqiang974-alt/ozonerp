from __future__ import annotations

import json
import re
import threading
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from .database import SessionLocal, get_db
from .erp_models import AutomationApprovalBatchRecord, AutomationCandidateRecord, AutomationEventRecord, AutomationRunRecord, AutomationTaskRecord, AuditEventRecord, BulkListingBatchItemRecord, BulkListingBatchRecord, BulkListingTemplateRecord, ListingDraftRecord, OzonGlobalAttributeCacheRecord, OzonGlobalDictValueRecord, PipelineProductRecord, SourceProductRecord, SourceVariantRecord, YunNewtonSupplementJobRecord
from .models import Shop
from .automation_service import execute_task, process_candidate_ai
from .pipeline.category_matching import lock_category
from .pipeline.attribute_mapping import map_attributes
from .pipeline.variant_mapping import map_variants
from .pipeline.content_generation import generate_content, _compute_pricing
from .pricing import DimensionSource
from .pricing_policy_service import get_pricing_policy
from .pipeline.quality_check import run_quality_check
from .pipeline.publish_service import create_listing_draft_from_pipeline
from .pipeline.extension_bridge import ingest_capture
from .pipeline.publish_service import submit_to_ozon
from .pipeline.publish_service import build_import_payload
from .pipeline.local_ocr import filter_bulk_images, inspect_image
from .listing_stock_monitor import monitor_due_listing_stocks
from .integrations.ozon_seller import OzonSellerClient, OzonSellerError
from .offer_id_service import normalize_offer_id
from .sync_service import SyncConfigurationError, _credentials
from .listing_cache_service import promote_legacy_listing_caches

router = APIRouter(prefix="/api/v1/automation", tags=["automation"])

_bulk_start_locks: dict[int, threading.Lock] = {}
_bulk_start_locks_guard = threading.Lock()
_BULK_PAUSED_STATUSES = frozenset({"paused", "paused_quality_audit"})

_CJK_CONTENT_RE = re.compile(r"[\u3400-\u9fff]")
_CYRILLIC_RE = re.compile(r"[А-Яа-яЁё]")
_PROMPT_LEAK_RE = re.compile(
    r"(?:我们需要|首先理解|规则[：:]|原(?:始)?标题|只返回|翻译成俄语|"
    r"let'?s\s+(?:analyze|translate)|as an ai)",
    re.IGNORECASE,
)


def _has_publishable_generated_content(pipeline: PipelineProductRecord) -> bool:
    """Reject old LLM reasoning/prompt leakage before an Ozon import.

    A previous provider occasionally persisted its Chinese chain-of-thought as
    the product title.  Treat such text as missing content so the normal,
    current generator rebuilds it; never reuse it merely to make a retry fast.
    """
    title = str(pipeline.generated_title_ru or "").strip()
    description = str(pipeline.generated_description_ru or "").strip()
    combined = f"{title}\n{description}"
    if not title or not description or len(title) > 255 or len(description) > 3000:
        return False
    if "\n" in title or any(marker in title for marker in ("```", "**", "\n-", "=")):
        return False
    if _CJK_CONTENT_RE.search(combined) or _PROMPT_LEAK_RE.search(combined):
        return False
    title_cyrillic = len(_CYRILLIC_RE.findall(title))
    title_letters = len(re.findall(r"[A-Za-zА-Яа-яЁё]", title))
    return (
        title_cyrillic >= 4
        and title_cyrillic / max(1, title_letters) >= 0.55
        and len(_CYRILLIC_RE.findall(description)) >= 8
    )


def _bulk_start_lock(batch_id: int) -> threading.Lock:
    with _bulk_start_locks_guard:
        return _bulk_start_locks.setdefault(batch_id, threading.Lock())


def _bulk_batch_is_paused(batch: BulkListingBatchRecord | None) -> bool:
    """Return whether a batch safety pause blocks new local/external work.

    A pause is deliberately represented by the persisted batch status rather
    than by a worker-local flag.  Every retry/resume entry point must consult
    this same predicate so a browser action cannot accidentally restart a
    paused worker.  Resolving an OCR issue may still edit the local evidence,
    but it must not transition the batch to ``running`` or enqueue a worker.
    """
    return batch is not None and batch.status in _BULK_PAUSED_STATUSES


def _next_schedule_at(schedule_time: str, now: datetime | None = None) -> datetime:
    now = now or datetime.now(ZoneInfo("Asia/Shanghai"))
    hour, minute = map(int, schedule_time.split(":"))
    next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if next_run <= now:
        next_run += timedelta(days=1)
    return next_run


class TaskWrite(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    # Empty means unattended exploration; the service supplies its bounded
    # system rotation pool because the official API has no random catalogue
    # enumeration endpoint.
    keywords: list[str] = Field(default_factory=list, max_length=20)
    excluded_keywords: list[str] = Field(default_factory=list, max_length=30)
    min_price: float | None = Field(default=None, ge=0)
    max_price: float | None = Field(default=None, ge=0)
    min_sales_90d: int = Field(default=0, ge=0)
    min_stock: int = Field(default=1, ge=0)
    require_complete_package: bool = True
    require_48h_shipping: bool = False
    daily_target: int = Field(default=100, ge=1, le=2000)
    schedule_time: str = Field(default="09:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    shop_ids: list[int] = Field(default_factory=list, max_length=100)


class RunWrite(BaseModel):
    shop_id: int | None = Field(default=None, gt=0)


class BatchWrite(BaseModel):
    shop_id: int | None = Field(default=None, gt=0)
    candidate_ids: list[int] = Field(min_length=1, max_length=180)
    name: str | None = Field(default=None, max_length=200)


class BatchApprove(BaseModel):
    approver_id: str = Field(min_length=1, max_length=128)
    confirmed: bool = False


class BatchSubmit(BaseModel):
    actor_id: str = Field(min_length=1, max_length=128)
    confirmed: bool = False
    max_items: int = Field(default=20, ge=1, le=20)


class CandidateBatchAI(BaseModel):
    candidate_ids: list[int] = Field(min_length=1, max_length=50)


class CandidateBatchTemplate(BaseModel):
    candidate_ids: list[int] = Field(min_length=1, max_length=100)
    sample_draft_id: int = Field(gt=0)


class ManualListingStart(BaseModel):
    shop_id: int | None = Field(default=None, gt=0)


class BulkListingBatchCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    source_shop_key: str = Field(min_length=2, max_length=180)
    metadata_shop_id: int = Field(gt=0)
    category_id: str = Field(min_length=1, max_length=64)
    type_id: str = Field(min_length=1, max_length=64)
    attributes: list[dict] = Field(default_factory=list, max_length=500)
    target_shop_ids: list[int] = Field(min_length=1, max_length=100)
    distribution_mode: str = Field(default="round_robin", pattern=r"^(round_robin|quota_weighted|fixed)$")
    auto_continue_next_day: bool = False
    sale_price_cny: float = Field(default=26, gt=0)
    old_price_cny: float = Field(default=52, gt=0)
    min_price_cny: float = Field(default=25, gt=0)
    internal_cost_cny: float = Field(default=0, ge=0)
    stock: int = Field(default=999, ge=0)
    weight_g: float = Field(gt=0)
    length_mm: float = Field(gt=0)
    width_mm: float = Field(gt=0)
    height_mm: float = Field(gt=0)
    sku_prefix: str = Field(default="", max_length=20)
    color_strategy: str = Field(default="dictionary_match_then_stable", pattern=r"^(dictionary_match_then_stable|stable_dictionary|manual)$")
    ocr_remove_chinese_size_weight: bool = True
    ocr_remove_marketing_images: bool = True
    translate_product_images: bool = False
    use_original_video: bool = False
    # Must be explicitly sent by the caller.  A missing mode previously
    # silently selected system pricing and turned the configured 26 CNY price
    # into a calculated price.
    pricing_mode_system: bool
    template_name: str | None = Field(default=None, max_length=200)


class BulkListingTemplateSave(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    metadata_shop_id: int = Field(gt=0)
    category_id: str = Field(min_length=1, max_length=64)
    type_id: str = Field(min_length=1, max_length=64)
    attributes: list[dict] = Field(default_factory=list, max_length=500)
    target_shop_ids: list[int] = Field(default_factory=list, max_length=100)
    distribution_mode: str = Field(default="round_robin", pattern=r"^(round_robin|quota_weighted|fixed)$")
    auto_continue_next_day: bool = False
    pricing_mode_system: bool
    sale_price_cny: float = Field(default=26, gt=0)
    old_price_cny: float = Field(default=52, gt=0)
    min_price_cny: float = Field(default=25, gt=0)
    internal_cost_cny: float = Field(default=0, ge=0)
    stock: int = Field(default=999, ge=0)
    weight_g: float = Field(gt=0)
    length_mm: float = Field(gt=0)
    width_mm: float = Field(gt=0)
    height_mm: float = Field(gt=0)
    sku_prefix: str = Field(default="", max_length=20)
    color_strategy: str = Field(default="dictionary_match_then_stable", pattern=r"^(dictionary_match_then_stable|stable_dictionary|manual)$")
    ocr_remove_chinese_size_weight: bool = True
    ocr_remove_marketing_images: bool = True
    translate_product_images: bool = False
    use_original_video: bool = False


class BulkListingBatchStart(BaseModel):
    max_items: int = Field(default=5, ge=1, le=20)


class BulkListingExecute(BaseModel):
    confirmed: bool = False
    # A resume is a continuous queue run. The worker stops each shop at its
    # live Ozon quota, so this is only an emergency upper bound, not a batch
    # size users need to manage.
    max_items: int = Field(default=10000, ge=1, le=10000)
    actor_id: str = Field(default="operator", min_length=1, max_length=128)


class BulkListingRetryWrite(BaseModel):
    item_ids: list[int] = Field(min_length=1, max_length=200)
    actor_id: str = Field(default="operator", min_length=1, max_length=128)


class _BulkPricingVariant:
    """Lightweight SourceVariantRecord substitute for fixed-cost pricing."""

    __slots__ = ("source_sku", "spec_name", "price_cny", "stock")

    def __init__(self, source_sku: str, spec_name: str, price_cny: Decimal, stock: int):
        self.source_sku = source_sku
        self.spec_name = spec_name
        self.price_cny = price_cny
        self.stock = stock


def _bulk_delegated_attribute(row: OzonGlobalAttributeCacheRecord) -> bool:
    """Attributes produced per product by the existing listing editor pipeline."""
    name = str(row.name or "").lower()
    return name.strip() in {"名称", "название"} or str(row.attribute_id) == "9048" or any(token in name for token in (
        "型号名称", "название модели", "主题标签", "хештег", "json富内容", "rich content",
        "简介", "описание", "视频", "видео",
    ))


def _bulk_item_counts(db: Session, batch_id: int) -> dict:
    return dict(db.execute(select(BulkListingBatchItemRecord.status, func.count(BulkListingBatchItemRecord.id)).where(
        BulkListingBatchItemRecord.batch_id == batch_id,
    ).group_by(BulkListingBatchItemRecord.status)).all())


def _bulk_waiting_count(counts: dict) -> int:
    return sum(int(counts.get(status, 0)) for status in ("queued", "prepared", "approved", "waiting_quota"))


def _is_quota_error(message: object) -> bool:
    """Recognize Ozon daily-create exhaustion separately from product errors."""
    text = str(message or "")
    lowered = text.lower()
    markers = (
        "daily create", "daily_create", "creation limit", "create limit",
        "limit exceeded", "quota", "daily limit", "rate limit reached",
        "periodic_limit_exceeded", "periodic limit", "429", "дневной лимит", "превышен лимит", "создания товаров",
        "额度", "限额",
    )
    return any(marker in lowered or marker in text for marker in markers)


def _systemic_batch_pause_reason(message: object) -> str | None:
    """Classify configuration/provider outages that must pause, not burn rows."""
    text = str(message or "")
    lowered = text.lower()
    if ("llm" in lowered or "deepseek" in lowered or "volcengine" in lowered) and any(marker in lowered for marker in (
        "insufficient balance", "monthly usage quota", "exceeded the monthly", "http 402", "返回 402",
    )):
        return "LLM 服务余额或月度额度不足，批量任务已暂停；恢复服务后可继续原队列"
    if any(marker in text for marker in ("店铺授权无法解密", "本地加密密钥")) or "invalidtoken" in lowered:
        return "店铺授权解密配置异常，批量任务已暂停；修复加密密钥后可继续原队列"
    return None


def _ozon_quota_wait_is_active(updated_at: datetime | None) -> bool:
    """Ozon's daily-create counter resets at 03:00 Moscow time.

    Batch timestamps are persisted as UTC-naive values.  Until the reset after
    the observed quota response, do not let a queue that is known to be full
    issue another real import request.
    """
    observed = updated_at or datetime.now(timezone.utc).replace(tzinfo=None)
    if observed.tzinfo is None:
        observed = observed.replace(tzinfo=timezone.utc)
    moscow = observed.astimezone(ZoneInfo("Europe/Moscow"))
    reset = moscow.replace(hour=3, minute=0, second=0, microsecond=0)
    if reset <= moscow:
        reset += timedelta(days=1)
    return datetime.now(timezone.utc) < reset.astimezone(timezone.utc)


def _batch_is_blocked_by_observed_quota(db: Session, batch_id: int) -> bool:
    rows = list(db.execute(select(
        BulkListingBatchItemRecord.assigned_shop_id,
        BulkListingBatchItemRecord.status,
        BulkListingBatchItemRecord.updated_at,
    ).where(BulkListingBatchItemRecord.batch_id == batch_id)).all())
    pending_shops = {shop_id for shop_id, status, _ in rows if status in {"queued", "prepared", "approved", "failed"}}
    quota_shops = {shop_id for shop_id, status, updated_at in rows
                   if status == "waiting_quota" and _ozon_quota_wait_is_active(updated_at)}
    return bool(pending_shops) and pending_shops.issubset(quota_shops)


def _queue_draft_stock_sync(db: Session, draft_id: int | None, task_id: str | None) -> None:
    """Register a successful bulk import with the persisted stock monitor."""
    if not draft_id or not task_id:
        return
    draft = db.get(ListingDraftRecord, draft_id)
    if draft is None or not draft.variants:
        return
    if draft.stock_sync_status == "completed" and draft.stock_synced_at:
        return
    draft.import_task_id = str(task_id)
    draft.stock_sync_status = "waiting_product"
    draft.stock_sync_message = "等待 Ozon 生成全部 SKU，随后自动提交并回读库存"
    draft.stock_sync_next_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=15)
    draft.stock_sync_attempts = 0


def mark_bulk_items_for_ozon_feedback(db: Session, draft: ListingDraftRecord, issues: list[dict] | None) -> int:
    """Project blocking Ozon feedback back to the owning batch rows.

    A successful import task only means Ozon accepted the request.  It does not
    mean the product card is sellable.  Keep warnings visible on the draft, but
    turn actual Ozon errors into a row-level, retryable correction state.
    """
    actual = [row for row in (issues or []) if isinstance(row, dict) and row.get("type") == "ozon_error"]
    # The operator explicitly accepts cross-shop duplicate findings for this
    # workflow.  Keep their Ozon feedback in the draft audit trail, but do not
    # turn them into a corrective-resubmission queue item.
    accepted_codes = {"SPU_ALREADY_EXISTS_IN_ANOTHER_ACCOUNT"}
    quota_rows = [row for row in actual if _is_quota_error(
        f"{row.get('code') or ''} {row.get('description') or row.get('message') or ''}"
    )]
    blocking = [row for row in actual if (
        str(row.get("level") or "").lower() == "error"
        or str(row.get("code") or "").upper().startswith("BR_")
    ) and str(row.get("code") or "").upper() not in accepted_codes and row not in quota_rows]
    if not blocking and not quota_rows:
        return 0
    details = []
    for row in blocking[:3]:
        code = str(row.get("code") or "Ozon错误").strip()
        message = str(row.get("description") or row.get("message") or "").strip()
        details.append(f"{code}：{message}" if message else code)
    is_quota_only = bool(quota_rows) and not blocking
    if is_quota_only:
        message = "Ozon当日创建额度已满，等待额度恢复后继续"
    else:
        message = "Ozon回传需修正提交：" + "；".join(details)
    items = list(db.scalars(select(BulkListingBatchItemRecord).where(
        BulkListingBatchItemRecord.listing_draft_id == draft.id,
        BulkListingBatchItemRecord.status.in_(("submitted", "imported", "failed", "needs_review")),
    )))
    changed = 0
    for item in items:
        target_status = "waiting_quota" if is_quota_only else "needs_review"
        if item.status != target_status or item.error_message != message:
            item.status = target_status
            item.error_message = message
            item.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            changed += 1
        # The legacy list projection uses the automation candidate as its
        # source of truth.  Mirror the corrective state there as well; without
        # this, merely opening the list would overwrite the row back to
        # “已成功”.  This is local state only, not a retry or an Ozon update.
        candidate = db.get(AutomationCandidateRecord, item.candidate_id) if item.candidate_id else None
        if candidate is not None and candidate.status in {"submitted", "imported"}:
            candidate.status = "approved" if is_quota_only else "needs_review"
            candidate.rejection_reason = message[:1000]
            changed += 1
    return changed


def reconcile_bulk_ozon_feedback(db: Session, batch_id: int | None = None) -> int:
    """Backfill row state from feedback already stored on local drafts.

    Imports completed before the feedback projection existed already have Ozon
    errors in ``listing_drafts.ozon_issues_json``.  Re-read only that local
    evidence so opening a batch cannot keep showing an accepted import as a
    successful, sellable item.  This routine never calls Ozon and never queues
    or submits a product.
    """
    query = select(BulkListingBatchItemRecord, ListingDraftRecord).join(
        ListingDraftRecord,
        ListingDraftRecord.id == BulkListingBatchItemRecord.listing_draft_id,
    ).where(BulkListingBatchItemRecord.status.in_(("submitted", "imported", "needs_review")))
    if batch_id is not None:
        query = query.where(BulkListingBatchItemRecord.batch_id == batch_id)
    changed = 0
    touched_batches: set[int] = set()
    for item, draft in db.execute(query).all():
        touched_batches.add(item.batch_id)
        try:
            issues = json.loads(draft.ozon_issues_json or "[]")
        except (TypeError, ValueError):
            issues = []
        changed += mark_bulk_items_for_ozon_feedback(db, draft, issues if isinstance(issues, list) else [])
        # ``changed`` is tracked by the projection helper; the batch counters
        # below are refreshed for every inspected batch, including after a
        # previous interrupted migration left counters stale.

    db.flush()
    counter_changed = False
    for touched_batch_id in touched_batches:
        batch = db.get(BulkListingBatchRecord, touched_batch_id)
        if batch is None:
            continue
        counts = _bulk_item_counts(db, touched_batch_id)
        next_values = (
            int(counts.get("needs_review", 0)),
            int(counts.get("failed", 0)),
            int(counts.get("submitted", 0)) + int(counts.get("imported", 0)),
            int(counts.get("imported", 0)),
        )
        if (batch.needs_review_count, batch.failed_count, batch.submitted_count, batch.succeeded_count) != next_values:
            batch.needs_review_count, batch.failed_count, batch.submitted_count, batch.succeeded_count = next_values
            counter_changed = True
    if changed or counter_changed:
        db.commit()
    return changed


def reconcile_bulk_quota_errors(db: Session, batch_id: int | None = None) -> int:
    """Reclassify historical Ozon daily-limit responses without resubmitting.

    Older scheduler code persisted a completed import-task quota response as
    ``failed``. It is neither a content failure nor a stock failure: the
    product was never created. Restore a durable waiting-quota state so a
    later explicit operator resume can continue safely after Ozon resets.
    """
    query = select(BulkListingBatchItemRecord).where(
        BulkListingBatchItemRecord.status == "failed",
    )
    if batch_id is not None:
        query = query.where(BulkListingBatchItemRecord.batch_id == batch_id)
    repaired = 0
    for item in db.scalars(query):
        if not _is_quota_error(item.error_message):
            continue
        item.status = "waiting_quota"
        item.error_message = "Ozon当日创建额度已满，等待额度恢复后继续"
        item.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        draft = db.get(ListingDraftRecord, item.listing_draft_id) if item.listing_draft_id else None
        if draft is not None and draft.stock_sync_status != "completed":
            draft.stock_sync_status = "waiting_quota"
            draft.stock_sync_message = "Ozon 当日创建额度已满；尚未生成商品，等待恢复后重新提交"
            draft.stock_sync_next_at = None
        repaired += 1
    if repaired:
        db.commit()
    return repaired


def reconcile_bulk_stock_sync(db: Session, batch_id: int | None = None) -> int:
    """Restore stock-monitor rows for bulk imports completed before this hook existed."""
    query = select(BulkListingBatchItemRecord, PipelineProductRecord).join(
        PipelineProductRecord,
        (PipelineProductRecord.shop_id == BulkListingBatchItemRecord.assigned_shop_id)
        & (PipelineProductRecord.source_product_id == BulkListingBatchItemRecord.source_product_id),
    ).where(
        BulkListingBatchItemRecord.status.in_(("submitted", "imported")),
        PipelineProductRecord.task_id.is_not(None),
        PipelineProductRecord.listing_draft_id.is_not(None),
    )
    if batch_id is not None:
        query = query.where(BulkListingBatchItemRecord.batch_id == batch_id)
    repaired = 0
    for item, pipeline in db.execute(query).all():
        draft = db.get(ListingDraftRecord, pipeline.listing_draft_id)
        if draft is None or not draft.variants:
            continue
        if draft.stock_sync_status == "completed" and draft.stock_synced_at:
            continue
        if draft.stock_sync_status == "import_failed":
            continue
        before = (draft.import_task_id, draft.stock_sync_status, draft.stock_sync_next_at)
        _queue_draft_stock_sync(db, draft.id, pipeline.task_id)
        after = (draft.import_task_id, draft.stock_sync_status, draft.stock_sync_next_at)
        if before != after:
            repaired += 1
    if repaired:
        db.commit()
    return repaired


def _bulk_listing_batch(row: BulkListingBatchRecord, counts: dict | None = None, activity: dict | None = None) -> dict:
    counts = counts or {}
    activity = activity or {}
    # The denormalized batch counters can lag while a worker is committing an
    # item. When a fresh status grouping is available, use it as the source of
    # truth for the operator-facing progress display.
    submitted_count = int(counts.get("submitted", 0)) + int(counts.get("imported", 0)) if counts else row.submitted_count
    succeeded_count = int(counts.get("imported", 0)) if counts else row.succeeded_count
    needs_review_count = int(counts.get("needs_review", 0)) if counts else row.needs_review_count
    failed_count = int(counts.get("failed", 0)) if counts else row.failed_count
    terminal_count = sum(int(counts.get(status, 0)) for status in ("submitted", "imported", "failed", "needs_review", "skipped"))
    progress_percent = round(min(100, terminal_count / row.total_count * 100), 1) if row.total_count else 0
    return {
        "id": row.id, "name": row.name, "source_shop_key": row.source_shop_key,
        "source_shop_name": row.source_shop_name, "sample_draft_id": row.sample_draft_id,
        "target_shop_ids": json.loads(row.target_shop_ids_json or "[]"),
        "distribution_mode": row.distribution_mode, "rules": json.loads(row.rules_json or "{}"),
        "status": row.status, "auto_continue_next_day": row.auto_continue_next_day,
        "total_count": row.total_count, "prepared_count": row.prepared_count,
        "waiting_count": _bulk_waiting_count(counts) if counts else row.total_count - needs_review_count - failed_count - submitted_count,
        "queued_count": sum(int(counts.get(status, 0)) for status in ("queued", "prepared", "approved")) if counts else 0,
        "waiting_quota_count": int(counts.get("waiting_quota", 0)) if counts else 0,
        "processing_count": int(counts.get("processing", 0)) if counts else 0,
        "needs_review_count": needs_review_count, "submitted_count": submitted_count,
        "succeeded_count": succeeded_count, "failed_count": failed_count,
        "processed_count": terminal_count, "progress_percent": progress_percent,
        "processing_items": activity.get("processing_items", []),
        "last_activity_at": activity.get("last_activity_at"),
        "created_at": row.created_at, "updated_at": row.updated_at,
    }


def _bulk_activity(db: Session, batch_id: int, counts: dict | None = None) -> dict:
    counts = counts or _bulk_item_counts(db, batch_id)
    current = db.execute(select(BulkListingBatchItemRecord, SourceProductRecord).join(
        SourceProductRecord, SourceProductRecord.id == BulkListingBatchItemRecord.source_product_id,
    ).where(
        BulkListingBatchItemRecord.batch_id == batch_id,
        BulkListingBatchItemRecord.status == "processing",
    ).order_by(BulkListingBatchItemRecord.updated_at.desc()).limit(3)).all()
    latest = db.scalar(select(func.max(BulkListingBatchItemRecord.updated_at)).where(
        BulkListingBatchItemRecord.batch_id == batch_id,
    ))
    return {
        "processing_items": [{
            "id": item.id, "title": source.title, "source_offer_id": source.source_product_id,
            "assigned_shop_id": item.assigned_shop_id, "attempts": item.attempts,
            "ozon_task_id": item.ozon_task_id, "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        } for item, source in current],
        "last_activity_at": latest.isoformat() if latest else None,
    }


def _normalize_bulk_attributes(items: list[dict] | None) -> list[dict]:
    """Accept both current attribute_id fields and legacy attributeId fields."""
    normalized: dict[str, dict] = {}
    for item in items or []:
        attr_id = str(item.get("attribute_id") or item.get("attributeId") or "").strip()
        if not attr_id:
            continue
        value_id = str(item.get("value_id") or item.get("valueId") or "").strip()
        value_text = str(item.get("value_text") or item.get("value") or "").strip()
        if not value_id and not value_text:
            continue
        normalized[attr_id] = {
            "attribute_id": attr_id,
            "name": str(item.get("name") or "").strip() or attr_id,
            "value_id": value_id or None,
            "value_text": value_text or None,
        }
    return list(normalized.values())


def _validate_bulk_attributes(
    db: Session,
    metadata_shop_id: int,
    category_id: str,
    type_id: str,
    attributes: list[dict] | None,
) -> list[dict]:
    promote_legacy_listing_caches(db, category_id=category_id, type_id=type_id)
    cached_attrs = list(db.scalars(select(OzonGlobalAttributeCacheRecord).where(
        OzonGlobalAttributeCacheRecord.category_id == category_id,
        OzonGlobalAttributeCacheRecord.type_id == type_id,
    )))
    if not cached_attrs:
        raise HTTPException(422, "该分类与Type ID尚未加载完整属性，请重新选择分类")
    normalized = _normalize_bulk_attributes(attributes)
    attr_by_id = {str(row.attribute_id): row for row in cached_attrs}
    submitted = {str(row["attribute_id"]): row for row in normalized}
    missing = [
        row.name for row in cached_attrs
        if row.required and not _bulk_delegated_attribute(row)
        and not str((submitted.get(str(row.attribute_id)) or {}).get("value_text") or "").strip()
    ]
    if missing:
        raise HTTPException(422, f"仍有必填属性未填写：{'、'.join(missing[:8])}")
    for attr_id, item in submitted.items():
        cached = attr_by_id.get(attr_id)
        if cached is None:
            raise HTTPException(422, f"属性 {attr_id} 不属于当前分类")
        value_text = str(item.get("value_text") or "").strip()
        value_id = str(item.get("value_id") or "").strip()
        if value_text and cached.dictionary_id and not value_id:
            raise HTTPException(422, f"字典属性“{cached.name}”必须从Ozon菜单选择")
        if value_id and cached.dictionary_id:
            value_ids = [part.strip() for part in value_id.split("|") if part.strip()] if cached.is_collection else [value_id]
            # Validate against global dictionary cache first — the frontend
            # dictionary search also fills from the global values table.
            valid_count = db.scalar(select(func.count(func.distinct(OzonGlobalDictValueRecord.value_id))).where(
                OzonGlobalDictValueRecord.category_id == category_id,
                OzonGlobalDictValueRecord.type_id == type_id,
                OzonGlobalDictValueRecord.attribute_id == attr_id,
                OzonGlobalDictValueRecord.value_id.in_(value_ids),
            )) or 0
            if valid_count != len(set(value_ids)):
                raise HTTPException(422, f"字典属性\"{cached.name}\"包含无效的Ozon选项ID")
    return normalized


def _bulk_template_rules(payload: BaseModel, normalized_attributes: list[dict], exclude: set[str]) -> dict:
    rules = payload.model_dump(exclude=exclude)
    rules["attributes"] = normalized_attributes
    return rules


def _upsert_bulk_template_named(
    db: Session,
    name: str,
    category_id: str,
    type_id: str,
    target_shop_ids: list[int],
    rules: dict,
) -> BulkListingTemplateRecord:
    existing = db.scalar(select(BulkListingTemplateRecord).where(BulkListingTemplateRecord.name == name))
    if existing:
        row = existing
        row.category_id = category_id
        row.type_id = type_id
    else:
        row = BulkListingTemplateRecord(name=name, category_id=category_id, type_id=type_id)
        db.add(row)
    row.target_shop_ids_json = json.dumps(target_shop_ids, ensure_ascii=False)
    row.rules_json = json.dumps(rules, ensure_ascii=False)
    db.flush()
    return row


def _bulk_template(row: BulkListingTemplateRecord) -> dict:
    return {
        "id": row.id, "name": row.name, "category_id": row.category_id, "type_id": row.type_id,
        "target_shop_ids": json.loads(row.target_shop_ids_json or "[]"),
        "rules": json.loads(row.rules_json or "{}"),
        "created_at": row.created_at, "updated_at": row.updated_at,
    }


def _reconcile_bulk_publish_projection(db: Session, batch_id: int) -> None:
    """Project candidate/Ozon outcomes back onto the bulk-task rows."""
    rows=db.execute(select(
        BulkListingBatchItemRecord,AutomationCandidateRecord,PipelineProductRecord,
    ).join(
        AutomationCandidateRecord,AutomationCandidateRecord.id==BulkListingBatchItemRecord.candidate_id,
    ).outerjoin(
        PipelineProductRecord,
        (PipelineProductRecord.shop_id==AutomationCandidateRecord.shop_id)&
        (PipelineProductRecord.source_product_id==AutomationCandidateRecord.source_record_id),
    ).where(
        BulkListingBatchItemRecord.batch_id==batch_id,
        AutomationCandidateRecord.status.in_(["submitted","imported","publish_failed"]),
    )).all()
    changed=False
    for item,candidate,pipeline in rows:
        # A real Ozon card error is stronger evidence than the earlier
        # successful import receipt.  Never erase the actionable row state
        # while merely refreshing the batch list.
        if item.status == "needs_review" and str(item.error_message or "").startswith("Ozon回传需修正提交："):
            continue
        if item.status == "waiting_quota" and _is_quota_error(item.error_message):
            continue
        target_status={"submitted":"submitted","imported":"imported","publish_failed":"failed"}[candidate.status]
        if item.status!=target_status or (pipeline and pipeline.task_id and item.ozon_task_id!=pipeline.task_id):
            item.status=target_status
            item.ozon_task_id=pipeline.task_id if pipeline and pipeline.task_id else item.ozon_task_id
            item.error_message=candidate.rejection_reason if target_status=="failed" else None
            changed=True
    counts=dict(db.execute(select(BulkListingBatchItemRecord.status,func.count(BulkListingBatchItemRecord.id)).where(
        BulkListingBatchItemRecord.batch_id==batch_id,
    ).group_by(BulkListingBatchItemRecord.status)).all())
    batch=db.get(BulkListingBatchRecord,batch_id)
    if batch:
        submitted=int(counts.get("submitted",0))+int(counts.get("imported",0))
        succeeded=int(counts.get("imported",0))
        failed=int(counts.get("failed",0))
        if (batch.submitted_count,batch.succeeded_count,batch.failed_count)!=(submitted,succeeded,failed):
            batch.submitted_count=submitted;batch.succeeded_count=succeeded;batch.failed_count=failed;changed=True
    if changed:
        db.commit()


@router.get("/bulk-listing-batches/sources")
def bulk_listing_batch_sources(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(
        SourceProductRecord.source_shop_key, SourceProductRecord.source_shop_name,
        func.count(func.distinct(SourceProductRecord.id)), func.count(SourceVariantRecord.id),
    ).outerjoin(SourceVariantRecord, SourceVariantRecord.source_product_id == SourceProductRecord.id).where(
        SourceProductRecord.source_shop_key.is_not(None), SourceProductRecord.source_shop_key != "",
    ).group_by(SourceProductRecord.source_shop_key, SourceProductRecord.source_shop_name).order_by(func.count(SourceProductRecord.id).desc())).all()
    return [{"source_shop_key": key, "source_shop_name": name, "product_count": products, "sku_count": skus}
            for key, name, products, skus in rows]


@router.get("/bulk-listing-batches/samples")
def bulk_listing_batch_samples(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(ListingDraftRecord, Shop).join(
        Shop, Shop.id == ListingDraftRecord.shop_id,
    ).where(
        ListingDraftRecord.category_id.is_not(None), ListingDraftRecord.category_id != "",
        ListingDraftRecord.type_id.is_not(None), ListingDraftRecord.type_id != "",
    ).order_by(ListingDraftRecord.updated_at.desc(), ListingDraftRecord.id.desc()).limit(300)).all()
    return [{
        "id": draft.id, "offer_id": draft.offer_id, "title": draft.title,
        "shop_id": draft.shop_id, "shop_name": shop.name,
        "category_id": draft.category_id, "type_id": draft.type_id,
        "status": draft.status, "updated_at": draft.updated_at,
    } for draft, shop in rows]


@router.get("/bulk-listing-batches/source-preview")
def bulk_listing_batch_source_preview(source_shop_key: str, db: Session = Depends(get_db)) -> dict:
    products = list(db.scalars(select(SourceProductRecord).where(SourceProductRecord.source_shop_key == source_shop_key)))
    if not products:
        raise HTTPException(404, "没有找到该1688来源店铺的商品")
    source_ids = [row.id for row in products]
    sku_count = db.scalar(select(func.count(SourceVariantRecord.id)).where(SourceVariantRecord.source_product_id.in_(source_ids))) or 0
    return {"source_shop_key": source_shop_key, "source_shop_name": products[0].source_shop_name,
            "product_count": len(products), "sku_count": sku_count,
            "representative_source_product_id": products[0].id,
            "representative_title": products[0].title, "representative_material": products[0].material or ""}


@router.post("/bulk-listing-batches", status_code=201)
def create_bulk_listing_batch(payload: BulkListingBatchCreate, db: Session = Depends(get_db)) -> dict:
    metadata_shop = db.get(Shop, payload.metadata_shop_id)
    if metadata_shop is None:
        raise HTTPException(422, "分类属性所属Ozon店铺不存在")
    normalized_attributes = _validate_bulk_attributes(
        db, payload.metadata_shop_id, payload.category_id, payload.type_id, payload.attributes,
    )
    shops = list(db.scalars(select(Shop).where(Shop.id.in_(payload.target_shop_ids))))
    if len(shops) != len(set(payload.target_shop_ids)):
        raise HTTPException(422, "部分目标Ozon店铺不存在")
    sources = list(db.scalars(select(SourceProductRecord).where(
        SourceProductRecord.source_shop_key == payload.source_shop_key,
    ).order_by(SourceProductRecord.id)))
    if not sources:
        raise HTTPException(404, "该来源店铺没有可处理商品")
    rules = payload.model_dump(exclude={"name", "source_shop_key", "target_shop_ids", "distribution_mode", "auto_continue_next_day", "metadata_shop_id", "template_name"})
    rules["attributes"] = normalized_attributes
    template_name = str(payload.template_name or "").strip()
    if template_name:
        _upsert_bulk_template_named(
            db, template_name, payload.category_id, payload.type_id, payload.target_shop_ids,
            _bulk_template_rules(payload, normalized_attributes, {"name", "source_shop_key", "metadata_shop_id", "template_name"}),
        )
    batch = BulkListingBatchRecord(
        name=payload.name, source_shop_key=payload.source_shop_key,
        source_shop_name=sources[0].source_shop_name, sample_draft_id=None,
        target_shop_ids_json=json.dumps(payload.target_shop_ids), distribution_mode=payload.distribution_mode,
        rules_json=json.dumps(rules, ensure_ascii=False), auto_continue_next_day=payload.auto_continue_next_day,
        status="draft", total_count=len(sources),
    )
    db.add(batch); db.flush()
    candidate_by_source = {row.source_record_id: row.id for row in db.scalars(select(AutomationCandidateRecord).where(
        AutomationCandidateRecord.source_record_id.in_([source.id for source in sources])
    )) if row.source_record_id}
    target_ids = payload.target_shop_ids
    for index, source in enumerate(sources):
        assigned_shop_id = target_ids[0] if payload.distribution_mode == "fixed" else target_ids[index % len(target_ids)]
        db.add(BulkListingBatchItemRecord(
            batch_id=batch.id, source_product_id=source.id, candidate_id=candidate_by_source.get(source.id),
            assigned_shop_id=assigned_shop_id, status="queued",
        ))
    db.add(AuditEventRecord(shop_id=target_ids[0], actor_id="operator", action="bulk_listing_batch_created",
        entity_type="bulk_listing_batch", entity_id=str(batch.id),
        details_json=json.dumps({"source_shop_key": payload.source_shop_key, "count": len(sources), "target_shop_ids": target_ids, "template_name": template_name or None}, ensure_ascii=False)))
    db.commit(); db.refresh(batch)
    return _bulk_listing_batch(batch, _bulk_item_counts(db, batch.id))


@router.get("/bulk-listing-templates")
def list_bulk_listing_templates(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(BulkListingTemplateRecord).order_by(BulkListingTemplateRecord.updated_at.desc()).limit(100)).all()
    return [_bulk_template(row) for row in rows]


@router.post("/bulk-listing-templates", status_code=201)
def save_bulk_listing_template(payload: BulkListingTemplateSave, db: Session = Depends(get_db)) -> dict:
    if db.get(Shop, payload.metadata_shop_id) is None:
        raise HTTPException(422, "分类属性所属Ozon店铺不存在")
    if payload.target_shop_ids:
        shops = list(db.scalars(select(Shop).where(Shop.id.in_(payload.target_shop_ids))))
        if len(shops) != len(set(payload.target_shop_ids)):
            raise HTTPException(422, "部分目标Ozon店铺不存在")
    normalized_attributes = _validate_bulk_attributes(
        db, payload.metadata_shop_id, payload.category_id, payload.type_id, payload.attributes,
    )
    rules = _bulk_template_rules(payload, normalized_attributes, {"name", "metadata_shop_id"})
    row = _upsert_bulk_template_named(
        db, payload.name, payload.category_id, payload.type_id, payload.target_shop_ids, rules,
    )
    db.commit()
    db.refresh(row)
    return _bulk_template(row)


@router.get("/bulk-listing-templates/{template_id}")
def get_bulk_listing_template(template_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(BulkListingTemplateRecord, template_id)
    if row is None:
        raise HTTPException(404, "批量模板不存在")
    return _bulk_template(row)


@router.delete("/bulk-listing-templates/{template_id}")
def delete_bulk_listing_template(template_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(BulkListingTemplateRecord, template_id)
    if row is None:
        raise HTTPException(404, "批量模板不存在")
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": template_id}


@router.get("/bulk-listing-batches")
def list_bulk_listing_batches(db: Session = Depends(get_db)) -> list[dict]:
    """Return the operator-facing task list without performing repair work.

    This endpoint is polled by the browser.  Running recovery, projection and
    state reconciliation here turns one page refresh into a write-heavy scan
    over every batch item and can starve the entire ERP.  Those jobs belong to
    the bounded background worker; this route must remain a fast read.
    """
    rows=list(db.scalars(select(BulkListingBatchRecord).order_by(BulkListingBatchRecord.id.desc()).limit(100)))
    payload = []
    for row in rows:
        counts = _bulk_item_counts(db, row.id)
        payload.append(_bulk_listing_batch(row, counts, _bulk_activity(db, row.id, counts)))
    return payload


def _recover_stale_bulk_items(
    db: Session,
    batch_id: int | None = None,
    *,
    stale_after: timedelta = timedelta(minutes=30),
) -> int:
    """Recover items that stayed in processing after a restart/crash.

    An item with an Ozon task id has already crossed the external submission
    boundary.  It must be returned to feedback reconciliation, never blindly
    put back into the submission queue (which could create a duplicate).
    Only locally interrupted, not-yet-submitted items are safe to requeue.
    """
    # SQLAlchemy stores these timestamps as naive UTC values. Comparing them
    # with local Asia/Shanghai time makes fresh work look eight hours stale.
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - stale_after
    query = db.query(BulkListingBatchItemRecord).filter(
        BulkListingBatchItemRecord.status == "processing",
        BulkListingBatchItemRecord.updated_at < cutoff,
    )
    if batch_id is not None:
        query = query.filter(BulkListingBatchItemRecord.batch_id == batch_id)
    try:
        items = list(query.order_by(BulkListingBatchItemRecord.id))
        updated = 0
        for item in items:
            draft = db.get(ListingDraftRecord, item.listing_draft_id) if item.listing_draft_id else None
            if item.ozon_task_id:
                if draft is not None and draft.stock_sync_status == "waiting_quota":
                    item.status = "waiting_quota"
                    item.error_message = "Ozon 当日创建额度已满，保留原任务号等待恢复；不会重复提交"
                else:
                    item.status = "submitted"
                    item.error_message = "进程中断，已保留 Ozon 任务号，等待回执复核；不会重复提交"
            else:
                item.status = "queued"
                item.error_message = "本地处理超时，尚未提交 Ozon，已重新排队"
            updated += 1
        if updated:
            db.commit()
        return updated
    except OperationalError:
        db.rollback()
        return 0


def _quarantine_submitted_bulk_items(db: Session, batch_id: int | None = None) -> int:
    """Remove historical task-backed rows from the re-submit queue."""
    query = db.query(BulkListingBatchItemRecord).filter(
        BulkListingBatchItemRecord.ozon_task_id.is_not(None),
        BulkListingBatchItemRecord.status.in_(("queued", "prepared", "approved", "failed")),
    )
    if batch_id is not None:
        query = query.filter(BulkListingBatchItemRecord.batch_id == batch_id)
    changed = 0
    for item in query.order_by(BulkListingBatchItemRecord.id):
        draft = db.get(ListingDraftRecord, item.listing_draft_id) if item.listing_draft_id else None
        if _is_quota_error(item.error_message) or (draft is not None and draft.stock_sync_status == "waiting_quota"):
            item.status = "waiting_quota"
            item.error_message = "Ozon task 已存在，保留原任务号等待额度/回执；不会重复提交"
        else:
            item.status = "submitted"
            item.error_message = "Ozon task 已存在，保留原任务号等待回执；不会重复提交"
        changed += 1
    if changed:
        db.commit()
    return changed


def _reconcile_bulk_batch_state(db: Session, batch_id: int) -> None:
    """Keep batch status honest when the worker stopped without a final update."""
    batch = db.get(BulkListingBatchRecord, batch_id)
    # A manual pause is an operator safety command, just like the quality
    # pause.  Reconciliation must never turn it into a resumable/running
    # state merely because queued rows are still present.
    if batch is None or batch.status in {"draft", "paused", "paused_quality_audit", "submitted"}:
        return
    counts = dict(db.execute(select(BulkListingBatchItemRecord.status, func.count(BulkListingBatchItemRecord.id)).where(
        BulkListingBatchItemRecord.batch_id == batch_id,
    ).group_by(BulkListingBatchItemRecord.status)).all())
    if counts.get("processing", 0):
        return
    latest = db.scalar(select(func.max(BulkListingBatchItemRecord.updated_at)).where(
        BulkListingBatchItemRecord.batch_id == batch_id))
    if latest is not None and latest.tzinfo is None:
        latest = latest.replace(tzinfo=timezone.utc)
    if latest and latest >= datetime.now(timezone.utc) - timedelta(minutes=2):
        return
    if _batch_is_blocked_by_observed_quota(db, batch_id):
        batch.status = "waiting_quota"
    elif counts.get("waiting_quota", 0) and not (counts.get("queued", 0) or counts.get("prepared", 0) or counts.get("approved", 0)):
        batch.status = "waiting_quota"
    elif counts.get("queued", 0) or counts.get("prepared", 0) or counts.get("approved", 0):
        batch.status = "ready_to_continue"
    elif counts.get("needs_review", 0) or counts.get("failed", 0):
        batch.status = "needs_review"
    else:
        batch.status = "submitted"
    batch.prepared_count = int(counts.get("prepared", 0))
    batch.needs_review_count = int(counts.get("needs_review", 0))
    batch.failed_count = int(counts.get("failed", 0))
    batch.submitted_count = int(counts.get("submitted", 0)) + int(counts.get("imported", 0))
    batch.succeeded_count = int(counts.get("imported", 0))
    db.commit()


@router.get("/bulk-listing-batches/{batch_id}")
def bulk_listing_batch_detail(batch_id: int, page: int = 1, page_size: int = 50, status: str | None = None, db: Session = Depends(get_db)) -> dict:
    batch = db.get(BulkListingBatchRecord, batch_id)
    if batch is None:
        raise HTTPException(404, "批量刊登任务不存在")
    # Detail is also browser-polled.  Never run batch-wide repair/reconciliation
    # here: it belongs to a bounded worker and would make opening one task
    # block the entire API process.
    page = max(1, page); page_size = max(1, min(page_size, 5000))
    query = select(BulkListingBatchItemRecord, SourceProductRecord).join(
        SourceProductRecord, SourceProductRecord.id == BulkListingBatchItemRecord.source_product_id,
    ).where(BulkListingBatchItemRecord.batch_id == batch_id)
    if status:
        query = query.where(BulkListingBatchItemRecord.status == status)
    query = query.order_by(BulkListingBatchItemRecord.id)
    pairs = db.execute(query.offset((page - 1) * page_size).limit(page_size)).all()
    counts = _bulk_item_counts(db, batch_id)
    result = _bulk_listing_batch(batch, counts, _bulk_activity(db, batch_id, counts))
    result.update({"page": page, "page_size": page_size, "status_filter": status or "", "items": [
        {"id": item.id, "source_offer_id": source.source_product_id,
         "erp_offer_id": (draft.offer_id if draft else None),
         "offer_id": source.source_product_id, "title": source.title,
         "image_url": source.main_image_url, "assigned_shop_id": item.assigned_shop_id,
         "status": item.status, "draft_id": item.listing_draft_id, "error": item.error_message,
         "requires_resubmit": bool(item.status == "needs_review" and str(item.error_message or "").startswith("Ozon回传需修正提交：")),
         "stock_sync_status": (draft.stock_sync_status if draft else None),
         "stock_sync_message": (draft.stock_sync_message if draft else None),
         "attempts": item.attempts, "ozon_task_id": item.ozon_task_id,
         "updated_at": item.updated_at.isoformat() if item.updated_at else None}
        for item, source, draft in [(item, source, db.get(ListingDraftRecord, item.listing_draft_id) if item.listing_draft_id else None) for item, source in pairs]
    ]})
    return result


class BulkOcrResolveWrite(BaseModel):
    action: str = Field(pattern=r"^(retry|keep|exclude)$")
    url: str = Field(min_length=8, max_length=2000)


class BulkListingApproveWrite(BaseModel):
    item_ids: list[int] = Field(min_length=1, max_length=180)
    approver_id: str = Field(default="operator", min_length=1, max_length=128)
    confirmed: bool = False


def _bulk_draft_integrity_issues(db: Session, item: BulkListingBatchItemRecord) -> list[str]:
    draft=db.get(ListingDraftRecord,item.listing_draft_id) if item.listing_draft_id else None
    if draft is None: return ["本地草稿不存在"]
    issues=[]
    attrs={str(row.attribute_id):row for row in draft.attribute_values}
    if not attrs: issues.append("草稿属性未持久化")
    for attr_id in ("85","9048","9163","8229","11254","4191"):
        if attr_id not in attrs or not str(attrs[attr_id].value_text or attrs[attr_id].value_id or "").strip():
            issues.append(f"草稿缺少属性 {attr_id}")
    rich=attrs.get("11254")
    if rich and rich.value_text:
        try:
            parsed=json.loads(rich.value_text)
            if not isinstance(parsed.get("content"),list) or not parsed["content"]: issues.append("JSON富内容没有有效content")
        except Exception: issues.append("JSON富内容不是合法JSON")
    images=json.loads(draft.images_json or "[]")
    if not images: issues.append("草稿公共产品图为空")
    variants=list(draft.variants)
    if not variants: issues.append("草稿SKU为空")
    sku_images=[]
    for variant in variants:
        if not variant.image_url: issues.append(f"SKU {variant.seller_sku} 缺少独立SKU图")
        else: sku_images.append(variant.image_url)
        try: values=json.loads(variant.variant_values_json or "{}")
        except Exception: values={}
        color_ids=(values.get("__ids__") or {}).get("商品颜色") or []
        if not values.get("商品颜色") or not color_ids: issues.append(f"SKU {variant.seller_sku} 缺少Ozon颜色字典ID")
        if not str(values.get("颜色名称") or variant.name_ru or "").strip(): issues.append(f"SKU {variant.seller_sku} 缺少俄文颜色名称")
        if not variant.price_cny or not variant.weight_g or not variant.length_mm or not variant.width_mm or not variant.height_mm:
            issues.append(f"SKU {variant.seller_sku} 价格或尺重不完整")
    if len(variants)>1 and len(set(sku_images))<len(sku_images): issues.append("多个SKU错误复用了同一张SKU图")
    if not issues:
        pipeline=db.scalar(select(PipelineProductRecord).where(PipelineProductRecord.listing_draft_id==draft.id))
        if pipeline:
            preview=build_import_payload(db,pipeline.shop_id,pipeline.source_product_id)
            for payload,variant in zip(preview.get("items") or [],variants):
                if not payload.get("images") or payload["images"][0]!=variant.image_url: issues.append(f"SKU {variant.seller_sku} 提交首图不是自身SKU图")
    return list(dict.fromkeys(issues))


def _latest_bulk_ocr_audit(db: Session, item_id: int) -> AuditEventRecord | None:
    return db.scalar(select(AuditEventRecord).where(
        AuditEventRecord.action == "bulk_listing_local_ocr",
        AuditEventRecord.entity_type == "bulk_listing_batch_item",
        AuditEventRecord.entity_id == str(item_id),
    ).order_by(AuditEventRecord.id.desc()))


@router.get("/bulk-listing-batches/{batch_id}/items/{item_id}/ocr-review")
def bulk_listing_ocr_review(batch_id: int, item_id: int, db: Session = Depends(get_db)) -> dict:
    item = db.get(BulkListingBatchItemRecord, item_id)
    if item is None or item.batch_id != batch_id:
        raise HTTPException(404, "批量任务商品不存在")
    audit = _latest_bulk_ocr_audit(db, item_id)
    evidence = json.loads(audit.details_json or "{}") if audit else {"images": []}
    return {"item_id": item.id, "status": item.status, "error": item.error_message,
            "draft_id": item.listing_draft_id, "images": evidence.get("images") or []}


@router.post("/bulk-listing-batches/{batch_id}/items/{item_id}/ocr-review")
def resolve_bulk_listing_ocr(batch_id: int, item_id: int, payload: BulkOcrResolveWrite, background_tasks: BackgroundTasks, db: Session = Depends(get_db)) -> dict:
    batch = db.get(BulkListingBatchRecord, batch_id)
    if batch is None:
        raise HTTPException(404, "批量刊登任务不存在")
    item = db.get(BulkListingBatchItemRecord, item_id)
    if item is None or item.batch_id != batch_id:
        raise HTTPException(404, "批量任务商品不存在")
    # OCR evidence is safe to resolve while paused, but resolving it must not
    # be a hidden resume action. Keep the persisted pause authoritative and
    # let the explicit execute/resume action start the worker later.
    was_paused = _bulk_batch_is_paused(batch)
    audit = _latest_bulk_ocr_audit(db, item_id)
    if audit is None:
        raise HTTPException(409, "该商品没有可处理的OCR记录")
    details = json.loads(audit.details_json or "{}")
    images = details.get("images") or []
    target = next((row for row in images if str(row.get("url")) == payload.url), None)
    if target is None:
        raise HTTPException(404, "OCR图片记录不存在")
    if payload.action == "retry":
        target.update(inspect_image(payload.url))
        target.pop("manual_resolution", None)
    else:
        target.update({"error": None, "excluded": payload.action == "exclude",
                       "manual_resolution": payload.action, "resolved_by": "operator"})
    draft = db.get(ListingDraftRecord, item.listing_draft_id) if item.listing_draft_id else None
    if draft is not None:
        draft_images = json.loads(draft.images_json or "[]")
        if target.get("excluded"):
            draft_images = [url for url in draft_images if url != payload.url]
        elif payload.url not in draft_images:
            draft_images.append(payload.url)
        draft.images_json = json.dumps(draft_images, ensure_ascii=False)
        draft.primary_image_url = draft_images[0] if draft_images else None
    unresolved = [row for row in images if row.get("error")]
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == item.assigned_shop_id,
        PipelineProductRecord.source_product_id == item.source_product_id,
    ))
    other_issues = json.loads(pipeline.quality_issues_json or "[]") if pipeline else []
    if unresolved:
        item.status = "needs_review"
        item.error_message = f"本地OCR有 {len(unresolved)} 张识别失败，请重试或人工决定保留/排除"
    elif other_issues:
        item.status = "needs_review"
        item.error_message = "；".join(str(row.get("message") or row) for row in other_issues[:5])
    else:
        item.status = "queued"
        item.error_message = None
        if not was_paused:
            batch.status = "running"
    details.update({"images": images,
                    "excluded_count": sum(1 for row in images if row.get("excluded")),
                    "resolved_action": payload.action})
    db.add(AuditEventRecord(shop_id=item.assigned_shop_id, actor_id="operator",
        action="bulk_listing_local_ocr", entity_type="bulk_listing_batch_item", entity_id=str(item.id),
        details_json=json.dumps(details, ensure_ascii=False)))
    db.flush()
    _reconcile_bulk_batch_state(db, batch_id)
    if item.status == "queued" and not was_paused:
        background_tasks.add_task(_run_bulk_listing_pilot, batch_id, 1, True, "operator", [item.id])
    return {"item_id": item.id, "status": item.status, "error": item.error_message,
            "image": target, "unresolved_count": len(unresolved),
            "queued_for_resume": bool(item.status == "queued" and was_paused)}


@router.post("/bulk-listing-batches/{batch_id}/items/{item_id}/retry")
def retry_bulk_listing_item(batch_id: int, item_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)) -> dict:
    _recover_stale_bulk_items(db, batch_id)
    batch = db.get(BulkListingBatchRecord, batch_id)
    if batch is None:
        raise HTTPException(404, "批量刊登任务不存在")
    if _bulk_batch_is_paused(batch):
        raise HTTPException(409, "批次已暂停；请先明确恢复批次后再重试")
    item = db.get(BulkListingBatchItemRecord, item_id)
    if item is None or item.batch_id != batch_id:
        raise HTTPException(404, "批量商品不存在")
    if item.status not in {"failed", "needs_review", "waiting_quota", "processing", "prepared", "approved", "skipped"}:
        raise HTTPException(422, "当前状态不需要重试")
    item.status = "queued"
    item.error_message = None
    batch.status = "running"
    db.commit()
    background_tasks.add_task(_run_bulk_listing_pilot, batch_id, 1, True, "operator", [item_id])
    return {"batch_id": batch_id, "item_id": item_id, "status": "queued", "started_items": 1}


@router.post("/bulk-listing-batches/{batch_id}/items/batch-retry")
def retry_bulk_listing_items(batch_id: int, payload: BulkListingRetryWrite, background_tasks: BackgroundTasks, db: Session = Depends(get_db)) -> dict:
    """Retry explicitly selected problem rows without restarting the batch."""
    _recover_stale_bulk_items(db, batch_id)
    batch = db.get(BulkListingBatchRecord, batch_id)
    if batch is None:
        raise HTTPException(404, "批量刊登任务不存在")
    if _bulk_batch_is_paused(batch):
        raise HTTPException(409, "批次已暂停；请先明确恢复批次后再重试")
    item_ids = list(dict.fromkeys(payload.item_ids))
    items = list(db.scalars(select(BulkListingBatchItemRecord).where(
        BulkListingBatchItemRecord.batch_id == batch_id,
        BulkListingBatchItemRecord.id.in_(item_ids),
    )))
    if len(items) != len(item_ids):
        raise HTTPException(422, "部分商品不属于当前批量任务")
    retryable = {"failed", "needs_review", "waiting_quota", "processing", "prepared", "approved", "skipped"}
    retry_items = [item for item in items if item.status in retryable]
    skipped_items = [item for item in items if item.status not in retryable]
    # Selection is an independent table action: operators may select every
    # visible row, including already imported/submitted rows.  Only truly
    # retryable rows are requeued; the rest remain untouched and are reported
    # back instead of making the whole batch action fail.
    for item in retry_items:
        item.status = "queued"
        item.error_message = None
    if retry_items:
        batch.status = "running"
    db.commit()
    if retry_items:
        background_tasks.add_task(_run_bulk_listing_pilot, batch_id, len(retry_items), True, payload.actor_id, [item.id for item in retry_items])
    return {
        "batch_id": batch_id,
        "status": "running" if retry_items else batch.status,
        "queued_count": len(retry_items),
        "skipped_count": len(skipped_items),
        "queued_item_ids": [item.id for item in retry_items],
        "unchanged_item_ids": [item.id for item in skipped_items],
    }


@router.post("/bulk-listing-batches/{batch_id}/items/{item_id}/skip")
def skip_bulk_listing_item(batch_id: int, item_id: int, db: Session = Depends(get_db)) -> dict:
    batch = db.get(BulkListingBatchRecord, batch_id)
    if batch is None:
        raise HTTPException(404, "批量刊登任务不存在")
    item = db.get(BulkListingBatchItemRecord, item_id)
    if item is None or item.batch_id != batch_id:
        raise HTTPException(404, "批量商品不存在")
    if item.status not in {"failed", "needs_review", "waiting_quota"}:
        raise HTTPException(422, "当前状态不能归档")
    item.status = "skipped"
    item.error_message = item.error_message or "已归档"
    _reconcile_bulk_batch_state(db, batch_id)
    return {"batch_id": batch_id, "item_id": item_id, "status": "skipped"}


@router.post("/bulk-listing-batches/{batch_id}/approve-prepared")
def approve_prepared_bulk_items(batch_id: int, payload: BulkListingApproveWrite, db: Session = Depends(get_db)) -> dict:
    """Approve selected local drafts and create one publish queue per shop.

    This endpoint is local-only.  It never calls an Ozon write API; real
    submission remains behind /approval-batches/{id}/submit confirmed=true.
    """
    if not payload.confirmed:
        raise HTTPException(422, "批量批准必须 confirmed=true；批准不会立即提交Ozon")
    batch = db.get(BulkListingBatchRecord, batch_id)
    if batch is None:
        raise HTTPException(404, "批量刊登任务不存在")
    if batch.status == "paused_quality_audit":
        raise HTTPException(409,"该批次因草稿质量审计暂停，复核通过前禁止继续上传")
    ids = list(dict.fromkeys(payload.item_ids))
    items = list(db.scalars(select(BulkListingBatchItemRecord).where(
        BulkListingBatchItemRecord.batch_id == batch_id,
        BulkListingBatchItemRecord.id.in_(ids),
    ).order_by(BulkListingBatchItemRecord.id)))
    if len(items) != len(ids):
        raise HTTPException(422, "部分所选商品不属于当前批量任务")
    invalid = [item.id for item in items if item.status != "prepared" or not item.listing_draft_id or not item.candidate_id]
    if invalid:
        raise HTTPException(422, {"message": "只有已准备且存在草稿的商品可以批准", "item_ids": invalid})
    integrity={item.id:_bulk_draft_integrity_issues(db,item) for item in items}
    integrity={item_id:issues for item_id,issues in integrity.items() if issues}
    if integrity:
        raise HTTPException(422,{"message":"草稿完整性未通过，已阻止上传","items":integrity})
    grouped: dict[int, list[BulkListingBatchItemRecord]] = {}
    for item in items:
        grouped.setdefault(item.assigned_shop_id, []).append(item)
    approval_batches: list[dict] = []
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    for shop_id, group in grouped.items():
        candidate_ids: list[int] = []
        for item in group:
            candidate = db.get(AutomationCandidateRecord, item.candidate_id)
            pipeline = db.scalar(select(PipelineProductRecord).where(
                PipelineProductRecord.shop_id == shop_id,
                PipelineProductRecord.source_product_id == item.source_product_id,
            ))
            if candidate is None or pipeline is None or pipeline.listing_draft_id != item.listing_draft_id:
                raise HTTPException(422, f"商品 {item.id} 缺少与分配店铺一致的可审批草稿")
            candidate.shop_id = shop_id
            candidate.source_record_id = item.source_product_id
            candidate.status = "approved"
            candidate.rejection_reason = None
            pipeline.publish_status = "approved"
            pipeline.pipeline_stage = "approved"
            item.status = "approved"
            candidate_ids.append(candidate.id)
        approval = AutomationApprovalBatchRecord(
            shop_id=shop_id,
            name=f"批量刊登 #{batch.id} {batch.name} · {now.strftime('%m-%d %H:%M')}",
            candidate_ids_json=json.dumps(candidate_ids), item_count=len(candidate_ids), status="approved",
            approved_by=payload.approver_id, approved_at=now,
        )
        db.add(approval); db.flush()
        approval_batches.append({"id": approval.id, "shop_id": shop_id, "item_count": len(candidate_ids), "status": approval.status})
        db.add(AuditEventRecord(shop_id=shop_id, actor_id=payload.approver_id,
            action="bulk_listing_items_approved", entity_type="bulk_listing_batch", entity_id=str(batch.id),
            details_json=json.dumps({"approval_batch_id": approval.id, "item_ids": [item.id for item in group],
                                    "candidate_ids": candidate_ids, "count": len(group)}, ensure_ascii=False)))
    db.flush()
    counts = dict(db.execute(select(BulkListingBatchItemRecord.status, func.count(BulkListingBatchItemRecord.id)).where(
        BulkListingBatchItemRecord.batch_id == batch_id,
    ).group_by(BulkListingBatchItemRecord.status)).all())
    batch.prepared_count = int(counts.get("prepared", 0))
    batch.needs_review_count = int(counts.get("needs_review", 0))
    db.commit()
    return {"batch_id": batch.id, "approved": len(items), "approval_batches": approval_batches,
            "next_step": "在审批发布页面明确确认后提交Ozon"}


def _run_bulk_listing_pilot(batch_id: int, max_items: int, submit_after_prepare: bool = False, actor_id: str = "operator", item_ids: list[int] | None = None, shop_id_filter: int | None = None) -> None:
    """Run the existing per-product listing chain, optionally submitting each completed item."""
    db = SessionLocal()
    try:
        _recover_stale_bulk_items(db, batch_id)
        batch = db.get(BulkListingBatchRecord, batch_id)
        if batch is None:
            return
        # A persisted operator/quality pause is a hard stop for this worker.
        # Do this before selecting rows so an explicitly selected retry cannot
        # use ``item_ids`` to bypass the pause.
        if _bulk_batch_is_paused(batch):
            db.commit()
            return
        rules = json.loads(batch.rules_json or "{}")
        if "pricing_mode_system" not in rules:
            # Never infer a pricing mode for legacy batches.  The old default
            # could silently replace a fixed 26 CNY price with system pricing.
            batch.status = "paused_quality_audit"
            batch.needs_review_count = max(1, int(batch.needs_review_count or 0))
            db.commit()
            return
        fixed = {str(row.get("attribute_id")): row for row in rules.get("attributes", [])}
        eligible_statuses = ["queued"] if not submit_after_prepare else ["queued", "prepared", "failed"]
        shop_capacity: dict[int, int] = {}
        eligible_shop_ids: set[int] = set()
        if submit_after_prepare:
            # Read every target shop before selecting rows.  Selecting by item
            # id first allowed a full-quota shop to occupy the whole batch
            # window while later shops with capacity were left untouched.
            target_shop_ids = [int(shop_id) for shop_id in (json.loads(batch.target_shop_ids_json or "[]") or [])]
            if not target_shop_ids:
                target_shop_ids = list(db.scalars(select(BulkListingBatchItemRecord.assigned_shop_id).where(
                    BulkListingBatchItemRecord.batch_id == batch_id,
                    BulkListingBatchItemRecord.assigned_shop_id.is_not(None),
                ).distinct()))
            for shop_id in target_shop_ids:
                shop_capacity[shop_id] = int(_shop_upload_capacity(db, shop_id)["remaining"])
                if shop_capacity[shop_id] > 0:
                    eligible_shop_ids.add(shop_id)
            if not eligible_shop_ids and not item_ids:
                # No shop can accept a create right now.  Freeze all local
                # work that has not crossed the Ozon boundary and let the
                # scheduler resume after the quota reset, instead of cycling
                # through the same first window forever.
                pending = list(db.scalars(select(BulkListingBatchItemRecord).where(
                    BulkListingBatchItemRecord.batch_id == batch_id,
                    BulkListingBatchItemRecord.status.in_(eligible_statuses),
                    BulkListingBatchItemRecord.ozon_task_id.is_(None),
                )))
                for row in pending:
                    row.status = "waiting_quota"
                    row.error_message = "所有目标店铺当前 Ozon 创建额度已满，等待额度恢复后自动切换继续"
                batch.status = "waiting_quota"
                db.commit()
                return
        item_query = select(BulkListingBatchItemRecord).where(
            BulkListingBatchItemRecord.batch_id == batch_id,
            BulkListingBatchItemRecord.ozon_task_id.is_(None),
        )
        # Automatic continuation must skip full shops before taking the
        # window.  An explicit single-item retry remains allowed to report
        # that item's own shop as waiting_quota below.
        if submit_after_prepare and eligible_shop_ids and not item_ids:
            item_query = item_query.where(BulkListingBatchItemRecord.assigned_shop_id.in_(eligible_shop_ids))
        if item_ids:
            item_query = item_query.where(BulkListingBatchItemRecord.id.in_(item_ids))
        if shop_id_filter is not None:
            item_query = item_query.where(BulkListingBatchItemRecord.assigned_shop_id == shop_id_filter)
        # Queue-first selection.  Historical failed rows (older, smaller id)
        # must not starve un-attempted queued/prepared candidates: the old
        # single ``order_by(id)`` let every failed row claim the whole window
        # and cycle to its retry cap before a single queued item was processed.
        # Failed rows are only back-filled after the primary window is full,
        # and only while attempts < 3, so rows that already hit their retry
        # cap stop cycling forever.
        if item_ids:
            items = list(db.scalars(item_query.order_by(BulkListingBatchItemRecord.id).limit(max_items)))
        elif submit_after_prepare:
            primary = list(db.scalars(item_query.where(
                BulkListingBatchItemRecord.status.in_(["queued", "prepared"]),
            ).order_by(BulkListingBatchItemRecord.id).limit(max_items)))
            if len(primary) < max_items:
                backfill = list(db.scalars(item_query.where(
                    BulkListingBatchItemRecord.status == "failed",
                    BulkListingBatchItemRecord.attempts < 3,
                ).order_by(BulkListingBatchItemRecord.id).limit(max_items - len(primary))))
                primary.extend(backfill)
            items = primary
        else:
            items = list(db.scalars(item_query.where(
                BulkListingBatchItemRecord.status.in_(["queued"]),
            ).order_by(BulkListingBatchItemRecord.id).limit(max_items)))
        if batch.status == "paused_quality_audit":
            # A quality pause is authoritative.  Do not turn it into a
            # resumable state merely because this worker reached its epilogue.
            db.commit()
        elif submit_after_prepare:
            # Capacities were read before the query so selection and the
            # per-row guard use the same snapshot for this worker turn.
            pass
        for current in items:
            item_id = current.id
            try:
                # A quality pause must stop the worker between products.  The
                # previous worker only checked the batch before selecting its
                # work list, so a pause could still drain the whole list.
                live_batch = db.get(BulkListingBatchRecord, batch_id)
                if live_batch is None or _bulk_batch_is_paused(live_batch):
                    db.rollback()
                    break
                # Do not spend time regenerating a product once this shop's
                # live daily-create allowance is exhausted. Its remaining
                # rows wait while the round-robin queue continues for other
                # shops.
                if submit_after_prepare and shop_capacity.get(current.assigned_shop_id, 0) <= 0:
                    current.status = "waiting_quota"
                    current.error_message = "该店铺 Ozon 当日创建额度已用完，其他店铺继续处理"
                    db.commit()
                    continue
                current.status = "processing"; current.attempts += 1; current.error_message = None
                db.commit()
                pipeline = lock_category(db, current.assigned_shop_id, current.source_product_id, str(rules["category_id"]), str(rules["type_id"]))
                map_attributes(db, current.assigned_shop_id, current.source_product_id)
                mapping = json.loads(pipeline.attribute_mapping_json or "[]")
                for attr in mapping:
                    selected = fixed.get(str(attr.get("attribute_id")))
                    if selected:
                        attr.update({"matched": True, "value_id": selected.get("value_id"), "value_text": selected.get("value_text"), "matched_source": "bulk_rule"})
                pipeline.attribute_mapping_json = json.dumps(mapping, ensure_ascii=False); db.commit()
                map_variants(db, current.assigned_shop_id, current.source_product_id)
                variant_data = json.loads(pipeline.variant_mapping_json or "{}")
                variants = variant_data.get("variants") or []
                parent_offer_id = str((variants[0] if variants else {}).get("seller_sku") or "").strip()
                # Reuse the editor's established rule: model name is the
                # product-card/parent Offer ID.  This is an Ozon attribute,
                # not a barcode, and does not change SKU generation.
                mapping = json.loads(pipeline.attribute_mapping_json or "[]")
                for attr in mapping:
                    name = str(attr.get("name") or "").lower()
                    if str(attr.get("attribute_id")) == "9048" or "型号名称" in name or "название модели" in name:
                        attr.update({"matched": bool(parent_offer_id), "value_id": None,
                                     "value_text": parent_offer_id or None, "matched_source": "derived_offer_id"})
                pipeline.attribute_mapping_json = json.dumps(mapping, ensure_ascii=False)
                pipeline.attribute_coverage = round(sum(1 for attr in mapping if attr.get("matched")) / len(mapping) * 100, 2) if mapping else 0
                ocr_evidence = []
                ocr_summary = {}
                if rules.get("ocr_remove_chinese_size_weight") or rules.get("ocr_remove_marketing_images") or rules.get("translate_product_images"):
                    media_for_ocr = []
                    seen_urls = set()
                    for item in variant_data.get("media") or []:
                        url = str(item.get("url") or "").strip()
                        if url.startswith(("http://", "https://")) and url not in seen_urls:
                            seen_urls.add(url)
                            media_for_ocr.append(dict(item))
                    for var in variants:
                        url = str(var.get("image_url") or "").strip()
                        if url.startswith(("http://", "https://")) and url not in seen_urls:
                            seen_urls.add(url)
                            media_for_ocr.append({"url": url, "type": "variant", "source_sku": var.get("source_sku")})
                    kept_media, ocr_evidence, translatable_urls = filter_bulk_images(
                        media_for_ocr,
                        remove_chinese_measure=bool(rules.get("ocr_remove_chinese_size_weight")),
                        remove_marketing=bool(rules.get("ocr_remove_marketing_images")),
                    )
                    # SKU images stay on their variant rows and never count
                    # toward Ozon's 15-image shared/public-gallery limit.
                    kept_urls = {str(item.get("url") or "").strip() for item in kept_media if str(item.get("url") or "").strip()}
                    public_kept_media = [item for item in kept_media if item.get("type") != "variant" and str(item.get("url") or "").strip().startswith(("http://", "https://"))][:15]
                    public_urls = [str(item.get("url") or "").strip() for item in public_kept_media]
                    variant_urls = [str(var.get("image_url") or "").strip() for var in variants if str(var.get("image_url") or "").strip().startswith(("http://", "https://"))]
                    primary_image_url = public_urls[0] if public_urls else (variant_urls[0] if variant_urls else "")
                    variant_data["media"] = public_kept_media
                    variant_data["media_count"] = len(public_kept_media)
                    variant_data["primary_image_url"] = primary_image_url
                    for var in variants:
                        image_url = str(var.get("image_url") or "").strip()
                        if not image_url:
                            var["image_url"] = primary_image_url
                    translation_map = {}
                    translation_failures = []
                    valid_urls: list[str] = []
                    if rules.get("translate_product_images") and translatable_urls:
                        from .main import ImageTranslateRequest, translate_images
                        valid_urls = [url for url in translatable_urls if url.startswith(("http://", "https://"))]
                        for offset in range(0, len(valid_urls), 20):
                            batch = valid_urls[offset:offset + 20]
                            try:
                                result = translate_images(ImageTranslateRequest(urls=batch))
                            except Exception as translate_exc:
                                translation_failures.extend({"url": url, "error": str(translate_exc)[:500]} for url in batch)
                                continue
                            for row in result.get("results") or []:
                                source_url = str(row.get("source_url") or "")
                                translated_url = str(row.get("translated_url") or "")
                                if translated_url.startswith(("http://", "https://")):
                                    translation_map[source_url] = translated_url
                                else:
                                    translation_failures.append({"url": source_url, "error": str(row.get("error") or "翻译服务未返回可用图片地址")[:500]})
                        if translation_map:
                            for item in variant_data.get("media") or []:
                                item_url = str(item.get("url") or "")
                                if item_url in translation_map:
                                    item["url"] = translation_map[item_url]
                            if variant_data.get("primary_image_url") in translation_map:
                                variant_data["primary_image_url"] = translation_map[variant_data["primary_image_url"]]
                            for var in variants:
                                image_url = str(var.get("image_url") or "")
                                if image_url in translation_map:
                                    var["image_url"] = translation_map[image_url]
                    excluded = [row for row in ocr_evidence if row.get("excluded")]
                    ocr_summary = {
                        "source_product_id": current.source_product_id,
                        "total_count": len(media_for_ocr),
                        "excluded_count": len(excluded),
                        "marketing_excluded_count": sum(1 for row in excluded if "marketing" in (row.get("reasons") or [])),
                        "chinese_measure_excluded_count": sum(1 for row in excluded if "chinese_measure" in (row.get("reasons") or [])),
                        "ocr_failed_count": sum(1 for row in ocr_evidence if row.get("error")),
                        "translatable_count": len(translatable_urls),
                        "translation": {"requested": len(valid_urls), "success": len(translation_map), "failed": len(translation_failures)},
                        "translation_failures": translation_failures[:20],
                        "images": ocr_evidence,
                    }
                    pipeline.variant_mapping_json = json.dumps(variant_data, ensure_ascii=False)
                    if not primary_image_url:
                        current.status = "needs_review"
                        current.error_message = "OCR过滤后没有可用于刊登的图片，请人工复核"
                        db.add(AuditEventRecord(
                            shop_id=current.assigned_shop_id, actor_id="system", action="bulk_listing_local_ocr",
                            entity_type="bulk_listing_batch_item", entity_id=str(current.id),
                            details_json=json.dumps(ocr_summary, ensure_ascii=False),
                        ))
                        db.commit()
                        continue
                db.commit()
                # Content is a durable part of the pipeline snapshot.  A
                # retry/restart must not call the LLM again for a title and
                # description that were already generated successfully: it
                # wastes minutes, can change approved text, and blocks the
                # next direct Ozon submission.  Only a genuinely new row
                # without either field needs the AI generation step.
                if not _has_publishable_generated_content(pipeline):
                    generate_content(db, current.assigned_shop_id, current.source_product_id)
                if not _has_publishable_generated_content(pipeline):
                    current.status = "needs_review"
                    current.error_message = "AI 文案未生成可发布的俄文标题和描述，已阻止提交 Ozon 并将在下一次自动重试"
                    db.commit()
                    continue
                source_variants = list(db.scalars(select(SourceVariantRecord).where(
                    SourceVariantRecord.source_product_id == current.source_product_id,
                )))
                fixed_weight = Decimal(str(rules.get("weight_g")))
                fixed_dims = (Decimal(str(rules.get("length_mm"))), Decimal(str(rules.get("width_mm"))), Decimal(str(rules.get("height_mm"))))
                internal_cost = Decimal(str(rules.get("internal_cost_cny") or 0))
                pricing_variants = source_variants
                if internal_cost > 0:
                    policy = get_pricing_policy(db)
                    adjusted_cost = max(Decimal("0"), internal_cost - Decimal(str(policy.purchase_buffer_cny or 0)))
                    pricing_variants = [_BulkPricingVariant(str(v.source_sku), str(v.spec_name or ""), adjusted_cost, int(v.stock or 0)) for v in source_variants]
                pricing = _compute_pricing(
                    db, current.assigned_shop_id, current.source_product_id, pricing_variants,
                    weight_g=fixed_weight, dims=fixed_dims, dimension_source=DimensionSource.MANUAL_MEASURED,
                )
                pricing["_extracted_weight_g"] = float(fixed_weight)
                pricing["_extracted_dimensions_mm"] = [float(d) for d in fixed_dims]
                pipeline.pricing_json = json.dumps(pricing, ensure_ascii=False)
                quality = run_quality_check(db, current.assigned_shop_id, current.source_product_id)
                draft = create_listing_draft_from_pipeline(db, current.assigned_shop_id, current.source_product_id)
                draft.source_product_id = current.source_product_id
                draft.category_id = pipeline.matched_category_id
                draft.type_id = pipeline.matched_type_id
                draft.title = pipeline.generated_title_ru or draft.title
                draft.description = pipeline.generated_description_ru
                for variant in list(draft.variants):
                    mapped = next((row for row in variants if str(row.get("seller_sku") or "") == str(variant.seller_sku or "")), {})
                    system_pricing = next((row for row in pricing.get("variants", []) if row.get("source_sku") == mapped.get("source_sku")), {})
                    variant.purchase_cost_cny = internal_cost if internal_cost > 0 else system_pricing.get("purchase_cost_cny")
                    variant.weight_g = fixed_weight
                    variant.length_mm = fixed_dims[0]
                    variant.width_mm = fixed_dims[1]
                    variant.height_mm = fixed_dims[2]
                    if rules["pricing_mode_system"]:
                        if not system_pricing.get("price_cny"):
                            raise ValueError(system_pricing.get("error") or "系统定价未返回可用价格")
                        variant.calculated_price_cny = system_pricing.get("price_cny")
                        variant.price_cny = system_pricing.get("price_cny")
                        variant.old_price_cny = system_pricing.get("old_price_cny")
                        variant.min_price_cny = str(system_pricing.get("min_price_cny") or "")
                    else:
                        variant.calculated_price_cny = rules.get("sale_price_cny")
                        variant.price_cny = rules.get("sale_price_cny")
                        variant.old_price_cny = rules.get("old_price_cny")
                        variant.min_price_cny = str(rules.get("min_price_cny"))
                    variant.stock = int(rules.get("stock", 999))
                if not rules.get("use_original_video"):
                    draft.video_url = None
                current.listing_draft_id = draft.id
                # The listing draft is the authoritative post-import stock
                # snapshot.  Persist its price, dimensions and target stock
                # before optional preflight work: a preflight rollback must
                # never erase the 999 stock target and leave Ozon at zero.
                db.commit()
                issues = quality.get("issues") or []
                issues=[*issues,*({"field":"draft","message":message} for message in _bulk_draft_integrity_issues(db,current))]
                ocr_failures = [row for row in ocr_evidence if row.get("error")]
                if ocr_failures:
                    # OCR engine failure (e.g. a missing Windows OCR language
                    # pack) is NOT evidence of a violation: the images are kept
                    # and submitted.  Only a real text match is a blocker.  An
                    # unavailable OCR stack therefore surfaces as a review hint
                    # instead of stalling the whole batch in needs_review.
                    issues = [*issues, {"code": "ocr_hint", "field": "media",
                        "message": f"本地OCR有 {len(ocr_failures)} 张识别失败，图片已保留（仅提示人工复核，不阻断提交）"}]
                if ocr_summary:
                    db.add(AuditEventRecord(
                        shop_id=current.assigned_shop_id, actor_id="system", action="bulk_listing_local_ocr",
                        entity_type="bulk_listing_batch_item", entity_id=str(current.id),
                        details_json=json.dumps(ocr_summary, ensure_ascii=False),
                    ))
                # Ozon 质量预检：自动修复已知错误类型
                try:
                    from .quality_preflight import run_quality_preflight, record_preflight_results
                    draft_obj = db.get(ListingDraftRecord, current.listing_draft_id)
                    if draft_obj:
                        pf_result = run_quality_preflight(db, draft_obj, batch_id=batch.id, auto_fix=True)
                        if pf_result["fixed"]:
                            record_preflight_results(db, draft_obj, pf_result, batch_id=batch.id)
                            pf_fixed = pf_result["fixable_count"]
                            issues = [i for i in issues if not isinstance(i, dict) or i.get("code") != "preflight_fixed"]
                            if pf_fixed:
                                issues.append({"code": "preflight_fixed",
                                              "message": f"质量预检自动修复 {pf_fixed} 项（{', '.join(x['action'] for x in pf_result['issues_fixed'][:3])}）"})
                        for preflight_issue in pf_result["issues_remaining"]:
                            # 20–30 个标签是生成质量目标；只要至少有可用标签，
                            # 不能因少一两个而阻断提交。
                            if preflight_issue.get("error_code") == "hashtag_empty":
                                continue
                            issues.append({
                                "code": "quality_preflight_blocked",
                                "field": preflight_issue.get("error_field") or "content",
                                "message": "提交前质量门禁：" + str(preflight_issue.get("description") or "内容不符合发布规则"),
                            })
                except Exception as pf_exc:
                    # A preflight failure must not allow a submission, but PostgreSQL
                    # marks the whole transaction failed after any SQL error.
                    # Never swallow that error and then misreport the later
                    # OCR audit INSERT as ``InFailedSqlTransaction``.
                    db.rollback()
                    current = db.get(BulkListingBatchItemRecord, item_id)
                    # ``current.listing_draft_id`` was assigned in this unit
                    # of work and is therefore reverted by the rollback.  The
                    # draft itself was committed by the draft creator; recover
                    # its durable relation from the pipeline record.
                    pipeline_after_rollback = db.scalar(select(PipelineProductRecord).where(
                        PipelineProductRecord.shop_id == current.assigned_shop_id,
                        PipelineProductRecord.source_product_id == current.source_product_id,
                    )) if current else None
                    restored_draft_id = pipeline_after_rollback.listing_draft_id if pipeline_after_rollback else None
                    draft = db.get(ListingDraftRecord, restored_draft_id) if restored_draft_id else None
                    if current is None or draft is None:
                        raise RuntimeError("质量预检回滚后找不到当前批量草稿")
                    current.listing_draft_id = draft.id
                    issues.append({
                        "code": "quality_preflight_failed",
                        "field": "content",
                        "message": f"提交前质量门禁执行失败，已转人工复核：{str(pf_exc)[:300]}",
                    })

                # Separate blocking errors from non-blocking warnings
                blocking_issues = []
                warning_msgs = []
                for issue in issues:
                    msg = str(issue.get("message") or issue) if isinstance(issue, dict) else str(issue)
                    code = issue.get("code", "") if isinstance(issue, dict) else ""
                    field = issue.get("field", "") if isinstance(issue, dict) else ""
                    is_warning = (
                        code == "preflight_fixed"
                        or code == "ocr_hint"
                        or (field == "media" and "recommended" in msg.lower())
                    )
                    if is_warning:
                        warning_msgs.append(msg)
                    else:
                        blocking_issues.append(issue)
                current.status = "needs_review" if blocking_issues else "queued"
                all_msgs = [str(i.get("message") or i) if isinstance(i, dict) else str(i) for i in blocking_issues[:5]]
                if warning_msgs:
                    all_msgs.append("[提示] " + "；".join(warning_msgs[:2]))
                current.error_message = "；".join(all_msgs) if all_msgs else None
                db.commit()
                if submit_after_prepare and not blocking_issues:
                    if shop_capacity.get(current.assigned_shop_id, 0) <= 0:
                        current.status = "waiting_quota"
                        current.error_message = "目标店铺今日Ozon创建额度已用完，等待额度恢复后继续"
                        db.commit()
                        continue
                    # Serialize the final pause check with the pause endpoint.
                    # Without the shared lock, an operator could persist a
                    # pause after this worker's read but before the external
                    # submit call, making a paused batch send one more item.
                    pause_lock = _bulk_start_lock(batch_id)
                    pause_lock.acquire()
                    try:
                        live_batch = db.get(BulkListingBatchRecord, batch_id)
                        if live_batch is None:
                            raise RuntimeError("批量任务不存在")
                        if _bulk_batch_is_paused(live_batch):
                            current.status = "prepared"
                            current.error_message = "批次已暂停，等待明确恢复后再提交 Ozon"
                            db.commit()
                            continue
                        pipeline.publish_status = "approved"
                        pipeline.pipeline_stage = "approved"
                        candidate = db.get(AutomationCandidateRecord, current.candidate_id) if current.candidate_id else None
                        if candidate:
                            candidate.shop_id = current.assigned_shop_id
                            candidate.source_record_id = current.source_product_id
                            candidate.status = "approved"
                            candidate.rejection_reason = None
                        db.commit()
                        result = submit_to_ozon(db, current.assigned_shop_id, current.source_product_id, actor_id)
                        if result.get("status") != "submitted":
                            raise RuntimeError(str(result.get("error") or "Ozon未返回submitted状态"))
                        current.status = "submitted"
                        current.ozon_task_id = result.get("task_id")
                        current.error_message = None
                        _queue_draft_stock_sync(db, current.listing_draft_id, result.get("task_id"))
                        if candidate:
                            candidate.status = "submitted"
                        shop_capacity[current.assigned_shop_id] = max(0, shop_capacity[current.assigned_shop_id] - 1)
                        db.commit()
                    finally:
                        pause_lock.release()
            except Exception as exc:
                db.rollback()
                failed = db.get(BulkListingBatchItemRecord, item_id)
                if failed:
                    err_msg = str(exc)
                    err_lower = err_msg.lower()
                    pause_reason = _systemic_batch_pause_reason(err_msg)
                    if pause_reason:
                        failed.status = "queued"
                        failed.error_message = pause_reason
                        live_batch = db.get(BulkListingBatchRecord, batch_id)
                        if live_batch is not None:
                            live_batch.status = "paused"
                        db.commit()
                        break
                    # Daily creation quota — wait until next day, do NOT keep retrying
                    is_quota = _is_quota_error(err_msg)
                    # Transient errors — safe to retry automatically
                    transient_markers = [
                        "database is locked", "timeout", "connection reset",
                        "temporarily", "service unavailable", "http 5",
                        "rate limit reached", "429",
                    ]
                    is_transient = any(m in err_lower for m in transient_markers)
                    if is_quota and submit_after_prepare:
                        failed.status = "waiting_quota"
                        failed.error_message = f"Ozon创建额度已满，等待恢复后续传：{err_msg[:500]}"
                        shop_capacity[failed.assigned_shop_id] = 0
                    elif is_transient:
                        failed.status = "queued"
                        failed.error_message = f"临时错误，将自动重试：{err_msg[:500]}"
                    else:
                        failed.status = "failed"
                        failed.error_message = err_msg[:2000]
                    db.commit()
        batch = db.get(BulkListingBatchRecord, batch_id)
        counts = dict(db.execute(select(BulkListingBatchItemRecord.status, func.count(BulkListingBatchItemRecord.id)).where(
            BulkListingBatchItemRecord.batch_id == batch_id,
        ).group_by(BulkListingBatchItemRecord.status)).all())
        batch.prepared_count = int(counts.get("prepared", 0))
        batch.needs_review_count = int(counts.get("needs_review", 0))
        batch.failed_count = int(counts.get("failed", 0))
        batch.submitted_count = int(counts.get("submitted", 0)) + int(counts.get("imported", 0))
        batch.succeeded_count = int(counts.get("imported", 0))
        # A pause can arrive while this worker is between items.  It is an
        # operator safety command, so the worker epilogue must not turn it
        # back into a resumable/running state merely because queued rows are
        # still present.
        if batch.status in {"paused_quality_audit", "paused"}:
            db.commit()
            return
        if submit_after_prepare:
            if counts.get("processing", 0):
                batch.status = "running"
            elif counts.get("waiting_quota", 0) and not (counts.get("queued", 0) or counts.get("prepared", 0) or counts.get("approved", 0)):
                batch.status = "waiting_quota"
            elif counts.get("queued", 0) or counts.get("prepared", 0) or counts.get("approved", 0):
                batch.status = "ready_to_continue"
            elif counts.get("needs_review", 0) or counts.get("failed", 0):
                batch.status = "paused_quality_audit" if item_ids else "needs_review"
            else:
                batch.status = "submitted"
        else:
            if counts.get("needs_review", 0) or counts.get("failed", 0):
                batch.status = "needs_review"
            else:
                batch.status = "ready_to_continue"
        db.commit()
    finally:
        db.close()


@router.post("/bulk-listing-batches/{batch_id}/start")
def start_bulk_listing_batch(batch_id: int, payload: BulkListingBatchStart, background_tasks: BackgroundTasks, db: Session = Depends(get_db)) -> dict:
    batch = db.get(BulkListingBatchRecord, batch_id)
    if batch is None:
        raise HTTPException(404, "批量刊登任务不存在")
    lock = _bulk_start_lock(batch_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(409, "任务正在启动，请勿重复点击")
    try:
        if batch.status == "running":
            raise HTTPException(409, "任务正在预处理")
        if _bulk_batch_is_paused(batch):
            raise HTTPException(409, "批次已暂停；请先明确恢复批次后再开始")
        queued = db.scalar(select(func.count(BulkListingBatchItemRecord.id)).where(BulkListingBatchItemRecord.batch_id == batch_id, BulkListingBatchItemRecord.status == "queued")) or 0
        if not queued:
            raise HTTPException(422, "没有等待预处理的商品")
        batch.status = "running"; db.commit()
        background_tasks.add_task(_run_bulk_listing_pilot, batch_id, min(payload.max_items, queued))
        return {"batch_id": batch_id, "status": "running", "started_items": min(payload.max_items, queued), "remaining_queued": queued}
    finally:
        lock.release()


@router.post("/bulk-listing-batches/{batch_id}/pause")
def pause_bulk_listing_batch(batch_id: int, db: Session = Depends(get_db)) -> dict:
    """Persist an operator pause; no new item is retried or submitted.

    The worker checks this state between products and again during its
    epilogue.  A product already inside an external Ozon request may finish
    that request, but the next product cannot be claimed.  Ozon feedback and
    stock-monitor workers are independent and continue to reconcile already
    submitted products.
    """
    lock = _bulk_start_lock(batch_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(409, "任务正在启动，请稍后再点暂停")
    try:
        batch = db.get(BulkListingBatchRecord, batch_id)
        if batch is None:
            raise HTTPException(404, "批量刊登任务不存在")
        if batch.status == "submitted":
            raise HTTPException(409, "批次已完成，不能暂停")
        # Keep a structural quality gate visible as “需处理”; a manual pause
        # must not erase the reason that requires correction before resubmission.
        if batch.status == "paused_quality_audit":
            return {"batch_id": batch_id, "status": batch.status, "message": "批次已因质量问题暂停，请先处理明细中的问题"}
        if batch.status == "paused":
            return {"batch_id": batch_id, "status": batch.status, "message": "批次已经暂停"}
        batch.status = "paused"
        target_shop_ids = json.loads(batch.target_shop_ids_json or "[]")
        audit_shop_id = int(target_shop_ids[0]) if target_shop_ids else db.scalar(select(BulkListingBatchItemRecord.assigned_shop_id).where(
            BulkListingBatchItemRecord.batch_id == batch_id,
            BulkListingBatchItemRecord.assigned_shop_id.is_not(None),
        ))
        if audit_shop_id is None:
            raise HTTPException(422, "批次没有可记录审计的目标店铺")
        db.add(AuditEventRecord(
            shop_id=audit_shop_id, actor_id="operator", action="bulk_listing_batch_paused",
            entity_type="bulk_listing_batch", entity_id=str(batch_id),
            details_json=json.dumps({"reason": "operator_requested"}, ensure_ascii=False),
        ))
        db.commit()
        processing_count = db.scalar(select(func.count(BulkListingBatchItemRecord.id)).where(
            BulkListingBatchItemRecord.batch_id == batch_id,
            BulkListingBatchItemRecord.status == "processing",
        )) or 0
        return {"batch_id": batch_id, "status": batch.status,
                "processing_count": int(processing_count),
                "message": "批次已暂停；不会继续生成或提交新商品，已提交商品的回执和库存监控仍会继续"}
    finally:
        lock.release()


@router.post("/bulk-listing-batches/{batch_id}/execute")
def execute_bulk_listing_batch(batch_id: int, payload: BulkListingExecute, background_tasks: BackgroundTasks, db: Session = Depends(get_db)) -> dict:
    """One operator confirmation starts the existing generate→draft→submit chain."""
    if not payload.confirmed:
        raise HTTPException(422, "真实批量提交Ozon必须 confirmed=true")
    batch = db.get(BulkListingBatchRecord, batch_id)
    if batch is None:
        raise HTTPException(404, "批量刊登任务不存在")
    # Allow resuming from quality pause: worker re-checks pricing internally.
    # Ozon feedback on already-imported items must not block the rest.
    lock = _bulk_start_lock(batch_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(409, "任务正在启动，请勿重复点击")
    try:
        # The persisted running state is the cross-request idempotency gate.
        # Check it before any recovery write so a double click cannot queue a
        # second worker while the first request is between response and start.
        if batch.status == "running":
            raise HTTPException(409, "任务正在处理，请勿重复提交")
        _recover_stale_bulk_items(db, batch_id)
        _quarantine_submitted_bulk_items(db, batch_id)
        reconcile_bulk_quota_errors(db, batch_id)
        db.refresh(batch)
        if batch.status == "running":
            raise HTTPException(409, "任务正在处理，请勿重复提交")
        # A historical periodic_limit_exceeded is evidence, not a permanent
        # lock.  Before an operator resumes, re-read every target shop's live
        # Ozon limit.  This prevents an old local timestamp from hiding the
        # continue action after Ozon has already restored the quota.
        shop_ids = set(db.scalars(select(BulkListingBatchItemRecord.assigned_shop_id).where(
            BulkListingBatchItemRecord.batch_id == batch_id,
            BulkListingBatchItemRecord.assigned_shop_id.is_not(None),
        )))
        capacities = {shop_id: _shop_upload_capacity(db, shop_id) for shop_id in shop_ids}
        resumable_shops = {shop_id for shop_id, capacity in capacities.items() if int(capacity.get("remaining") or 0) > 0}
        if not resumable_shops:
            batch.status = "waiting_quota"
            db.commit()
            raise HTTPException(409, "Ozon 实时额度均不足，等待额度恢复后再继续")
        remaining = db.scalar(select(func.count(BulkListingBatchItemRecord.id)).where(
            BulkListingBatchItemRecord.batch_id == batch_id,
            BulkListingBatchItemRecord.status.in_(["queued", "prepared", "failed", "waiting_quota"]),
            BulkListingBatchItemRecord.ozon_task_id.is_(None),
        )) or 0
        if not remaining:
            raise HTTPException(422, "没有等待处理或提交的商品")
        # Only shops whose live Ozon capacity is positive become eligible.
        # Other shop queues stay untouched in waiting_quota instead of being
        # requeued and immediately producing repeated rejected imports.
        db.query(BulkListingBatchItemRecord).filter(
            BulkListingBatchItemRecord.batch_id == batch_id,
            BulkListingBatchItemRecord.status == "waiting_quota",
            BulkListingBatchItemRecord.ozon_task_id.is_(None),
            BulkListingBatchItemRecord.assigned_shop_id.in_(resumable_shops),
        ).update({BulkListingBatchItemRecord.status: "queued"}, synchronize_session=False)
        batch.status = "running"
        db.commit()
        count = min(payload.max_items, int(remaining))
        # Start one pilot per eligible shop for true 4-shop concurrency.
        # Each pilot runs in its own daemon thread with its own DB session and only
        # processes its own shop's items, so there is no cross-thread DB contention.
        # NOTE: FastAPI BackgroundTasks are serial, so we use threading.Thread directly.
        import threading as _threading
        for _shop_id in sorted(resumable_shops):
            _t = _threading.Thread(
                target=_run_bulk_listing_pilot,
                args=(batch_id, count, True, payload.actor_id, None, _shop_id),
                daemon=True,
                name=f"bulk-pilot-shop-{_shop_id}",
            )
            _t.start()
        return {"batch_id": batch_id, "status": "running", "started_items": count, "remaining": int(remaining),
                "resumed_shop_ids": sorted(resumable_shops), "shop_capacities": capacities}
    finally:
        lock.release()


def _task(row: AutomationTaskRecord, latest_run: AutomationRunRecord | None = None) -> dict:
    filters = json.loads(row.filters_json or "{}")
    return {"id": row.id, "name": row.name, "keywords": json.loads(row.keywords_json or "[]"),
            "excluded_keywords": json.loads(row.excluded_keywords_json or "[]"), "filters": filters,
            "target_shop_ids": filters.get("shop_ids") or [], "category_scope": filters.get("category_scope"),
            "daily_target": row.daily_target, "schedule_time": row.schedule_time, "status": row.status,
            "last_run_at": row.last_run_at, "next_run_at": row.next_run_at,
            "latest_run": ({"id":latest_run.id,"status":latest_run.status,"stage":latest_run.current_stage,
                "discovered":latest_run.discovered_count,"inspected":latest_run.inspected_count,
                "qualified":latest_run.qualified_count,"collected":latest_run.collected_count,
                "failed":latest_run.failed_count,"started_at":latest_run.started_at,
                "finished_at":latest_run.finished_at,"error":latest_run.error_summary} if latest_run else None)}


@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    tasks = list(db.scalars(select(AutomationTaskRecord).where(AutomationTaskRecord.status != "archived").order_by(AutomationTaskRecord.id.desc())))
    latest={task.id:db.scalar(select(AutomationRunRecord).where(AutomationRunRecord.task_id==task.id).order_by(AutomationRunRecord.id.desc()).limit(1)) for task in tasks}
    shops = list(db.scalars(select(Shop).order_by(Shop.id)))
    stages = {stage: db.scalar(select(func.count(PipelineProductRecord.id)).where(PipelineProductRecord.pipeline_stage == stage)) or 0
              for stage in ("ingested", "category_locked", "attributes_mapped", "variants_mapped", "content_generated", "quality_checked", "published")}
    return {
        "global_status": "enabled" if any(t.status == "active" for t in tasks) else "paused",
        "active_run_count":db.scalar(select(func.count(AutomationRunRecord.id)).where(AutomationRunRecord.status=="running")) or 0,
        "tasks": [_task(row,latest[row.id]) for row in tasks],
        "workflow": {"search": db.scalar(select(func.count(AutomationCandidateRecord.id)).where(AutomationCandidateRecord.status.in_(["discovered","detail_pending"]))) or 0,
                     "package": db.scalar(select(func.count(AutomationCandidateRecord.id)).where(AutomationCandidateRecord.status.in_(["package_rejected","filter_rejected","collected"]))) or 0,
                     "ai": db.scalar(select(func.count(AutomationCandidateRecord.id)).where(AutomationCandidateRecord.status.in_(["ai_processing","needs_review","ai_failed","draft_ready"]))) or 0, "image": 0,
                     "approval": db.scalar(select(func.count(ListingDraftRecord.id)).where(ListingDraftRecord.status == "ready_for_approval")) or 0,
                     "published": stages["published"]},
        "shops": [{"id": shop.id, "name": shop.name, "used": db.scalar(select(func.count(AuditEventRecord.id)).where(
                       AuditEventRecord.shop_id == shop.id, AuditEventRecord.action == "pipeline_product_submitted",
                       func.date(AuditEventRecord.created_at) == datetime.now(ZoneInfo("Asia/Shanghai")).date())) or 0,
                   "safe_limit": 180, "platform_limit": 200,
                   "health": "healthy" if shop.is_active else "paused"} for shop in shops],
        "failures": [{"run_id": row.id, "task_id": row.task_id, "stage": row.current_stage,
                      "reason": row.error_summary or f"本次有 {row.failed_count} 个候选未通过",
                      "finished_at": row.finished_at}
                     for row in db.scalars(select(AutomationRunRecord).where(
                         (AutomationRunRecord.status == "failed") | (AutomationRunRecord.failed_count > 0)
                     ).order_by(AutomationRunRecord.id.desc()).limit(8))],
    }


@router.post("/tasks", status_code=201)
def create_task(payload: TaskWrite, db: Session = Depends(get_db)) -> dict:
    filters = payload.model_dump(exclude={"name", "keywords", "excluded_keywords", "daily_target", "schedule_time"})
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    row = AutomationTaskRecord(name=payload.name.strip(), keywords_json=json.dumps(payload.keywords, ensure_ascii=False),
        excluded_keywords_json=json.dumps(payload.excluded_keywords, ensure_ascii=False), filters_json=json.dumps(filters, ensure_ascii=False),
        daily_target=payload.daily_target, schedule_time=payload.schedule_time, status="active",
        next_run_at=_next_schedule_at(payload.schedule_time, now))
    db.add(row); db.commit(); db.refresh(row)
    return _task(row)


def _apply_task(row: AutomationTaskRecord, payload: TaskWrite) -> None:
    filters = payload.model_dump(exclude={"name", "keywords", "excluded_keywords", "daily_target", "schedule_time"})
    now = datetime.now(ZoneInfo("Asia/Shanghai")); next_run = _next_schedule_at(payload.schedule_time, now)
    row.name=payload.name.strip(); row.keywords_json=json.dumps(payload.keywords,ensure_ascii=False)
    row.excluded_keywords_json=json.dumps(payload.excluded_keywords,ensure_ascii=False)
    row.filters_json=json.dumps(filters,ensure_ascii=False); row.daily_target=payload.daily_target
    row.schedule_time=payload.schedule_time; row.next_run_at=next_run


@router.put("/tasks/{task_id}")
def update_task(task_id:int,payload:TaskWrite,db:Session=Depends(get_db))->dict:
    row=db.get(AutomationTaskRecord,task_id)
    if not row: raise HTTPException(404,"自动任务不存在")
    if row.status=="archived": raise HTTPException(409,"已归档任务不能编辑")
    _apply_task(row,payload);db.commit();db.refresh(row);return _task(row)


@router.post("/tasks/{task_id}/copy",status_code=201)
def copy_task(task_id:int,db:Session=Depends(get_db))->dict:
    source=db.get(AutomationTaskRecord,task_id)
    if not source: raise HTTPException(404,"自动任务不存在")
    row=AutomationTaskRecord(name=f"{source.name}（副本）",keywords_json=source.keywords_json,
        excluded_keywords_json=source.excluded_keywords_json,filters_json=source.filters_json,
        daily_target=source.daily_target,schedule_time=source.schedule_time,status="active",
        next_run_at=_next_schedule_at(source.schedule_time))
    db.add(row);db.commit();db.refresh(row);return _task(row)


@router.delete("/tasks/{task_id}")
def archive_task(task_id:int,db:Session=Depends(get_db))->dict:
    row=db.get(AutomationTaskRecord,task_id)
    if not row: raise HTTPException(404,"自动任务不存在")
    running=db.scalar(select(AutomationRunRecord.id).where(AutomationRunRecord.task_id==task_id,AutomationRunRecord.status=="running"))
    if running: raise HTTPException(409,"任务正在运行，不能归档")
    row.status="archived";row.next_run_at=None;db.commit();return {"id":row.id,"status":"archived"}


@router.post("/tasks/{task_id}/status")
def set_task_status(task_id: int, status: str, db: Session = Depends(get_db)) -> dict:
    if status not in {"active", "paused"}: raise HTTPException(422, "状态只能是 active 或 paused")
    row = db.get(AutomationTaskRecord, task_id)
    if not row: raise HTTPException(404, "自动任务不存在")
    row.status = status
    if status == "active":
        row.next_run_at = _next_schedule_at(row.schedule_time)
    db.commit(); return _task(row)


@router.post("/tasks/{task_id}/run")
def run_task(task_id: int, payload: RunWrite, db: Session = Depends(get_db)) -> dict:
    row = db.get(AutomationTaskRecord, task_id)
    if not row: raise HTTPException(404, "自动任务不存在")
    running = db.scalar(select(AutomationRunRecord).where(AutomationRunRecord.task_id == task_id, AutomationRunRecord.status == "running"))
    if running: raise HTTPException(409, "该任务正在运行，请勿重复启动")
    try:
        run = execute_task(db, row)
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"run_id": run.id, "status": run.status, "discovered": run.discovered_count,
            "inspected": run.inspected_count, "qualified": run.qualified_count,
            "collected": run.collected_count, "failed": run.failed_count}


@router.get("/runs")
def list_runs(limit: int = 20, db: Session = Depends(get_db)) -> list[dict]:
    rows = list(db.scalars(select(AutomationRunRecord).order_by(AutomationRunRecord.id.desc()).limit(min(max(limit, 1), 100))))
    return [{"id": r.id, "task_id": r.task_id, "status": r.status, "stage": r.current_stage,
             "discovered": r.discovered_count, "inspected": r.inspected_count, "qualified": r.qualified_count,
             "collected": r.collected_count, "failed": r.failed_count, "error": r.error_summary,
             "started_at": r.started_at, "finished_at": r.finished_at} for r in rows]


@router.get("/runs/{run_id}/candidates")
def list_candidates(run_id: int, db: Session = Depends(get_db)) -> list[dict]:
    rows = list(db.scalars(select(AutomationCandidateRecord).where(AutomationCandidateRecord.run_id == run_id).order_by(AutomationCandidateRecord.id)))
    return [{"id": r.id, "offer_id": r.offer_id, "title": r.title, "image_url": r.image_url,
             "price_min": r.price_min, "sales_90d": r.sales_90d, "status": r.status,
             "reason": r.rejection_reason, "source_record_id": r.source_record_id, "shop_id": r.shop_id} for r in rows]


@router.get("/runs/{run_id}")
def run_detail(run_id:int,db:Session=Depends(get_db))->dict:
    run=db.get(AutomationRunRecord,run_id)
    if not run: raise HTTPException(404,"运行记录不存在")
    events=list(db.scalars(select(AutomationEventRecord).where(AutomationEventRecord.run_id==run_id).order_by(AutomationEventRecord.id)))
    counts=dict(db.execute(select(AutomationCandidateRecord.status,func.count(AutomationCandidateRecord.id)).where(
        AutomationCandidateRecord.run_id==run_id).group_by(AutomationCandidateRecord.status)).all())
    return {"id":run.id,"task_id":run.task_id,"status":run.status,"stage":run.current_stage,
        "discovered":run.discovered_count,"inspected":run.inspected_count,"qualified":run.qualified_count,
        "collected":run.collected_count,"failed":run.failed_count,"error":run.error_summary,
        "started_at":run.started_at,"finished_at":run.finished_at,"status_counts":counts,
        "events":[{"id":e.id,"level":e.level,"stage":e.stage,"message":e.message,"created_at":e.created_at} for e in events]}


@router.get("/candidates")
def candidate_pool(status: str | None = None, stage: str | None = None, shop_id: int | None = None, query: str = "", page: int = 1, page_size: int = 30, db: Session = Depends(get_db)) -> dict:
    page=max(1,page);page_size=min(max(1,page_size),100)
    stmt=select(AutomationCandidateRecord)
    count_stmt=select(func.count(AutomationCandidateRecord.id))
    conditions=[]
    stage_statuses={"search":["discovered","detail_pending","detail_failed"],"package":["package_rejected","package_pending","filter_rejected","ready_for_review"],
                    "ai":["ai_processing","needs_review","ai_failed","draft_ready"],"approval":["draft_ready","approved"],
                    "published":["submitted","imported","publish_failed"]}
    if stage in stage_statuses: conditions.append(AutomationCandidateRecord.status.in_(stage_statuses[stage]))
    elif status: conditions.append(AutomationCandidateRecord.status==status)
    else:
        # Default view is the operator work queue, not an internal dump of
        # every search hit and rejection accumulated over many runs.
        conditions.append(AutomationCandidateRecord.status.in_([
            "ready_for_review", "package_pending", "manual_editing", "needs_review", "ai_failed",
            "draft_ready", "approved", "submitted", "imported", "publish_failed",
        ]))
    if shop_id: conditions.append(AutomationCandidateRecord.shop_id==shop_id)
    if query.strip(): conditions.append((AutomationCandidateRecord.title.contains(query.strip())) | (AutomationCandidateRecord.offer_id.contains(query.strip())))
    if conditions: stmt=stmt.where(*conditions);count_stmt=count_stmt.where(*conditions)
    total=db.scalar(count_stmt) or 0
    rows=list(db.scalars(stmt.order_by(AutomationCandidateRecord.id.desc()).offset((page-1)*page_size).limit(page_size)))
    status_counts={key:db.scalar(select(func.count(AutomationCandidateRecord.id)).where(AutomationCandidateRecord.status==key)) or 0 for key in
                   ("ready_for_review","manual_editing","ai_processing","draft_ready","needs_review","ai_failed","approved","submitted","imported","package_pending","package_rejected","risk_rejected","oversize_rejected","filter_rejected","publish_failed")}
    def item_payload(r: AutomationCandidateRecord) -> dict:
        pipeline = db.scalar(select(PipelineProductRecord).where(
            PipelineProductRecord.shop_id == r.shop_id,
            PipelineProductRecord.source_product_id == r.source_record_id,
        )) if r.shop_id and r.source_record_id else None
        draft = db.get(ListingDraftRecord, pipeline.listing_draft_id) if pipeline and pipeline.listing_draft_id else None
        variants = list(draft.variants) if draft else []
        package = json.loads(r.package_json) if r.package_json else {}
        supplement = db.scalar(select(YunNewtonSupplementJobRecord).where(
            YunNewtonSupplementJobRecord.source_url == r.source_url,
        ).order_by(YunNewtonSupplementJobRecord.id.desc())) if r.source_url else None
        evidence = {
            "category": bool(draft and draft.category_id and draft.type_id),
            "sku": bool(variants),
            "pricing": bool(variants) and all(v.calculated_price_cny is not None or v.price_cny is not None for v in variants),
            "package": bool(variants) and all(v.weight_g and v.length_mm and v.width_mm and v.height_mm for v in variants),
            "images": bool(draft and (draft.primary_image_url or draft.images)),
            "quality": bool(draft and not draft.ozon_issues and draft.status not in {"validation_failed", "publish_failed"}),
        }
        reason_text = (r.rejection_reason or "").lower()
        red_tokens = ("类目", "category", "sku", "变体", "字典", "value_id", "快照", "店铺不一致")
        if all(evidence.values()) and r.status in {"draft_ready", "approved", "submitted", "imported"} and not r.rejection_reason:
            review_level, review_reason = "green", "硬证据完整，可进入批次审批"
        elif any(token.lower() in reason_text for token in red_tokens):
            review_level, review_reason = "red", r.rejection_reason or "核心结构需要完整审核"
        else:
            missing = [key for key, ok in evidence.items() if not ok]
            fallback_reason = ("待补：" + "、".join(missing)) if missing else f"硬证据已齐，当前状态 {r.status}，等待草稿进入可审批状态"
            review_level, review_reason = "yellow", r.rejection_reason or fallback_reason
        return {"id":r.id,"run_id":r.run_id,"task_id":r.task_id,"offer_id":r.offer_id,"title":r.title,"image_url":r.image_url,
         "source_url":r.source_url,"price_min":r.price_min,"sales_90d":r.sales_90d,"status":r.status,"reason":r.rejection_reason,
         "source_record_id":r.source_record_id,"shop_id":r.shop_id,"package":package or None,
         "draft_id":pipeline.listing_draft_id if pipeline else None,
         "review_level":review_level,"review_reason":review_reason,"review_evidence":evidence,
         "yunniudun_supplement": ({"id": supplement.id, "status": supplement.status, "error_message": supplement.error_message} if supplement else None),
         "created_at":r.created_at,"updated_at":r.updated_at}
    return {"page":page,"page_size":page_size,"total":total,"status_counts":status_counts,"items":[item_payload(r) for r in rows]}


@router.post("/candidates/{candidate_id}/generate-draft")
def generate_candidate_draft(candidate_id: int, db: Session = Depends(get_db)) -> dict:
    candidate = db.get(AutomationCandidateRecord, candidate_id)
    if not candidate: raise HTTPException(404, "候选商品不存在")
    return process_candidate_ai(db, candidate)


@router.post("/candidates/{candidate_id}/start-manual-listing")
def start_manual_listing(candidate_id: int, payload: ManualListingStart, db: Session = Depends(get_db)) -> dict:
    candidate = db.get(AutomationCandidateRecord, candidate_id)
    if candidate is None:
        raise HTTPException(404, "候选商品不存在")
    if candidate.status not in ("ready_for_review", "package_pending") or not candidate.capture_json:
        raise HTTPException(422, "只有待人工处理且保留完整快照的候选可开始上架")
    target_shop_id = payload.shop_id or candidate.shop_id
    if not target_shop_id:
        raise HTTPException(422, "请先指定目标店铺")
    if db.get(Shop, target_shop_id) is None:
        raise HTTPException(404, "目标店铺不存在")
    try:
        source = ingest_capture(db, target_shop_id, json.loads(candidate.capture_json))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(422, f"候选快照无法创建人工上架记录：{exc}") from exc
    candidate.source_record_id = int(source["id"])
    candidate.shop_id = target_shop_id
    candidate.status = "manual_editing"
    candidate.rejection_reason = None
    db.add(AuditEventRecord(shop_id=target_shop_id, actor_id="operator", action="manual_listing_started",
        entity_type="automation_candidate", entity_id=str(candidate.id), details_json=json.dumps({"source_product_id": candidate.source_record_id, "offer_id": candidate.offer_id}, ensure_ascii=False)))
    db.commit()
    db.refresh(candidate)
    return {"candidate_id": candidate.id, "shop_id": candidate.shop_id, "source_product_id": candidate.source_record_id, "status": candidate.status}


@router.post("/candidates/generate-drafts")
def generate_candidate_drafts(payload:CandidateBatchAI,db:Session=Depends(get_db))->dict:
    rows=list(db.scalars(select(AutomationCandidateRecord).where(AutomationCandidateRecord.id.in_(payload.candidate_ids))))
    found={row.id for row in rows};results=[]
    for missing in set(payload.candidate_ids)-found: results.append({"candidate_id":missing,"status":"not_found","reason":"候选商品不存在"})
    for row in rows:
        result=process_candidate_ai(db,row);results.append({"candidate_id":row.id,**result})
    return {"requested":len(payload.candidate_ids),"draft_ready":sum(1 for r in results if r.get("status")=="draft_ready"),
            "needs_review":sum(1 for r in results if r.get("status")=="needs_review"),
            "failed":sum(1 for r in results if r.get("status") in {"ai_failed","not_found"}),"results":results}


@router.post("/candidate-batches/apply-sample")
def apply_candidate_sample(payload: CandidateBatchTemplate, db: Session = Depends(get_db)) -> dict:
    """Create local drafts from one operator-confirmed sample; never publish.

    The category/type and explicitly selected learning attributes are fixed.
    Source media, variants, package evidence, pricing and generated content stay
    product-specific and are rebuilt for every candidate.
    """
    sample = db.get(ListingDraftRecord, payload.sample_draft_id)
    if sample is None or not sample.category_id or not sample.type_id:
        raise HTTPException(422, "样板草稿必须已经确认完整的 Category ID 和 Type ID")
    fixed_ids = set(sample.learning_attribute_ids)
    fixed_attributes = {
        str(row.attribute_id): {"value_id": row.value_id, "value_text": row.value_text, "name": row.name}
        for row in sample.attribute_values if str(row.attribute_id) in fixed_ids
    }
    rows = list(db.scalars(select(AutomationCandidateRecord).where(AutomationCandidateRecord.id.in_(payload.candidate_ids))))
    by_id = {row.id: row for row in rows}
    results: list[dict] = []
    for candidate_id in payload.candidate_ids:
        candidate = by_id.get(candidate_id)
        if candidate is None:
            results.append({"candidate_id": candidate_id, "status": "not_found", "reason": "候选商品不存在"})
            continue
        if candidate.shop_id != sample.shop_id:
            results.append({"candidate_id": candidate_id, "status": "needs_review", "reason": "候选店铺与样板店铺不一致"})
            continue
        try:
            if not candidate.source_record_id:
                if not candidate.capture_json:
                    raise ValueError("候选缺少完整采集快照")
                source = ingest_capture(db, sample.shop_id, json.loads(candidate.capture_json))
                candidate.source_record_id = int(source["id"])
            candidate.status = "ai_processing"; candidate.rejection_reason = None; db.commit()
            pipeline = lock_category(db, sample.shop_id, candidate.source_record_id, sample.category_id, sample.type_id)
            map_attributes(db, sample.shop_id, candidate.source_record_id)
            mapping = json.loads(pipeline.attribute_mapping_json or "[]")
            for attr in mapping:
                fixed = fixed_attributes.get(str(attr.get("attribute_id")))
                if fixed:
                    attr.update({"matched": True, "value_id": fixed["value_id"], "value_text": fixed["value_text"], "matched_source": "batch_sample"})
            pipeline.attribute_mapping_json = json.dumps(mapping, ensure_ascii=False)
            db.commit()
            missing_required = [attr for attr in mapping if attr.get("required") and not attr.get("matched")]
            if missing_required:
                names = "、".join(str(attr.get("attribute_name") or attr.get("name") or attr.get("attribute_id")) for attr in missing_required[:5])
                raise ValueError(f"仍有 {len(missing_required)} 个必填属性未匹配：{names}")
            map_variants(db, sample.shop_id, candidate.source_record_id)
            content = generate_content(db, sample.shop_id, candidate.source_record_id)
            quality = run_quality_check(db, sample.shop_id, candidate.source_record_id)
            score = float(quality.get("overall_score") or quality.get("score") or 0)
            issues = quality.get("issues") or []
            if not content.get("content_verified") or issues:
                candidate.status = "needs_review"
                candidate.rejection_reason = f"样板已套用，仍有 {len(issues)} 项差异需要人工处理"
                db.commit()
                results.append({"candidate_id": candidate.id, "status": candidate.status, "score": score, "issues": issues, "reason": candidate.rejection_reason})
                continue
            draft = create_listing_draft_from_pipeline(db, sample.shop_id, candidate.source_record_id)
            candidate.status = "draft_ready"; candidate.rejection_reason = None
            db.add(AuditEventRecord(shop_id=sample.shop_id, actor_id="operator", action="batch_sample_applied",
                entity_type="automation_candidate", entity_id=str(candidate.id), details_json=json.dumps({"sample_draft_id": sample.id, "draft_id": draft.id, "category_id": sample.category_id, "type_id": sample.type_id, "fixed_attribute_ids": sorted(fixed_ids)}, ensure_ascii=False)))
            db.commit()
            results.append({"candidate_id": candidate.id, "status": "draft_ready", "draft_id": draft.id, "score": score})
        except Exception as exc:
            db.rollback(); candidate = db.get(AutomationCandidateRecord, candidate_id)
            if candidate:
                candidate.status = "needs_review"; candidate.rejection_reason = str(exc)[:1000]; db.commit()
            results.append({"candidate_id": candidate_id, "status": "needs_review", "reason": str(exc)})
    return {"sample_draft_id": sample.id, "requested": len(payload.candidate_ids),
            "draft_ready": sum(1 for row in results if row.get("status") == "draft_ready"),
            "needs_review": sum(1 for row in results if row.get("status") == "needs_review"), "results": results}


@router.post("/approval-batches", status_code=201)
def create_approval_batch(payload: BatchWrite, db: Session = Depends(get_db)) -> dict:
    if not db.get(Shop, payload.shop_id): raise HTTPException(404, "店铺不存在")
    candidates = list(db.scalars(select(AutomationCandidateRecord).where(AutomationCandidateRecord.id.in_(payload.candidate_ids))))
    if len(candidates) != len(set(payload.candidate_ids)): raise HTTPException(422, "部分候选商品不存在")
    invalid = [row.id for row in candidates if row.shop_id != payload.shop_id or row.status != "draft_ready"]
    if invalid: raise HTTPException(422, {"message":"只有当前店铺 draft_ready 商品可加入审批批次","candidate_ids":invalid})
    batch = AutomationApprovalBatchRecord(shop_id=payload.shop_id,
        name=payload.name or f"自动上品批次 {datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%m-%d %H:%M')}",
        candidate_ids_json=json.dumps(payload.candidate_ids), item_count=len(payload.candidate_ids), status="pending_approval")
    db.add(batch); db.commit(); db.refresh(batch)
    return {"id":batch.id,"name":batch.name,"status":batch.status,"item_count":batch.item_count,"shop_id":batch.shop_id}


@router.get("/approval-batches")
def list_approval_batches(db: Session = Depends(get_db)) -> list[dict]:
    rows=list(db.scalars(select(AutomationApprovalBatchRecord).order_by(AutomationApprovalBatchRecord.id.desc()).limit(100)))
    return [{"id":r.id,"name":r.name,"shop_id":r.shop_id,"status":r.status,"item_count":r.item_count,
             "approved_by":r.approved_by,"approved_at":r.approved_at,"created_at":r.created_at} for r in rows]


def _shop_upload_capacity(db: Session, shop_id: int) -> dict:
    """Return a conservative create allowance, preferring Ozon's live quota."""
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    locally_submitted = db.scalar(select(func.count(AuditEventRecord.id)).where(
        AuditEventRecord.shop_id == shop_id,
        AuditEventRecord.action == "pipeline_product_submitted",
        func.date(AuditEventRecord.created_at) == today,
    )) or 0
    fallback_limit = 180
    result = {
        "shop_id": shop_id,
        "source": "local_safe_fallback",
        "limit": fallback_limit,
        "usage": int(locally_submitted),
        "remaining": max(0, fallback_limit - int(locally_submitted)),
        "reset_at": None,
        "warning": None,
    }
    try:
        client_id, api_key = _credentials(db, shop_id)
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            response = client.get_product_upload_quota()
        daily = response.get("daily_create") if isinstance(response, dict) else None
        if isinstance(daily, dict):
            official_limit = max(0, int(daily.get("limit") or 0))
            official_usage = max(0, int(daily.get("usage") or 0))
            official_remaining = max(0, official_limit - official_usage)
            result.update({
                "source": "ozon_v4_product_info_limit",
                "limit": official_limit,
                "usage": official_usage,
                # The local 180/day guard remains an additional safety ceiling.
                "remaining": min(official_remaining, max(0, fallback_limit - int(locally_submitted))),
                "official_remaining": official_remaining,
                "reset_at": daily.get("reset_at"),
            })
    except (SyncConfigurationError, OzonSellerError, ValueError, TypeError) as exc:
        result["warning"] = f"Ozon额度暂不可读，使用本地保守额度：{str(exc)[:300]}"
    return result


@router.get("/approval-batches/capacity/{shop_id}")
def approval_shop_capacity(shop_id: int, db: Session = Depends(get_db)) -> dict:
    if db.get(Shop, shop_id) is None:
        raise HTTPException(404, "店铺不存在")
    return _shop_upload_capacity(db, shop_id)


@router.get("/approval-batches/{batch_id}")
def approval_batch_detail(batch_id:int,db:Session=Depends(get_db))->dict:
    batch=db.get(AutomationApprovalBatchRecord,batch_id)
    if not batch: raise HTTPException(404,"审批批次不存在")
    ids=json.loads(batch.candidate_ids_json or "[]")
    candidates=list(db.scalars(select(AutomationCandidateRecord).where(AutomationCandidateRecord.id.in_(ids)).order_by(AutomationCandidateRecord.id))) if ids else []
    return {"id":batch.id,"name":batch.name,"shop_id":batch.shop_id,"status":batch.status,"item_count":batch.item_count,
            "approved_by":batch.approved_by,"approved_at":batch.approved_at,"created_at":batch.created_at,
            "items":[{"id":c.id,"offer_id":c.offer_id,"title":c.title,"image_url":c.image_url,"status":c.status,
                      "reason":c.rejection_reason,"source_record_id":c.source_record_id} for c in candidates]}


@router.post("/approval-batches/{batch_id}/retry-failed")
def retry_failed_batch(batch_id:int,db:Session=Depends(get_db))->dict:
    batch=db.get(AutomationApprovalBatchRecord,batch_id)
    if not batch: raise HTTPException(404,"审批批次不存在")
    ids=json.loads(batch.candidate_ids_json or "[]")
    rows=list(db.scalars(select(AutomationCandidateRecord).where(AutomationCandidateRecord.id.in_(ids),AutomationCandidateRecord.status=="publish_failed")))
    for row in rows: row.status="approved";row.rejection_reason=None
    if rows: batch.status="approved"
    db.commit();return {"batch_id":batch.id,"reset":len(rows),"status":batch.status}


@router.post("/approval-batches/{batch_id}/approve")
def approve_batch(batch_id:int,payload:BatchApprove,db:Session=Depends(get_db))->dict:
    if not payload.confirmed: raise HTTPException(422,"批量审批必须 confirmed=true")
    batch=db.get(AutomationApprovalBatchRecord,batch_id)
    if not batch: raise HTTPException(404,"审批批次不存在")
    if batch.status!="pending_approval": raise HTTPException(409,"批次不在待审批状态")
    ids=json.loads(batch.candidate_ids_json or "[]")
    rows=list(db.scalars(select(AutomationCandidateRecord).where(AutomationCandidateRecord.id.in_(ids))))
    for candidate in rows:
        pipeline=db.scalar(select(PipelineProductRecord).where(PipelineProductRecord.shop_id==candidate.shop_id,PipelineProductRecord.source_product_id==candidate.source_record_id))
        if not pipeline or not pipeline.listing_draft_id: raise HTTPException(422,f"候选 {candidate.id} 缺少可审批草稿")
        pipeline.publish_status="approved";pipeline.pipeline_stage="approved";candidate.status="approved"
    batch.status="approved";batch.approved_by=payload.approver_id;batch.approved_at=datetime.now(ZoneInfo("Asia/Shanghai"))
    db.add(AuditEventRecord(shop_id=batch.shop_id,actor_id=payload.approver_id,action="automation_batch_approved",entity_type="automation_batch",entity_id=str(batch.id),details_json=json.dumps({"candidate_ids":ids,"count":len(ids)})))
    db.commit();return {"id":batch.id,"status":batch.status,"approved":len(rows)}


@router.post("/approval-batches/{batch_id}/submit")
def submit_batch(batch_id:int,payload:BatchSubmit,db:Session=Depends(get_db))->dict:
    if not payload.confirmed: raise HTTPException(422,"真实提交 Ozon 必须 confirmed=true")
    batch=db.get(AutomationApprovalBatchRecord,batch_id)
    if not batch: raise HTTPException(404,"审批批次不存在")
    if batch.status not in {"approved","partially_submitted"}: raise HTTPException(409,"批次尚未审批")
    capacity=_shop_upload_capacity(db,batch.shop_id)
    limit=min(payload.max_items,int(capacity["remaining"]))
    if limit<=0:
        reset_hint=f"，重置时间 {capacity['reset_at']}" if capacity.get("reset_at") else ""
        raise HTTPException(409,f"当前店铺今日商品创建额度已用完{reset_hint}")
    ids=json.loads(batch.candidate_ids_json or "[]")
    rows=list(db.scalars(select(AutomationCandidateRecord).where(AutomationCandidateRecord.id.in_(ids),AutomationCandidateRecord.status=="approved").order_by(AutomationCandidateRecord.id).limit(limit)))
    results=[]
    for candidate in rows:
        result=submit_to_ozon(db,candidate.shop_id,candidate.source_record_id,payload.actor_id)
        if result.get("status")=="submitted":
            candidate.status="submitted"
            bulk_item=db.scalar(select(BulkListingBatchItemRecord).where(
                BulkListingBatchItemRecord.candidate_id==candidate.id,
            ).order_by(BulkListingBatchItemRecord.id.desc()))
            if bulk_item:
                bulk_item.status="submitted"
                bulk_item.ozon_task_id=result.get("task_id")
                bulk_item.error_message=None
                _queue_draft_stock_sync(db, bulk_item.listing_draft_id, result.get("task_id"))
        results.append({"candidate_id":candidate.id,**result})
    # Reconcile older successful submissions that were committed before the
    # bulk-item status projection existed.
    submitted_candidates=list(db.scalars(select(AutomationCandidateRecord).where(
        AutomationCandidateRecord.id.in_(ids),
        AutomationCandidateRecord.status=="submitted",
    ))) if ids else []
    for candidate in submitted_candidates:
        bulk_item=db.scalar(select(BulkListingBatchItemRecord).where(
            BulkListingBatchItemRecord.candidate_id==candidate.id,
        ).order_by(BulkListingBatchItemRecord.id.desc()))
        pipeline=db.scalar(select(PipelineProductRecord).where(
            PipelineProductRecord.shop_id==candidate.shop_id,
            PipelineProductRecord.source_product_id==candidate.source_record_id,
        ))
        if bulk_item:
            bulk_item.status="submitted"
            bulk_item.ozon_task_id=pipeline.task_id if pipeline else bulk_item.ozon_task_id
            bulk_item.error_message=None
            _queue_draft_stock_sync(db, bulk_item.listing_draft_id, bulk_item.ozon_task_id)
    # This session disables autoflush. Flush candidate/item statuses before
    # counting the remainder or a fully submitted batch is shown as partial.
    db.flush()
    remaining=db.scalar(select(func.count(AutomationCandidateRecord.id)).where(AutomationCandidateRecord.id.in_(ids),AutomationCandidateRecord.status=="approved")) or 0
    batch.status="submitted" if remaining==0 else "partially_submitted";db.commit()
    return {"batch_id":batch.id,"status":batch.status,"submitted":sum(1 for r in results if r.get("status")=="submitted"),"remaining":remaining,"capacity":capacity,"results":results}
