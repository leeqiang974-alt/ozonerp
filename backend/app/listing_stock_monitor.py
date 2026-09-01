from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .erp_models import AuditEventRecord, ListingDraftRecord, ListingVariantRecord, PipelineProductRecord
from .decision_memory_service import finalize_successful_listing_memories
from .integrations.ozon_seller import OzonSellerClient
from .models import Warehouse
from .sync_service import _credentials


READY_STATUS = "price_sent"
PENDING_STATES = ("waiting_product", "waiting_price", "waiting_tag", "partial", "retry")
_monitor_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _next_delay(attempts: int) -> timedelta:
    # Ozon import/info endpoints are eventually consistent. Polling every
    # minute is sufficient and avoids turning a large batch into a request
    # storm while still recovering quickly after the first response.
    if attempts < 3:
        return timedelta(minutes=1)
    if attempts < 12:
        return timedelta(minutes=2)
    return timedelta(minutes=5)


def _normalized_warehouse_name(value: str | None) -> str:
    """Normalize warehouse labels before matching a pricing tier.

    Ozon warehouse names are operator-editable and commonly contain spaces,
    punctuation, or a translated suffix (for example ``extra small
    ECONOMING``).  The pricing tier itself is intentionally compact
    (``extrasmall``), so a literal substring comparison would miss a valid
    warehouse and keep the stock task in an endless retry loop.
    """
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _import_task_issues(items: list[dict]) -> list[dict]:
    issues = []
    for item in items:
        errors = item.get("errors") or []
        if isinstance(errors, dict):
            errors = [errors]
        for error in errors:
            if isinstance(error, dict):
                texts = error.get("texts", {}) if isinstance(error.get("texts"), dict) else {}
                message = error.get("message") or texts.get("message") or texts.get("description") or texts.get("short_description") or error.get("code", "Ozon 导入失败")
                issues.append({
                    "type": "ozon_error", "offer_id": item.get("offer_id", ""),
                    "code": error.get("code", ""), "field": error.get("field", ""),
                    "level": error.get("level", ""), "description": message,
                })
            else:
                issues.append({"type": "ozon_error", "offer_id": item.get("offer_id", ""), "description": str(error)})
    return issues


def _warehouse_id_for_variant(variant, warehouses: list[Warehouse]) -> int | None:
    weight = float(variant.weight_g or 0)
    price = float(variant.price_cny or variant.calculated_price_cny or 0)
    if not weight or not price:
        return None
    if weight <= 500 and price <= 135:
        level = "extrasmall"
    elif weight <= 30000 and price <= 135:
        level = "budget"
    elif weight <= 2000 and price <= 635:
        level = "small"
    elif weight <= 30000 and price <= 635:
        level = "big"
    else:
        return None
    normalized_level = _normalized_warehouse_name(level)
    for warehouse in warehouses:
        if normalized_level in _normalized_warehouse_name(warehouse.name) and warehouse.warehouse_id:
            return int(warehouse.warehouse_id)
    return None


def _monitor_listing_stock(db: Session, draft: ListingDraftRecord) -> dict:
    """Advance one persisted listing until every SKU's FBS stock is confirmed."""
    now = _now()
    draft.stock_sync_attempts = int(draft.stock_sync_attempts or 0) + 1
    offer_ids = [variant.seller_sku for variant in draft.variants]
    client_id, api_key = _credentials(db, draft.shop_id)

    try:
        with OzonSellerClient(client_id=client_id, api_key=api_key, timeout_seconds=60) as client:
            if not draft.import_task_id:
                raise RuntimeError("草稿缺少 Ozon 导入任务号，无法确认本次发布结果")
            import_items = client.get_import_info(task_id=str(draft.import_task_id)).get("result", {}).get("items", [])
            import_issues = _import_task_issues(import_items)
            # 只将 ERROR 级别的视为导入失败；WARNING 级别（如变体合并提示）记录但继续
            # 用户确认可接受的非阻塞错误：跨店重复发布，记录但不阻塞批次
            ACCEPTABLE_ERROR_CODES = {"SPU_ALREADY_EXISTS_IN_ANOTHER_ACCOUNT"}
            # Some import-info responses omit ``level`` but still place the
            # issue in an item's errors array. Treat those as errors too.
            error_issues = [i for i in import_issues if (
                (i.get("level") or "").lower() in {"", "error", "error_level_error"}
                and i.get("code") not in ACCEPTABLE_ERROR_CODES
            )]
            acceptable_issues = [i for i in import_issues if i.get("code") in ACCEPTABLE_ERROR_CODES]
            if import_issues:
                draft.ozon_issues_json = json.dumps(import_issues, ensure_ascii=False)
            quota_issues = [i for i in import_issues if "periodic_limit_exceeded" in str(i.get("code") or "").lower()
                            or "суточный лимит" in str(i.get("description") or "").lower()]
            # A successful import can still contain advisory messages.  They
            # are returned in the same ``errors`` array, but must not block
            # inventory merely because the platform corrected an attribute
            # value (for example the single-value hashtag warning).  Only an
            # unresolved ERROR for the concrete Offer ID blocks that SKU.
            non_quota_errors = [
                i for i in error_issues
                if i not in quota_issues and i.get("code") not in ACCEPTABLE_ERROR_CODES
            ]
            blocking_offer_ids = {
                str(issue.get("offer_id") or "")
                for issue in non_quota_errors
            }
            # An error without an Offer ID is task-level and cannot be safely
            # attributed to only one variant, so it blocks the whole task.
            task_level_error = any(not str(issue.get("offer_id") or "").strip() for issue in non_quota_errors)
            # A single import task can contain a mixture of successful SKUs,
            # quota-rejected SKUs and content-rejected SKUs.  The successful
            # rows are still valid inventory targets and must not be held
            # hostage by the rows that Ozon did not create.
            accepted = [
                row for row in import_items
                if row.get("product_id")
                and row.get("status") in ("imported", "skipped")
                and str(row.get("offer_id") or "") not in blocking_offer_ids
                and not task_level_error
            ]
            accepted_offer_ids = {
                str(row.get("offer_id")) for row in accepted
                if str(row.get("offer_id") or "") in set(offer_ids)
            }
            if not accepted_offer_ids:
                if quota_issues and not non_quota_errors:
                    draft.stock_sync_status = "waiting_quota"
                    draft.stock_sync_message = "Ozon 当日创建额度已满；尚未生成商品，等待恢复后重新提交"
                    draft.stock_sync_next_at = None
                    db.commit()
                    return {"status": "waiting_quota", "issues": quota_issues}
                if non_quota_errors:
                    draft.stock_sync_status = "import_failed"
                    draft.stock_sync_message = f"Ozon 导入失败：{non_quota_errors[0]['description']}"
                    draft.stock_sync_next_at = None
                    db.add(AuditEventRecord(
                        shop_id=draft.shop_id, actor_id="system", action="listing_import_failed",
                        entity_type="listing_draft", entity_id=str(draft.id),
                        details_json=json.dumps({"task_id": draft.import_task_id, "issues": import_issues}, ensure_ascii=False),
                    ))
                    db.commit()
                    result = {"status": "import_failed", "issues": non_quota_errors}
                    warnings = [i for i in import_issues if i not in error_issues]
                    if warnings:
                        result["warnings"] = warnings
                    return result
                draft.stock_sync_status = "waiting_product"
                draft.stock_sync_message = f"等待 Ozon 生成可同步 SKU：已确认 0/{len(offer_ids)}"
                draft.stock_sync_next_at = now + _next_delay(draft.stock_sync_attempts)
                db.commit()
                return {"status": draft.stock_sync_status, "imported": 0, "expected": len(offer_ids)}

            found = []
            last_id = ""
            while True:
                page = client.list_products(limit=1000, last_id=last_id).get("result", {})
                found.extend(row for row in page.get("items", []) if row.get("offer_id") in offer_ids)
                last_id = page.get("last_id", "")
                if not last_id or len(page.get("items", [])) < 1000:
                    break

            found = [row for row in found if str(row.get("offer_id") or "") in accepted_offer_ids]
            if len(found) != len(accepted_offer_ids):
                draft.stock_sync_status = "waiting_product"
                draft.stock_sync_message = f"等待 Ozon 生成可同步 SKU：已发现 {len(found)}/{len(accepted_offer_ids)}"
                draft.stock_sync_next_at = now + _next_delay(draft.stock_sync_attempts)
                db.commit()
                return {"status": draft.stock_sync_status, "found": len(found), "expected": len(accepted_offer_ids)}

            # Learning-memory write-back must not block stock synchronization.
            # A shared source product may not have a shop-link row yet; the
            # published Ozon product can still safely proceed to stock update.
            try:
                finalize_successful_listing_memories(db, draft, task_id=draft.import_task_id)
            except Exception as memory_exc:
                db.add(AuditEventRecord(
                    shop_id=draft.shop_id, actor_id="system", action="listing_memory_writeback_failed",
                    entity_type="listing_draft", entity_id=str(draft.id),
                    details_json=json.dumps({"error": str(memory_exc)[:1000]}, ensure_ascii=False),
                ))
                db.commit()
            if draft.source_product_id:
                pipeline = db.scalar(select(PipelineProductRecord).where(
                    PipelineProductRecord.shop_id == draft.shop_id,
                    PipelineProductRecord.source_product_id == draft.source_product_id,
                ))
                if pipeline:
                    was_imported = pipeline.publish_status == "imported"
                    pipeline.listing_draft_id = draft.id
                    pipeline.task_id = draft.import_task_id
                    pipeline.publish_status = "imported"
                    pipeline.pipeline_stage = "published"
                    if not was_imported:
                        db.add(AuditEventRecord(
                            shop_id=draft.shop_id, actor_id="system", action="listing_imported",
                            entity_type="listing_draft", entity_id=str(draft.id),
                            details_json=json.dumps({"offer_id": draft.offer_id, "task_id": draft.import_task_id}, ensure_ascii=False),
                        ))
                    db.commit()

            info_rows = client.get_product_info(product_ids=[int(row["product_id"]) for row in found]).get("items", [])
            ready = {
                row.get("offer_id"): row for row in info_rows
                if str(row.get("offer_id") or "") in accepted_offer_ids
                and (row.get("statuses") or {}).get("status") == READY_STATUS
            }
            if not ready:
                draft.stock_sync_status = "waiting_price"
                draft.stock_sync_message = f"等待 SKU 进入 price_sent：已就绪 0/{len(accepted_offer_ids)}"
                draft.stock_sync_next_at = now + _next_delay(draft.stock_sync_attempts)
                db.commit()
                return {"status": draft.stock_sync_status, "ready": 0, "expected": len(accepted_offer_ids)}

            warehouses = list(db.scalars(select(Warehouse).where(Warehouse.shop_id == draft.shop_id)))
            stocks = []
            expected: dict[tuple[str, int], int] = {}
            ready_offer_ids = set(ready)
            for variant in draft.variants:
                if variant.seller_sku not in ready_offer_ids:
                    continue
                warehouse_id = _warehouse_id_for_variant(variant, warehouses)
                if not warehouse_id:
                    raise RuntimeError(f"SKU {variant.seller_sku} 未匹配到有效 FBS 仓库")
                target = int(variant.stock or 0)
                stocks.append({"offer_id": variant.seller_sku, "stock": target, "warehouse_id": warehouse_id})
                expected[(variant.seller_sku, warehouse_id)] = target

            # Read first.  The monitor is deliberately idempotent: once Ozon
            # already shows the required stock, do not write it again.  This
            # prevents a fast polling loop from triggering
            # ``TOO_MANY_REQUESTS / Stock is updated too frequently``.
            pre_readback = client.get_fbs_stocks_by_warehouse(offer_ids=sorted(ready_offer_ids))
            present_before = {
                (str(row.get("offer_id")), int(row.get("warehouse_id") or 0)): int(row.get("present") or 0)
                for row in pre_readback.get("products", [])
            }
            stocks = [
                row for row in stocks
                if present_before.get((str(row["offer_id"]), int(row["warehouse_id"]))) != int(row["stock"])
            ]
            if not stocks:
                unresolved = set(offer_ids) - ready_offer_ids
                if unresolved:
                    # The accepted SKUs may already have the target quantity,
                    # while another Offer in the same import task is still
                    # failed/quota-pending.  Do not report the whole product
                    # card as completed in that mixed state.
                    draft.stock_sync_status = "partial"
                    draft.stock_sync_message = f"Ozon 库存已确认：{len(expected)}/{len(offer_ids)} 个 SKU；其余 {len(unresolved)} 个尚未进入 price_sent"
                    draft.stock_sync_next_at = None
                    db.commit()
                    return {"status": "partial", "confirmed": len(expected), "pending": len(unresolved)}
                draft.stock_sync_status = "completed"
                draft.stock_sync_message = f"Ozon 库存已确认：{len(expected)} 个 SKU"
                draft.stock_sync_next_at = None
                draft.stock_synced_at = now
                draft.status = "submitted"
                draft.ozon_product_id = int(info_rows[0].get("id")) if info_rows else draft.ozon_product_id
                db.add(AuditEventRecord(
                    shop_id=draft.shop_id, actor_id="system", action="listing_stock_readback_confirmed",
                    entity_type="listing_draft", entity_id=str(draft.id),
                    details_json=json.dumps({"offer_id": draft.offer_id, "sku_count": len(expected)}, ensure_ascii=False),
                ))
                db.commit()
                return {"status": "completed", "confirmed": len(expected)}

            update_result = client.update_stocks(stocks=stocks)
            failures = []
            for row in update_result.get("result", []):
                if not row.get("updated") or row.get("errors"):
                    failures.append({"offer_id": row.get("offer_id"), "errors": row.get("errors", [])})
            if failures:
                tag_wait = all(any(
                    str(error.get("code") or "") == "PRODUCT_HAS_NOT_BEEN_TAGGED_YET"
                    for error in (row.get("errors") or []) if isinstance(error, dict)
                ) for row in failures)
                if tag_wait:
                    draft.stock_sync_status = "waiting_tag"
                    draft.stock_sync_message = "Ozon 正在完成商品标签校验；库存写入将在 15 分钟后自动复查"
                    draft.stock_sync_next_at = now + timedelta(minutes=15)
                    db.commit()
                    return {"status": "waiting_tag", "failed_offers": [row.get("offer_id") for row in failures]}
                too_frequent = all(any(
                    str(error.get("code") or "") == "TOO_MANY_REQUESTS"
                    and "updated too frequently" in str(error.get("message") or "").lower()
                    for error in (row.get("errors") or []) if isinstance(error, dict)
                ) for row in failures)
                if too_frequent:
                    # The previous request may still be applying at Ozon.  Do
                    # not immediately send a third write; the next scheduled
                    # pass will read first and only submit a real difference.
                    draft.stock_sync_status = "verifying"
                    draft.stock_sync_message = "Ozon 正在处理刚提交的库存，2 分钟后仅回读并补写差额"
                    draft.stock_sync_next_at = now + timedelta(minutes=2)
                    db.commit()
                    return {"status": "verifying", "reason": "stock_update_rate_limited"}
                raise RuntimeError("库存接口返回失败：" + json.dumps(failures[:3], ensure_ascii=False))

            readback = client.get_fbs_stocks_by_warehouse(offer_ids=sorted(ready_offer_ids))
            actual = {
                (str(row.get("offer_id")), int(row.get("warehouse_id") or 0)): int(row.get("present") or 0)
                for row in readback.get("products", [])
            }
            missing = [
                {"offer_id": offer, "warehouse_id": warehouse, "expected": target, "actual": actual.get((offer, warehouse))}
                for (offer, warehouse), target in expected.items()
                if actual.get((offer, warehouse)) != target
            ]
            if missing:
                draft.stock_sync_status = "verifying" if ready_offer_ids == set(offer_ids) else "partial"
                draft.stock_sync_message = f"库存已提交，等待 Ozon 回读生效：{len(expected)-len(missing)}/{len(expected)}；另有 {len(set(offer_ids) - ready_offer_ids)} 个 SKU 尚未进入 price_sent"
                draft.stock_sync_next_at = now + timedelta(seconds=30)
                db.commit()
                return {"status": draft.stock_sync_status, "missing": missing}

            unresolved = set(offer_ids) - ready_offer_ids
            if unresolved:
                draft.stock_sync_status = "partial"
                draft.stock_sync_message = f"Ozon 库存已确认：{len(expected)}/{len(offer_ids)} 个 SKU；其余 {len(unresolved)} 个尚未进入 price_sent，待后续导入任务"
                draft.stock_sync_next_at = None
                db.commit()
                return {"status": draft.stock_sync_status, "confirmed": len(expected), "pending": len(unresolved)}

            draft.stock_sync_status = "completed"
            draft.stock_sync_message = f"Ozon 库存已确认：{len(expected)} 个 SKU"
            draft.stock_sync_next_at = None
            draft.stock_synced_at = now
            draft.status = "submitted"
            draft.ozon_product_id = int(info_rows[0].get("id")) if info_rows else draft.ozon_product_id
            db.add(AuditEventRecord(
                shop_id=draft.shop_id, actor_id="system", action="listing_stock_confirmed",
                entity_type="listing_draft", entity_id=str(draft.id),
                details_json=json.dumps({"offer_id": draft.offer_id, "sku_count": len(expected)}, ensure_ascii=False),
            ))
            db.commit()
            return {"status": "completed", "confirmed": len(expected)}
    except Exception as exc:
        # A failed flush leaves SQLAlchemy's session unusable.  Roll it back
        # before recording the retry state; otherwise the real Ozon outcome
        # is lost behind a secondary PendingRollbackError.
        draft_id = draft.id
        db.rollback()
        draft = db.get(ListingDraftRecord, draft_id)
        if draft is None:
            return {"status": "retry", "message": str(exc)[:1000]}
        draft.stock_sync_status = "retry"
        draft.stock_sync_message = str(exc)[:1000]
        draft.stock_sync_next_at = now + _next_delay(draft.stock_sync_attempts)
        db.commit()
        return {"status": "retry", "message": draft.stock_sync_message}


def monitor_listing_stock(db: Session, draft: ListingDraftRecord) -> dict:
    """Serialize checks so the periodic worker and manual action cannot double-write stock."""
    if draft.stock_sync_status == "completed" and draft.stock_synced_at:
        return {
            "status": "completed",
            "confirmed": len(draft.variants),
            "message": draft.stock_sync_message or "Ozon 库存已确认",
        }
    if not _monitor_lock.acquire(blocking=False):
        return {"status": "checking", "message": "已有库存检查正在执行"}
    try:
        return _monitor_listing_stock(db, draft)
    finally:
        _monitor_lock.release()


def monitor_due_listing_stocks(db: Session, *, limit: int = 20) -> list[dict]:
    now = _now()
    drafts = list(db.scalars(
        select(ListingDraftRecord).where(
            ListingDraftRecord.stock_sync_status.in_((*PENDING_STATES, "verifying")),
            ListingDraftRecord.stock_sync_next_at <= now,
        ).order_by(ListingDraftRecord.stock_sync_next_at).limit(limit)
    ))
    return [{"draft_id": draft.id, **monitor_listing_stock(db, draft)} for draft in drafts]


def _chunks(values: list, size: int) -> list[list]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def audit_shop_fbs_inventory(db: Session, shop_id: int, *, max_details: int = 500) -> dict:
    """Read and reconcile the full Ozon FBS inventory surface for one shop.

    This intentionally starts from Ozon's product list rather than local
    listing drafts.  Legacy/live offers with no ERP draft are therefore part
    of the audit.  It performs only documented read calls and never invokes
    ``/v2/products/stocks``.
    """
    if shop_id <= 0:
        raise ValueError("店铺不存在")
    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key, timeout_seconds=60) as client:
        products: list[dict] = []
        last_id = ""
        while True:
            page = client.list_products(limit=1000, last_id=last_id).get("result", {})
            page_items = page.get("items") or []
            products.extend(row for row in page_items if str(row.get("offer_id") or "").strip())
            last_id = str(page.get("last_id") or "")
            if not last_id or len(page_items) < 1000:
                break

        product_ids = [int(row["product_id"]) for row in products if row.get("product_id")]
        info_by_offer: dict[str, dict] = {}
        for group in _chunks(product_ids, 1000):
            response = client.get_product_info(product_ids=group)
            for row in response.get("items") or []:
                offer_id = str(row.get("offer_id") or "").strip()
                if offer_id:
                    info_by_offer[offer_id] = row

        present_by_offer: dict[str, int] = {}
        stock_row_count = 0
        offer_ids = [str(row["offer_id"]).strip() for row in products]
        for group in _chunks(offer_ids, 1000):
            cursor = ""
            while True:
                response = client.get_fbs_stocks_by_warehouse(offer_ids=group, limit=1000, cursor=cursor)
                stock_rows = response.get("products") or []
                stock_row_count += len(stock_rows)
                for row in stock_rows:
                    offer_id = str(row.get("offer_id") or "").strip()
                    if offer_id:
                        present_by_offer[offer_id] = present_by_offer.get(offer_id, 0) + int(row.get("present") or 0)
                cursor = str(response.get("cursor") or response.get("result", {}).get("cursor") or "")
                if not cursor or not stock_rows:
                    break

    warehouses = list(db.scalars(select(Warehouse).where(Warehouse.shop_id == shop_id)))
    variants = list(db.scalars(
        select(ListingVariantRecord).join(ListingDraftRecord).where(ListingDraftRecord.shop_id == shop_id)
    ))
    local_inventory: dict[str, dict] = {}
    for variant in variants:
        offer_id = str(variant.seller_sku or "").strip()
        warehouse_id = _warehouse_id_for_variant(variant, warehouses)
        target_stock = int(variant.stock or 0)
        if offer_id and target_stock > 0 and warehouse_id:
            local_inventory[offer_id] = {
                "draft_id": variant.draft_id,
                "target_stock": target_stock,
                "warehouse_id": warehouse_id,
            }

    summary = {
        "shop_id": shop_id,
        "checked_at": _now().isoformat(),
        "ozon_product_count": len(products),
        "price_sent_count": 0,
        "positive_fbs_stock_count": 0,
        "zero_fbs_stock_count": 0,
        "missing_fbs_stock_record_count": 0,
        "not_price_sent_count": 0,
        "fbs_stock_row_count": stock_row_count,
        "price_sent_positive_fbs_stock_count": 0,
        "price_sent_zero_fbs_stock_count": 0,
        "price_sent_missing_fbs_stock_record_count": 0,
        "not_price_sent_positive_fbs_stock_count": 0,
        "not_price_sent_zero_fbs_stock_count": 0,
        "not_price_sent_missing_fbs_stock_record_count": 0,
        "stock_repair_plan_count": 0,
        "stock_repair_missing_local_evidence_count": 0,
    }
    details: list[dict] = []
    for product in products:
        offer_id = str(product.get("offer_id") or "").strip()
        info = info_by_offer.get(offer_id, {})
        status = str((info.get("statuses") or {}).get("status") or product.get("status") or "")
        present = present_by_offer.get(offer_id)
        if status == READY_STATUS:
            summary["price_sent_count"] += 1
            status_bucket = "price_sent"
        else:
            summary["not_price_sent_count"] += 1
            status_bucket = "not_price_sent"
        if present is None:
            summary["missing_fbs_stock_record_count"] += 1
            summary[f"{status_bucket}_missing_fbs_stock_record_count"] += 1
            state = "无 FBS 库存记录"
        elif present > 0:
            summary["positive_fbs_stock_count"] += 1
            summary[f"{status_bucket}_positive_fbs_stock_count"] += 1
            state = "库存正常"
        else:
            summary["zero_fbs_stock_count"] += 1
            summary[f"{status_bucket}_zero_fbs_stock_count"] += 1
            state = "FBS 库存为 0"
        local = local_inventory.get(offer_id)
        repair_candidate = status == READY_STATUS and state != "库存正常" and local is not None
        if repair_candidate:
            summary["stock_repair_plan_count"] += 1
        elif status == READY_STATUS and state != "库存正常":
            summary["stock_repair_missing_local_evidence_count"] += 1
        if state != "库存正常" or status != READY_STATUS:
            if len(details) < max_details:
                detail = {
                    "offer_id": offer_id,
                    "product_id": product.get("product_id") or info.get("id"),
                    "status": status or "未知",
                    "fbs_present": present,
                    "state": state,
                    "stock_repair_candidate": repair_candidate,
                }
                if local:
                    detail["local_inventory"] = local
                details.append(detail)

    return {"summary": summary, "issues": details, "issues_truncated": len(details) >= max_details}
