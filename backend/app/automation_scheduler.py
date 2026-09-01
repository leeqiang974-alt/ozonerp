from __future__ import annotations

import threading
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from .automation_service import execute_task
from .database import SessionLocal
from .erp_models import (
    AutomationCandidateRecord, AutomationRunRecord, AutomationTaskRecord,
    BulkListingBatchItemRecord, BulkListingBatchRecord,
    ListingDraftRecord, PipelineProductRecord, AuditEventRecord,
)
from sqlalchemy import func
from .pipeline.publish_service import poll_task_status
from .pipeline.publish_service import submit_to_ozon
from .automation_routes import mark_bulk_items_for_ozon_feedback, _queue_draft_stock_sync

_stop = threading.Event()
_thread: threading.Thread | None = None
_allow_external_writes = False


def _is_ozon_daily_quota_error(message: object) -> bool:
    value = str(message or "").lower()
    return any(marker in value for marker in (
        "periodic_limit_exceeded", "daily_create", "daily create", "суточный лимит", "дневной лимит", "额度", "quota",
    ))


def _next_future_run(schedule_time: str, now: datetime) -> datetime:
    hour, minute = map(int, schedule_time.split(":"))
    next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    while next_run <= now:
        next_run += timedelta(days=1)
    return next_run


def _feedback_rows(result: dict) -> list[dict]:
    """Flatten poll_task_status errors into the draft feedback format.

    Ozon returns errors nested under each Offer ID.  The editor and bulk
    projection use one row per issue, so preserve the Offer ID while flattening
    only the response shape; the original nested response is audited below.
    """
    rows: list[dict] = []
    for item in result.get("errors") or []:
        if not isinstance(item, dict):
            continue
        offer_id = item.get("offer_id") or ""
        nested = item.get("errors") or []
        if isinstance(nested, dict):
            nested = [nested]
        for error in nested:
            if isinstance(error, dict):
                texts = error.get("texts") if isinstance(error.get("texts"), dict) else {}
                rows.append({
                    "type": "ozon_error",
                    "offer_id": offer_id,
                    "code": error.get("code") or "",
                    "field": error.get("field") or "",
                    "level": error.get("level") or "",
                    "attribute_id": error.get("attribute_id"),
                    "attribute_name": error.get("attribute_name") or "",
                    "description": error.get("description") or texts.get("description") or texts.get("message") or error.get("message") or error.get("code") or "Ozon 导入反馈",
                })
            else:
                rows.append({"type": "ozon_error", "offer_id": offer_id, "code": "", "description": str(error)})
    if not rows and result.get("error") and result.get("publish_status") in {"import_failed", "failed"}:
        rows.append({"type": "ozon_error", "code": "IMPORT_FAILED", "level": "error", "description": str(result.get("error"))})
    return rows


def _auto_repairable_feedback(rows: list[dict]) -> bool:
    """Return true only for deterministic text/attribute corrections."""
    codes = {str(row.get("code") or "").upper() for row in rows}
    text = " ".join(str(row.get("description") or "") for row in rows).lower()
    if any(token in text for token in (
        "нецензурн", "вульгарн", "оскорбительн", "негативным контекст",
        "дополнительном фото", "главном фото",
    )):
        # Image moderation issues require selecting/removing a concrete image;
        # text cleanup alone must not claim to have repaired them.
        return False
    return bool(codes & {
        "ERROR_ATTRIBUTE_IS_NOT_COLLECTION", "BR_HASHTAG_BRAND",
        "BR_HASHTAG_MARKETING", "FB_MERCH_OZON", "FB_ORIGINAL",
        "FB_INSTA", "DESCRIPTION_DECLINE",
    } or any(token in text for token in (
        "много повтор", "бессмысленн", "много спецсимвол",
        "слишком много перечислен", "названии товара упоминается бренд",
        "удалите названия всех брендов", "уберите реклам",
    )))


def _has_deterministic_image_payload_feedback(rows: list[dict]) -> bool:
    """Return true for image URL/dimension errors that payload preflight fixes.

    This is deliberately narrower than image moderation.  The submission
    preflight can remove only inaccessible/out-of-range URLs and retain a
    compliant fallback without changing the local SKU or public galleries.
    """
    image_codes = {
        "PRIMARY_IMAGE_LOAD_FAILED",
        "PICS_INVALID_DIMENSIONS",
        "SOME_IMAGE_FAILED",
    }
    return bool({str(row.get("code") or "").upper() for row in rows} & image_codes)


def _has_special_symbol_title_decline(rows: list[dict]) -> bool:
    """Whether Ozon accepted the Offer but declined its Name for punctuation.

    This must be repaired through ProductUpdateAttributes, not a second import:
    the original import already created the Ozon products.
    """
    for row in rows:
        if str(row.get("code") or "").upper() != "DESCRIPTION_DECLINE":
            continue
        text = " ".join(str(row.get(key) or "") for key in ("description", "field", "attribute_name")).lower()
        if "спецсимвол" in text or "special symbol" in text:
            return True
    return False


def _try_auto_update_declined_title(
    db: Session,
    candidate: AutomationCandidateRecord,
    bulk_item: BulkListingBatchItemRecord,
    rows: list[dict],
) -> bool:
    """Repair a title-only decline on existing Ozon Offers without re-importing.

    ``DESCRIPTION_DECLINE`` can be returned alongside ``imported``.  Ozon's
    attributes endpoint does not update the card name (attribute 4180), so
    the safe correction is one *full update import using the same Offer IDs*.
    Ozon matches existing Offer IDs; it updates those products rather than
    creating another Offer/card.
    """
    # Legacy rows and lightweight scheduler tests may not expose the newer
    # draft binding field.  Treat a missing field the same as an unbound item;
    # never let one historical row abort the bounded feedback sweep.
    if not getattr(bulk_item, "listing_draft_id", None) or not _has_special_symbol_title_decline(rows):
        return False
    draft = db.get(ListingDraftRecord, bulk_item.listing_draft_id)
    if draft is None or not draft.variants:
        return False

    from .quality_preflight import _clean_title_special_symbols
    before = str(draft.title or "")
    if not _clean_title_special_symbols(draft):
        return False
    after = str(draft.title or "")
    if not after:
        draft.title = before
        return False

    try:
        from .offer_id_service import normalize_offer_id
        offer_ids = [normalize_offer_id(variant.seller_sku) for variant in draft.variants]
        # submit_to_ozon builds the canonical full payload and persists the
        # Ozon task.  Reusing it guarantees the correction is submitted with
        # exactly the same image/price/attribute safeguards as normal batch
        # publishing, while the unchanged Offer IDs make this an update.
        pipeline = db.scalar(select(PipelineProductRecord).where(
            PipelineProductRecord.shop_id == bulk_item.assigned_shop_id,
            PipelineProductRecord.source_product_id == bulk_item.source_product_id,
        ))
        if pipeline is None:
            raise RuntimeError("找不到原商品的发布记录，不能安全更新既有 Offer")
        # A title decline may leave the prior pipeline at ``imported`` even
        # though the card is unsellable.  This is an explicit, deterministic
        # correction of Ozon's own feedback, so promote only this one pipeline
        # back to the existing submit path; do not create a new candidate.
        pipeline.publish_status = "approved"
        pipeline.pipeline_stage = "approved"
        candidate.status = "approved"
        db.commit()
        submission = submit_to_ozon(
            db, bulk_item.assigned_shop_id, bulk_item.source_product_id,
            "ozon-title-special-symbol-auto-fix",
        )
        if submission.get("status") != "submitted" or not submission.get("task_id"):
            raise RuntimeError(str(submission.get("error") or "Ozon 未返回名称更新任务"))
        update_task_id = str(submission["task_id"])
        # Ozon returns an asynchronous task for the existing-Offer update.
        # Store it in the durable task fields so the scheduler keeps polling
        # the real response after this request.
        if update_task_id:
            bulk_item.ozon_task_id = update_task_id
            draft.import_task_id = update_task_id
            if pipeline is not None:
                pipeline.task_id = update_task_id
                pipeline.publish_status = "submitted"
                pipeline.pipeline_stage = "published"
        draft.ozon_issues_json = "[]"
        candidate.status = "submitted" if update_task_id else "imported"
        candidate.rejection_reason = None
        bulk_item.status = "submitted" if update_task_id else "imported"
        bulk_item.error_message = "标题特殊符号已自动清理并提交 Ozon 原商品更新，等待 Ozon 回读确认"
        db.add(AuditEventRecord(
            shop_id=bulk_item.assigned_shop_id, actor_id="system",
            action="ozon_declined_title_auto_updated",
            entity_type="bulk_listing_batch_item", entity_id=str(bulk_item.id),
            details_json=json.dumps({
                "old_title": before, "new_title": after,
                "offer_ids": offer_ids,
                "task_id": update_task_id,
                "submission_mode": "full_update_by_existing_offer_id",
                "source_feedback": rows,
            }, ensure_ascii=False),
        ))
        db.commit()
        return True
    except Exception:
        db.rollback()
        return False


def _try_auto_repair_and_resubmit(db: Session, candidate: AutomationCandidateRecord, bulk_item: BulkListingBatchItemRecord, rows: list[dict]) -> bool:
    """Repair and resubmit one feedback-bearing item at most twice.

    The existing editor auto-fix endpoint is used as the single correction
    implementation.  This helper only orchestrates it after a real Ozon
    response, then routes the corrected draft through the existing submit path.
    """
    if _try_auto_update_declined_title(db, candidate, bulk_item, rows):
        return True
    deterministic_image_repair = _has_deterministic_image_payload_feedback(rows)
    if not rows or (not _auto_repairable_feedback(rows) and not deterministic_image_repair) or not bulk_item.listing_draft_id:
        return False
    # ``attempts`` is incremented by the bulk worker before the initial submit.
    # Two automatic correction rounds are enough to avoid a feedback loop.
    if int(bulk_item.attempts or 0) >= 3:
        return False
    draft = db.get(ListingDraftRecord, bulk_item.listing_draft_id)
    if draft is None:
        return False
    old_task_id = bulk_item.ozon_task_id
    try:
        # Import lazily to avoid the main -> scheduler import cycle at startup.
        from .main import auto_fix_listing
        from .quality_preflight import run_quality_preflight, record_preflight_results
        draft.ozon_issues_json = json.dumps(rows, ensure_ascii=False)
        db.commit()
        # Run the same persisted rule table used before the first submission.
        # This covers brand/platform text, marketing tags and original-word
        # cleanup without creating a second correction implementation.
        preflight = run_quality_preflight(db, draft, batch_id=bulk_item.batch_id, auto_fix=True)
        if preflight.get("fixed"):
            record_preflight_results(db, draft, preflight, batch_id=bulk_item.batch_id)
            db.commit()
        fixed = auto_fix_listing(bulk_item.assigned_shop_id, draft.id, db)
        total_fixes = int(fixed.get("fix_count") or 0) + int(preflight.get("fixable_count") or 0)
        if total_fixes <= 0 and not deterministic_image_repair:
            # Persist the inspection so an unchanged error snapshot is not sent
            # to the AI on every 30-second scheduler tick.
            bulk_item.attempts = int(bulk_item.attempts or 0) + 1
            bulk_item.error_message = "已检查，当前 Ozon 回执没有可自动修复项，等待人工处理"
            db.commit()
            return False
        # ``auto_fix_listing`` can invoke an AI translation for a repeated
        # title.  It must not create an escape hatch around the same hard gate
        # used by the initial batch submit.  Re-check after *all* auto-fixes,
        # before changing the candidate to approved or making another Ozon
        # write.  This specifically prevents provider prompt leakage from
        # becoming a corrective import.
        postflight = run_quality_preflight(db, draft, batch_id=bulk_item.batch_id, auto_fix=False)
        if postflight.get("issues_remaining"):
            record_preflight_results(db, draft, postflight, batch_id=bulk_item.batch_id)
            messages = [str(issue.get("message") or issue) for issue in postflight["issues_remaining"][:3]]
            bulk_item.status = "needs_review"
            bulk_item.error_message = "自动修正后的草稿未通过提交门禁：" + "；".join(messages)
            db.commit()
            return False
        pipeline = db.scalar(select(PipelineProductRecord).where(
            PipelineProductRecord.shop_id == bulk_item.assigned_shop_id,
            PipelineProductRecord.source_product_id == bulk_item.source_product_id,
        ))
        if pipeline is None:
            return False
        pipeline.publish_status = "approved"
        pipeline.pipeline_stage = "approved"
        candidate.status = "approved"
        candidate.rejection_reason = None
        bulk_item.attempts = int(bulk_item.attempts or 0) + 1
        bulk_item.status = "submitted"
        bulk_item.error_message = "Ozon回传已自动修正，正在重新提交并复核"
        db.commit()
        submission = submit_to_ozon(db, bulk_item.assigned_shop_id, bulk_item.source_product_id, "ozon-feedback-auto-fix")
        if submission.get("status") != "submitted":
            raise RuntimeError(str(submission.get("error") or "修正后未返回提交任务"))
        bulk_item.status = "submitted"
        bulk_item.ozon_task_id = submission.get("task_id")
        bulk_item.error_message = "Ozon回传已自动修正，等待新任务结果"
        # The old feedback is already preserved by
        # ``bulk_ozon_feedback_received``.  Clear the draft's *current*
        # issue snapshot so startup reconciliation cannot project a resolved
        # error back onto a successfully resubmitted item.
        draft.ozon_issues_json = "[]"
        candidate.status = "submitted"
        _queue_draft_stock_sync(db, draft.id, submission.get("task_id"))
        db.add(AuditEventRecord(
            shop_id=bulk_item.assigned_shop_id, actor_id="system",
            action="ozon_feedback_auto_repaired_resubmitted",
            entity_type="bulk_listing_batch_item", entity_id=str(bulk_item.id),
            details_json=json.dumps({
                "old_task_id": old_task_id,
                "new_task_id": submission.get("task_id"),
                "fixes": fixed.get("fixes", []) + (
                    [{"action": "image_payload_preflight_filtered", "reason": "Ozon 图片下载或分辨率回执"}]
                    if deterministic_image_repair else []
                ),
            }, ensure_ascii=False),
        ))
        db.commit()
        return True
    except Exception as exc:
        db.rollback()
        bulk_item = db.get(BulkListingBatchItemRecord, bulk_item.id)
        if bulk_item is not None:
            if _is_ozon_daily_quota_error(exc):
                bulk_item.status = "waiting_quota"
                bulk_item.error_message = "自动修正已完成，但 Ozon 当日额度已满，等待额度恢复后继续"
            else:
                bulk_item.status = "needs_review"
                bulk_item.error_message = f"自动修正后提交失败：{str(exc)[:1200]}"
            db.commit()
        return False


def _repair_existing_bulk_feedback(db: Session, *, limit: int = 10) -> int:
    """Retry legacy needs-review rows whose Ozon feedback is already stored.

    This closes the gap for imports completed before the active submitted-task
    poller was deployed.  It never invents a new error: the draft's persisted
    Ozon feedback is the only input.
    """
    query = select(BulkListingBatchItemRecord, ListingDraftRecord, AutomationCandidateRecord).join(
        ListingDraftRecord, ListingDraftRecord.id == BulkListingBatchItemRecord.listing_draft_id,
    ).join(
        AutomationCandidateRecord, AutomationCandidateRecord.id == BulkListingBatchItemRecord.candidate_id,
    ).where(
        BulkListingBatchItemRecord.status == "needs_review",
        ListingDraftRecord.ozon_issues_json.is_not(None),
    ).order_by(BulkListingBatchItemRecord.updated_at).limit(limit)
    repaired = 0
    for item, draft, candidate in db.execute(query).all():
        try:
            rows = json.loads(draft.ozon_issues_json or "[]")
        except (TypeError, ValueError):
            rows = []
        if not isinstance(rows, list):
            continue
        # An in-place Name update is not a fourth import attempt.  Allow this
        # one deterministic repair for historical rows that had already hit
        # the old import retry cap.
        if _try_auto_update_declined_title(db, candidate, item, rows):
            repaired += 1
            continue
        # Three or more real attempts is the terminal retry budget for a
        # corrective import.  Archive it before trying any further AI or Ozon
        # call, and leave an audit trail explaining why it stopped.
        if int(item.attempts or 0) >= 3:
            item.status = "skipped"
            item.error_message = "已放弃：Ozon提交已达到3次或以上，停止继续提交"
            db.add(AuditEventRecord(
                shop_id=item.assigned_shop_id, actor_id="system",
                action="bulk_listing_retry_exhausted",
                entity_type="bulk_listing_batch_item", entity_id=str(item.id),
                details_json=json.dumps({"attempts": int(item.attempts or 0), "reason": "retry_budget_exhausted"}, ensure_ascii=False),
            ))
            db.commit()
            continue
        try:
            if _try_auto_repair_and_resubmit(db, candidate, item, rows):
                repaired += 1
        except Exception as exc:
            # One malformed legacy row must not starve the rest of the
            # bounded sweep.  Keep the row visible for manual handling and
            # continue with the next persisted Ozon feedback snapshot.
            db.rollback()
            current = db.get(BulkListingBatchItemRecord, item.id)
            if current is not None:
                current.status = "needs_review"
                current.error_message = f"历史回扫异常，需人工处理：{str(exc)[:1200]}"
                db.commit()
    return repaired


def _loop() -> None:
    while not _stop.wait(30):
        now = datetime.now(ZoneInfo("Asia/Shanghai"))
        with SessionLocal() as db:
            tasks = list(db.scalars(select(AutomationTaskRecord).where(
                AutomationTaskRecord.status == "active", AutomationTaskRecord.next_run_at <= now
            )))
            for task in tasks:
                running = db.scalar(select(AutomationRunRecord).where(
                    AutomationRunRecord.task_id == task.id, AutomationRunRecord.status == "running"))
                if running: continue
                task.next_run_at = _next_future_run(task.schedule_time, now); db.commit()
                try: execute_task(db, task)
                except Exception: continue
            # Poll submitted Ozon imports. A prior operator approval authorizes
            # this worker to apply only deterministic local fixes and resubmit
            # within the bounded auto-repair policy; quota and ambiguous/image
            # moderation feedback remains stopped and visible.
            for candidate in db.scalars(select(AutomationCandidateRecord).where(
                AutomationCandidateRecord.status == "submitted"
            ).order_by(AutomationCandidateRecord.id).limit(20)):
                try:
                    result = poll_task_status(db, candidate.shop_id, candidate.source_record_id)
                    status = result.get("publish_status") or result.get("status")
                    bulk_item = db.scalar(select(BulkListingBatchItemRecord).where(
                        BulkListingBatchItemRecord.candidate_id == candidate.id
                    ).order_by(BulkListingBatchItemRecord.id.desc()))
                    feedback_rows = _feedback_rows(result)
                    draft = db.get(ListingDraftRecord, bulk_item.listing_draft_id) if bulk_item and bulk_item.listing_draft_id else None
                    if feedback_rows and draft:
                        # Keep the complete Ozon response attached to the draft
                        # before any automatic correction.  This is the evidence
                        # used by the editor and by the next audit pass.
                        draft.ozon_issues_json = json.dumps(feedback_rows, ensure_ascii=False)
                        db.add(AuditEventRecord(
                            shop_id=candidate.shop_id, actor_id="ozon-feedback-sync",
                            action="bulk_ozon_feedback_received",
                            entity_type="bulk_listing_batch_item", entity_id=str(bulk_item.id) if bulk_item else str(candidate.id),
                            details_json=json.dumps({"task_id": result.get("task_id"), "status": status, "issues": feedback_rows}, ensure_ascii=False),
                        ))
                        if bulk_item:
                            mark_bulk_items_for_ozon_feedback(db, draft, feedback_rows)
                        db.flush()

                    if status in {"imported", "completed"}:
                        # A successful import with a blocking Ozon issue is not
                        # sellable.  Repair it from the real feedback first; do
                        # not overwrite the row back to "imported".
                        if _allow_external_writes and bulk_item and feedback_rows and _try_auto_repair_and_resubmit(db, candidate, bulk_item, feedback_rows):
                            continue
                        candidate.status = "needs_review" if feedback_rows and bulk_item and bulk_item.status == "needs_review" else "imported"
                        if bulk_item and bulk_item.status not in {"needs_review", "waiting_quota"}:
                            bulk_item.status = "imported"
                            bulk_item.error_message = ("Ozon已导入；存在警告，库存继续由 Ozon 状态和仓库回读确认" if feedback_rows else None)
                    elif status in {"import_failed", "failed"}:
                        err = str(result.get("error") or result.get("message") or "Ozon 导入失败")[:2000]
                        repaired = bool(_allow_external_writes and bulk_item and feedback_rows and _try_auto_repair_and_resubmit(db, candidate, bulk_item, feedback_rows))
                        if repaired:
                            continue
                        if bulk_item:
                            if _is_ozon_daily_quota_error(err):
                                bulk_item.status = "waiting_quota"
                                bulk_item.error_message = "Ozon当日创建额度已满，等待额度恢复后继续"
                            elif bulk_item.status != "needs_review":
                                bulk_item.status = "failed"
                                bulk_item.error_message = err
                        if _is_ozon_daily_quota_error(err):
                            candidate.status = "approved"
                            candidate.rejection_reason = "Ozon当日创建额度已满，等待额度恢复后继续"
                        else:
                            candidate.status = "publish_failed"
                            candidate.rejection_reason = err
                    if bulk_item and bulk_item.batch_id:
                        batch = db.get(BulkListingBatchRecord, bulk_item.batch_id)
                        if batch:
                            counts = dict(db.execute(
                                select(BulkListingBatchItemRecord.status, func.count(BulkListingBatchItemRecord.id))
                                .where(BulkListingBatchItemRecord.batch_id == batch.id)
                                .group_by(BulkListingBatchItemRecord.status)
                            ).all())
                            batch.needs_review_count = int(counts.get("needs_review", 0))
                            batch.failed_count = int(counts.get("failed", 0))
                            batch.submitted_count = int(counts.get("submitted", 0)) + int(counts.get("imported", 0))
                            batch.succeeded_count = int(counts.get("imported", 0))
                    db.commit()
                except Exception: db.rollback()
            # Also drain feedback that was persisted before this active poller
            # existed.  This is bounded per tick and shares the exact same
            # repair/resubmit function as live callbacks.
            try:
                if _allow_external_writes:
                    _repair_existing_bulk_feedback(db, limit=10)
                db.commit()
            except Exception:
                db.rollback()


def start_scheduler(*, allow_external_writes: bool = False) -> None:
    global _thread, _allow_external_writes
    _allow_external_writes = bool(allow_external_writes)
    if _thread and _thread.is_alive(): return
    _stop.clear(); _thread = threading.Thread(target=_loop, name="automation-scheduler", daemon=True); _thread.start()


def stop_scheduler() -> None:
    global _allow_external_writes
    _allow_external_writes = False
    _stop.set()
