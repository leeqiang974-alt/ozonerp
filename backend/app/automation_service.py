from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .erp_models import AutomationCandidateRecord, AutomationEventRecord, AutomationRunRecord, AutomationTaskRecord
from .integrations.open1688 import detail_to_capture, get_product_details, search_jxhy_products
from .pipeline.category_matching import lock_category, match_categories
from .pipeline.attribute_mapping import map_attributes
from .pipeline.variant_mapping import map_variants
from .pipeline.content_generation import generate_content
from .pipeline.quality_check import run_quality_check
from .pipeline.publish_service import create_listing_draft_from_pipeline


# Sourcing guardrails keep unattended collection away from regulated,
# high-return, or hard-to-fulfil products before a human review.
DEFAULT_EXCLUSION_RULES: dict[str, tuple[str, ...]] = {
    "危险品或易燃易爆品": ("危险品", "易燃", "易爆", "烟花", "爆竹", "火药", "打火机", "气罐", "燃气", "酒精喷雾"),
    "液体或喷雾类": ("液体", "液态", "喷雾", "喷剂", "滴剂", "溶液", "香水", "精油", "油漆", "墨水"),
    "服装鞋靴高退货类": ("服装", "连衣裙", "上衣", "裤子", "内衣", "睡衣", "童装", "鞋", "靴", "袜子"),
    "农资、农药或驱虫液": ("农药", "杀虫剂", "杀菌剂", "除草剂", "杀虫水", "蚊子水", "驱蚊液", "肥料", "农资"),
    "工业品或原材料": ("工业", "化工", "原材料", "树脂", "颗粒", "粉末", "钢材", "铝材", "水泥", "胶水"),
}
MAX_WEIGHT_G = 2_000
MAX_EDGE_MM = 400
MAX_VOLUME_L = 20

# Used when an operator wants broad, directionless overnight discovery. Keep
# this pool bounded and biased toward ordinary, shippable household goods;
# title/package risk gates still run on every result.
SYSTEM_EXPLORATION_KEYWORDS: tuple[str, ...] = (
    "家居用品", "收纳用品", "厨房用品", "清洁用品", "办公用品",
    "日用百货", "宠物用品", "户外用品", "小工具", "家装用品",
)


def exclusion_reason(text: str) -> str | None:
    normalized = str(text or "").lower().replace(" ", "")
    for label, terms in DEFAULT_EXCLUSION_RULES.items():
        if any(term.lower() in normalized for term in terms):
            return label
    return None


def package_limit_reason(package: dict) -> str | None:
    """Reject only when official detail positively proves the item is oversized."""
    values = package.get("product_package") or {}
    weight = float(values.get("weightG") or 0)
    dimensions = [float(values.get(key) or 0) for key in ("lengthMm", "widthMm", "heightMm")]
    if weight > MAX_WEIGHT_G:
        return f"重量 {weight:g}g 超过挂机采集上限 {MAX_WEIGHT_G:g}g"
    if max(dimensions, default=0) > MAX_EDGE_MM:
        return f"单边 {max(dimensions):g}mm 超过挂机采集上限 {MAX_EDGE_MM:g}mm"
    if all(dimensions):
        volume_l = dimensions[0] * dimensions[1] * dimensions[2] / 1_000_000
        if volume_l > MAX_VOLUME_L:
            return f"体积 {volume_l:.1f}L 超过挂机采集上限 {MAX_VOLUME_L:g}L"
    return None


def capture_searchable_text(capture: dict) -> str:
    attributes = capture.get("attributes") or []
    attribute_text = " ".join(
        f"{item.get('attributeName') or item.get('name') or ''} {item.get('value') or item.get('attributeValue') or ''}"
        for item in attributes if isinstance(item, dict)
    )
    return " ".join((str(capture.get("title") or ""), str(capture.get("description") or ""), attribute_text))


def expand_search_keywords(keywords: list[str]) -> list[str]:
    """Expand a product intent after the exact 1688 term is exhausted."""
    specific = {
        "硅胶模具": ["食品级硅胶模具", "烘焙硅胶模具", "冰格硅胶模具", "蛋糕硅胶模具", "巧克力硅胶模具",
                     "糖果硅胶模具", "翻糖硅胶模具", "DIY硅胶模具", "厨房硅胶模具", "耐高温硅胶模具"],
    }
    expanded: list[str] = []
    for raw in keywords:
        keyword = str(raw).strip()
        if not keyword: continue
        variants = [keyword, *specific.get(keyword, []), f"食品级{keyword}", f"家用{keyword}", f"厨房{keyword}",
                    f"厂家直销{keyword}", f"一件代发{keyword}"]
        for value in variants:
            if value not in expanded: expanded.append(value)
    return expanded[:30]


def resolve_search_keywords(keywords: list[str]) -> tuple[list[str], bool]:
    """Return explicit terms or the default broad exploration rotation."""
    cleaned = [str(value).strip() for value in (keywords or []) if str(value).strip()]
    if cleaned:
        return expand_search_keywords(cleaned), False
    return expand_search_keywords(list(SYSTEM_EXPLORATION_KEYWORDS)), True


def _event(db: Session, run: AutomationRunRecord, level: str, stage: str, message: str, details=None) -> None:
    db.add(AutomationEventRecord(run_id=run.id, task_id=run.task_id, level=level, stage=stage,
                                 message=message, details_json=json.dumps(details, ensure_ascii=False) if details else None))
    db.commit()


def execute_task(db: Session, task: AutomationTaskRecord, shop_id: int | None = None) -> AutomationRunRecord:
    # Recover stale runs left by a process crash. A live caller is protected by
    # the route/scheduler concurrency check; old running rows must not block forever.
    for stale in db.scalars(select(AutomationRunRecord).where(
        AutomationRunRecord.task_id == task.id, AutomationRunRecord.status == "running"
    )):
        stale.status = "failed"; stale.error_summary = "运行进程中断，已标记为可重试"; stale.finished_at = datetime.now(timezone.utc)
    db.commit()
    run = AutomationRunRecord(task_id=task.id, status="running", current_stage="search", started_at=datetime.now(timezone.utc))
    db.add(run); db.commit(); db.refresh(run)
    filters = json.loads(task.filters_json or "{}")
    excluded = [value.lower() for value in json.loads(task.excluded_keywords_json or "[]")]
    candidates: dict[str, dict] = {}
    try:
        # daily_target means qualified products, not first-page search hits. Search
        # every available page (bounded for safety) and keep enough alternatives
        # so package/stock rejection can be replaced by later results.
        max_search_candidates = min(max(task.daily_target * 50, 500), 5000)
        source_exhausted = True
        search_keywords, exploration_mode = resolve_search_keywords(json.loads(task.keywords_json or "[]"))
        _event(db, run, "info", "search",
               "未指定关键词，使用系统轮换探索词池" if exploration_mode else "使用计划指定关键词",
               {"exploration_mode": exploration_mode, "keyword_total": len(search_keywords)})
        for keyword_index, keyword in enumerate(search_keywords, start=1):
            _event(db, run, "info", "search", f"搜索第 {keyword_index}/{len(search_keywords)} 组关键词：{keyword}",
                   {"keyword":keyword,"keyword_index":keyword_index,"keyword_total":len(search_keywords)})
            page_num = 1
            while page_num <= 100 and len(candidates) < max_search_candidates:
                result = search_jxhy_products(keyword, page_num=page_num, page_size=50)
                rows = result.get("items") or []
                for item in rows:
                    offer_id = str(item.get("offer_id") or "")
                    title = str(item.get("title") or "")
                    if not offer_id or any(word in title.lower() for word in excluded): continue
                    risk_reason = exclusion_reason(title)
                    if risk_reason:
                        candidates.setdefault(offer_id, {**item, "_precheck_rejection": risk_reason})
                        continue
                    price = float(item.get("price_min") or 0)
                    if filters.get("min_price") is not None and price < filters["min_price"]: continue
                    if filters.get("max_price") is not None and price > filters["max_price"]: continue
                    if int(item.get("sales_90d") or 0) < int(filters.get("min_sales_90d") or 0): continue
                    services = item.get("services") or []
                    if filters.get("require_48h_shipping") and not any(s.get("code") == "ssbxsfh" for s in services if isinstance(s, dict)): continue
                    candidates.setdefault(offer_id, item)
                total = int(result.get("total") or len(rows))
                if not rows or page_num * int(result.get("page_size") or 50) >= total: break
                page_num += 1
            _event(db, run, "info", "search", f"关键词“{keyword}”已完成，累计发现 {len(candidates)} 个不重复候选")
            if len(candidates) >= max_search_candidates:
                source_exhausted = False; break
        # A category-scoped task may carry one target shop. This is only a
        # recommendation on the candidate; source_products is still created
        # only after the operator starts manual listing.
        recommended_shop_id = next(iter(filters.get("shop_ids") or []), None)
        for item in candidates.values():
            db.add(AutomationCandidateRecord(run_id=run.id, task_id=task.id, offer_id=item["offer_id"], title=item["title"],
                image_url=item.get("image_url"), source_url=item.get("url"), price_min=Decimal(str(item.get("price_min") or 0)),
                sales_90d=int(item.get("sales_90d") or 0), status="risk_rejected" if item.get("_precheck_rejection") else "detail_pending",
                shop_id=recommended_shop_id,
                rejection_reason=f"已自动跳过：{item['_precheck_rejection']}" if item.get("_precheck_rejection") else None))
        run.discovered_count = len(candidates); run.current_stage = "package"; db.commit()
        _event(db, run, "info", "search", f"搜索完成，发现 {len(candidates)} 个初筛候选")
        offer_ids = [offer_id for offer_id, item in candidates.items() if not item.get("_precheck_rejection")]
        precheck_rejected = len(candidates) - len(offer_ids)
        if precheck_rejected:
            run.failed_count += precheck_rejected
            db.commit()
            _event(db, run, "info", "search", f"已按风险规则跳过 {precheck_rejected} 个标题命中候选")
        for start in range(0, len(offer_ids), 20):
            if run.collected_count >= task.daily_target: break
            details = get_product_details(offer_ids[start:start + 20])
            returned = set()
            for detail in details:
                if run.collected_count >= task.daily_target: break
                capture, package = detail_to_capture(detail); offer_id = package["offer_id"]; returned.add(offer_id)
                row = db.scalar(select(AutomationCandidateRecord).where(AutomationCandidateRecord.run_id == run.id, AutomationCandidateRecord.offer_id == offer_id))
                if not row: continue
                run.inspected_count += 1; row.package_json = json.dumps(package, ensure_ascii=False)
                variants = capture.get("skuVariants") or []
                stocked = [v for v in variants if int(v.get("stock") or 0) >= int(filters.get("min_stock") or 0)]
                risk_reason = exclusion_reason(capture_searchable_text(capture))
                limit_reason = package_limit_reason(package)
                if risk_reason:
                    row.status = "risk_rejected"; row.rejection_reason = f"已自动跳过：{risk_reason}"; run.failed_count += 1
                elif limit_reason:
                    row.status = "oversize_rejected"; row.rejection_reason = f"已自动跳过：{limit_reason}"; run.failed_count += 1
                elif not package["has_complete_package"]:
                    capture["skuVariants"] = stocked
                    row.status = "package_pending"; row.capture_json = json.dumps(capture, ensure_ascii=False)
                    row.rejection_reason = "尺重缺失：官方详情未找到完整重量或包装长宽高，请人工确认"
                    # Keep the capture visible for an operator, but do not
                    # count it toward the unattended qualified target.  A
                    # missing package is a pending/failed quality gate, not a
                    # product that can safely enter the listing queue.
                    run.failed_count += 1
                elif not stocked:
                    row.status = "filter_rejected"; row.rejection_reason = "已自动跳过：没有满足最低库存的 SKU"; run.failed_count += 1
                else:
                    capture["skuVariants"] = stocked
                    row.status = "ready_for_review"; row.capture_json = json.dumps(capture, ensure_ascii=False)
                    run.qualified_count += 1; run.collected_count += 1
            missing = set() if run.collected_count >= task.daily_target else set(offer_ids[start:start + 20]) - returned
            for offer_id in missing:
                row = db.scalar(select(AutomationCandidateRecord).where(AutomationCandidateRecord.run_id == run.id, AutomationCandidateRecord.offer_id == offer_id))
                if row: row.status = "detail_failed"; row.rejection_reason = "官方详情接口未返回"; run.failed_count += 1
            db.commit()
        run.status = "completed"; run.current_stage = "review"; run.finished_at = datetime.now(timezone.utc)
        task.last_run_at = run.finished_at; db.commit()
        completion = (f"已达到目标 {task.daily_target} 个合格商品" if run.collected_count >= task.daily_target else
                      f"数据源已耗尽；目标 {task.daily_target}，实际待人工处理 {run.collected_count}")
        _event(db, run, "info", "review", f"运行完成：{completion}；检查 {run.inspected_count}，淘汰或待补 {run.failed_count}")
        return run
    except Exception as exc:
        run_id = run.id
        db.rollback()
        run = db.get(AutomationRunRecord, run_id)
        run.status = "failed"; run.error_summary = str(exc)[:1000]; run.failed_count += 1; run.finished_at = datetime.now(timezone.utc); db.commit()
        _event(db, run, "error", run.current_stage, f"任务失败：{exc}")
        raise


def process_candidate_ai(db: Session, candidate: AutomationCandidateRecord, *, min_category_score: float = 60, min_quality_score: float = 75) -> dict:
    """Advance one collected candidate to a local draft; never approve or publish."""
    if candidate.status not in {"collected", "ai_failed", "needs_review"} or not candidate.source_record_id or not candidate.shop_id:
        raise ValueError("候选商品尚未采集，不能生成 AI 商品卡")
    candidate.status = "ai_processing"; candidate.rejection_reason = None; db.commit()
    try:
        _, categories = match_categories(db, candidate.shop_id, candidate.source_record_id)
        if not categories or float(categories[0].score or 0) < min_category_score:
            candidate.status = "needs_review"; candidate.rejection_reason = "Ozon 类目匹配置信度不足"; db.commit()
            return {"status": candidate.status, "reason": candidate.rejection_reason}
        top = categories[0]
        lock_category(db, candidate.shop_id, candidate.source_record_id, top.category_id, top.type_id)
        attributes = map_attributes(db, candidate.shop_id, candidate.source_record_id)
        if float(attributes.get("coverage") or attributes.get("coverage_percent") or 0) < 100:
            candidate.status = "needs_review"; candidate.rejection_reason = "Ozon 必填属性未完全匹配"; db.commit()
            return {"status": candidate.status, "reason": candidate.rejection_reason}
        map_variants(db, candidate.shop_id, candidate.source_record_id)
        content = generate_content(db, candidate.shop_id, candidate.source_record_id)
        quality = run_quality_check(db, candidate.shop_id, candidate.source_record_id)
        score = float(quality.get("overall_score") or quality.get("score") or 0)
        issues = quality.get("issues") or []
        if not content.get("content_verified") or score < min_quality_score or issues:
            candidate.status = "needs_review"; candidate.rejection_reason = f"质量门禁未通过（{score:.0f}分，{len(issues)}项问题）"; db.commit()
            return {"status": candidate.status, "score": score, "issues": issues, "reason": candidate.rejection_reason}
        draft = create_listing_draft_from_pipeline(db, candidate.shop_id, candidate.source_record_id)
        candidate.status = "draft_ready"; db.commit()
        return {"status": candidate.status, "score": score, "draft_id": draft.id}
    except Exception as exc:
        db.rollback(); candidate = db.get(AutomationCandidateRecord, candidate.id)
        candidate.status = "ai_failed"; candidate.rejection_reason = str(exc)[:1000]; db.commit()
        return {"status": candidate.status, "reason": candidate.rejection_reason}
