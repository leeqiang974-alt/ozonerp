"""Trusted decision memory for category and attribute automation.

Automatic suggestions are deliberately read-only. Only explicit operator
confirmation/correction or an Ozon outcome may create or strengthen memory.
"""

from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .erp_models import DecisionFeedbackReceiptRecord, DecisionFeedbackRecord, DecisionMemoryRecord, ListingDraftRecord, OzonGlobalCategoryCacheRecord, SourceProductRecord, SourceProductShopRecord
from .listing_cache_service import promote_legacy_listing_caches


def classify_domain(title: str, material: str = "") -> str:
    value = f"{title} {material}".lower()
    if "模具" in value and any(word in value for word in ("蛋糕", "烘焙", "甜品", "冰格", "糖果", "巧克力", "厨房", "食品", "饼干")):
        return "culinary_mold"
    if "模具" in value:
        return "general_mold"
    if any(word in value for word in ("服装", "裙", "裤", "上衣", "衬衫")):
        return "apparel"
    if any(word in value for word in ("首饰", "项链", "耳环", "胸针", "徽章")):
        return "jewelry"
    if any(word in value for word in ("收纳", "整理盒", "置物")):
        return "storage"
    return "general"


def domain_category_compatible(domain: str, category_title: str) -> bool:
    value = (category_title or "").lower()
    if domain == "culinary_mold":
        if any(word in value for word in ("服装", "首饰", "徽章", "胸针", "收纳", "饰品")):
            return False
        return any(word in value for word in ("烹饪", "烘焙", "炊具", "冰格", "糖果", "厨房", "模具"))
    if domain == "general_mold":
        return not any(word in value for word in ("服装", "首饰", "徽章", "胸针"))
    return True


def _tokens(value: str) -> set[str]:
    compact = re.sub(r"[^\w\u4e00-\u9fff]", "", value.lower())
    result = {part for part in re.split(r"[\s,，、/\\\[\]()（）【】]+", value.lower()) if part}
    result.update(compact[i:i + 2] for i in range(max(0, len(compact) - 1)))
    return result


def _fingerprint(domain: str, title: str, material: str = "") -> str:
    stable = "|".join((domain, " ".join(sorted(_tokens(title))), material.strip().lower()))
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


def _similarity(left: str, right: str) -> float:
    a, b = _tokens(left), _tokens(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _source_context(db: Session, shop_id: int, source_product_id: int | None, title: str, material: str) -> tuple[SourceProductRecord | None, str, str]:
    product = db.get(SourceProductRecord, source_product_id) if source_product_id else None
    if source_product_id and product is None:
        raise ValueError("source product not found")
    if product and product.shop_id != shop_id:
        shared = db.scalar(select(SourceProductShopRecord.id).where(
            SourceProductShopRecord.source_product_id == product.id,
            SourceProductShopRecord.shop_id == shop_id,
            SourceProductShopRecord.is_deleted.is_(False),
        ))
        if shared is None:
            raise ValueError("source product does not belong to this shop")
    resolved_title = (product.title if product else title).strip()
    resolved_material = ((product.material or "") if product else material).strip()
    return product, resolved_title, resolved_material


def record_category_decision(
    db: Session, *, shop_id: int, category_id: str, type_id: str,
    category_title: str, learning_mode: str, source_product_id: int | None = None,
    title: str = "", material: str = "", actor: str = "operator", commit: bool = True,
) -> DecisionMemoryRecord | None:
    if learning_mode not in {"confirm", "remember", "one_off", "ozon"}:
        raise ValueError("learning_mode must be confirm, remember, one_off, or ozon")
    product, resolved_title, resolved_material = _source_context(db, shop_id, source_product_id, title, material)
    if not resolved_title:
        raise ValueError("product title is required")
    domain = classify_domain(resolved_title, resolved_material)
    decision = {"category_id": category_id, "type_id": type_id, "category_title": category_title}
    if learning_mode == "one_off":
        db.add(DecisionFeedbackRecord(
            shop_id=shop_id, source_product_id=product.id if product else None,
            action="one_off", after_json=json.dumps(decision, ensure_ascii=False), actor=actor,
            details_json=json.dumps({"title": resolved_title, "domain": domain}, ensure_ascii=False),
        ))
        if commit:
            db.commit()
        else:
            db.flush()
        return None

    fingerprint = _fingerprint(domain, resolved_title, resolved_material)
    key = f"category:{category_id}:{type_id}"
    conflicting = db.scalars(select(DecisionMemoryRecord).where(
        DecisionMemoryRecord.shop_id == shop_id,
        DecisionMemoryRecord.decision_type == "category",
        DecisionMemoryRecord.product_fingerprint == fingerprint,
        DecisionMemoryRecord.decision_key != key,
        DecisionMemoryRecord.status != "revoked",
    )).all()
    for old_memory in conflicting:
        previous_status = old_memory.status
        old_memory.status = "revoked"
        db.add(DecisionFeedbackRecord(
            memory_id=old_memory.id, shop_id=shop_id,
            source_product_id=product.id if product else None, action="superseded",
            actor=actor, before_json=json.dumps({"status": previous_status}),
            after_json=json.dumps({"status": "revoked", "replaced_by": key}),
        ))
    memory = db.scalar(select(DecisionMemoryRecord).where(
        DecisionMemoryRecord.shop_id == shop_id,
        DecisionMemoryRecord.decision_type == "category",
        DecisionMemoryRecord.product_fingerprint == fingerprint,
        DecisionMemoryRecord.decision_key == key,
    ))
    before = None
    if memory:
        before = memory.decision_value_json
        if learning_mode == "ozon":
            memory.ozon_success_count += 1
        else:
            memory.confirmation_count += 1
        memory.trust_score = min(Decimal("0.9500"), Decimal(memory.trust_score) + Decimal("0.0500"))
        memory.status = "active"
        memory.source = "ozon_verified" if learning_mode == "ozon" else ("manual_confirmed" if learning_mode == "confirm" else "manual_corrected")
        memory.decision_value_json = json.dumps(decision, ensure_ascii=False)
    else:
        memory = DecisionMemoryRecord(
            shop_id=shop_id, decision_type="category", source_product_id=product.id if product else None,
            product_fingerprint=fingerprint, domain=domain, title=resolved_title,
            facts_json=json.dumps({"title": resolved_title, "material": resolved_material, "domain": domain}, ensure_ascii=False),
            decision_key=key, decision_value_json=json.dumps(decision, ensure_ascii=False),
            evidence_json=json.dumps({"learning_mode": learning_mode, "actor": actor}, ensure_ascii=False),
            source="ozon_verified" if learning_mode == "ozon" else ("manual_confirmed" if learning_mode == "confirm" else "manual_corrected"),
            trust_score=Decimal("0.9000") if learning_mode == "ozon" else (Decimal("0.7500") if learning_mode == "confirm" else Decimal("0.8000")),
            confirmation_count=0 if learning_mode == "ozon" else 1,
            ozon_success_count=1 if learning_mode == "ozon" else 0,
        )
        db.add(memory)
        db.flush()
    db.add(DecisionFeedbackRecord(
        memory_id=memory.id, shop_id=shop_id, source_product_id=product.id if product else None,
        action="ozon_verified" if learning_mode == "ozon" else ("confirmed" if learning_mode == "confirm" else "corrected"),
        before_json=before, after_json=json.dumps(decision, ensure_ascii=False), actor=actor,
    ))
    if commit:
        db.commit()
        db.refresh(memory)
    else:
        db.flush()
    return memory


def recommend_categories(db: Session, *, shop_id: int, title: str, material: str = "", source_product_id: int | None = None, limit: int = 5) -> list[dict[str, Any]]:
    promote_legacy_listing_caches(db)
    _, resolved_title, resolved_material = _source_context(db, shop_id, source_product_id, title, material)
    domain = classify_domain(resolved_title, resolved_material)
    rows = db.scalars(select(DecisionMemoryRecord).where(
        DecisionMemoryRecord.shop_id == shop_id,
        DecisionMemoryRecord.decision_type == "category",
        DecisionMemoryRecord.status == "active",
        DecisionMemoryRecord.trust_score >= Decimal("0.7000"),
        DecisionMemoryRecord.domain == domain,
    )).all()
    recommendations: list[dict[str, Any]] = []
    for row in rows:
        decision = json.loads(row.decision_value_json)
        category = db.scalar(select(OzonGlobalCategoryCacheRecord).where(
            OzonGlobalCategoryCacheRecord.category_id == str(decision["category_id"]),
            OzonGlobalCategoryCacheRecord.type_id == str(decision["type_id"]),
        ))
        label = (category.title_zh or category.title) if category else decision.get("category_title", "")
        if not category or not domain_category_compatible(domain, label):
            continue
        similarity = _similarity(resolved_title, row.title)
        confidence = round(float(row.trust_score) * (0.6 + 0.4 * similarity), 4)
        if similarity < 0.10 or confidence < 0.50:
            continue
        recommendations.append({
            "memory_id": row.id, "category_id": decision["category_id"], "type_id": decision["type_id"],
            "title": label, "title_zh": label, "source": "trusted_memory",
            "score": int(confidence * 1000), "confidence": confidence,
            "evidence": {"similar_title": row.title, "similarity": round(similarity, 4), "trust": float(row.trust_score), "source": row.source},
        })
    return sorted(recommendations, key=lambda item: item["confidence"], reverse=True)[:limit]


def record_listing_attribute_memories(db: Session, draft: ListingDraftRecord, *, actor: str = "ozon", commit: bool = True) -> int:
    """Persist checked, non-empty attributes after a listing is accepted by Ozon."""
    if not draft.source_product_id or not draft.category_id or not draft.type_id:
        return 0
    selected_ids = set(draft.learning_attribute_ids)
    if not selected_ids:
        return 0
    product, title, material = _source_context(db, draft.shop_id, draft.source_product_id, draft.title, "")
    domain = classify_domain(title, material)
    scope = hashlib.sha256(f"category|{draft.shop_id}|{draft.category_id}|{draft.type_id}".encode("utf-8")).hexdigest()
    count = 0
    for attribute in draft.attribute_values:
        if str(attribute.attribute_id) not in selected_ids or not (attribute.value_id or attribute.value_text):
            continue
        key = f"attribute:{draft.category_id}:{draft.type_id}:{attribute.attribute_id}"
        decision = {
            "category_id": str(draft.category_id), "type_id": str(draft.type_id),
            "attribute_id": str(attribute.attribute_id), "name": attribute.name,
            "value_id": attribute.value_id, "value_text": attribute.value_text,
        }
        memory = db.scalar(select(DecisionMemoryRecord).where(
            DecisionMemoryRecord.shop_id == draft.shop_id,
            DecisionMemoryRecord.decision_type == "attribute",
            DecisionMemoryRecord.product_fingerprint == scope,
            DecisionMemoryRecord.decision_key == key,
        ))
        before = memory.decision_value_json if memory else None
        if memory:
            memory.decision_value_json = json.dumps(decision, ensure_ascii=False)
            memory.source_product_id = product.id if product else None
            memory.title = title
            memory.status = "active"
            memory.source = "ozon_verified"
            memory.ozon_success_count += 1
            memory.trust_score = min(Decimal("1.0000"), Decimal(memory.trust_score) + Decimal("0.1000"))
        else:
            memory = DecisionMemoryRecord(
                shop_id=draft.shop_id, decision_type="attribute",
                source_product_id=product.id if product else None, product_fingerprint=scope,
                domain=domain, title=title,
                facts_json=json.dumps({"category_id": draft.category_id, "type_id": draft.type_id, "domain": domain}, ensure_ascii=False),
                decision_key=key, decision_value_json=json.dumps(decision, ensure_ascii=False),
                evidence_json=json.dumps({"draft_id": draft.id, "offer_id": draft.offer_id}, ensure_ascii=False),
                source="ozon_verified", trust_score=Decimal("0.9000"),
                confirmation_count=0, ozon_success_count=1,
            )
            db.add(memory)
            db.flush()
        db.add(DecisionFeedbackRecord(
            memory_id=memory.id, shop_id=draft.shop_id, source_product_id=draft.source_product_id,
            action="ozon_verified", actor=actor, before_json=before,
            after_json=json.dumps(decision, ensure_ascii=False),
            details_json=json.dumps({"draft_id": draft.id, "offer_id": draft.offer_id}, ensure_ascii=False),
        ))
        count += 1
    if commit:
        db.commit()
    else:
        db.flush()
    return count


def recommend_attribute_memories(db: Session, *, shop_id: int, category_id: str, type_id: str) -> dict[str, dict[str, Any]]:
    scope = hashlib.sha256(f"category|{shop_id}|{category_id}|{type_id}".encode("utf-8")).hexdigest()
    rows = db.scalars(select(DecisionMemoryRecord).where(
        DecisionMemoryRecord.shop_id == shop_id,
        DecisionMemoryRecord.decision_type == "attribute",
        DecisionMemoryRecord.product_fingerprint == scope,
        DecisionMemoryRecord.status == "active",
        DecisionMemoryRecord.trust_score >= Decimal("0.7000"),
    )).all()
    return {
        str(value["attribute_id"]): {
            **value, "method": "trusted_memory", "memory_id": row.id,
            "confidence": float(row.trust_score),
        }
        for row in rows
        for value in [json.loads(row.decision_value_json)]
    }


def finalize_successful_listing_memories(db: Session, draft: ListingDraftRecord, *, task_id: str) -> dict[str, int]:
    """Create/strengthen final category and checked-attribute memories exactly once."""
    promote_legacy_listing_caches(db, category_id=str(draft.category_id or ""), type_id=str(draft.type_id or ""))
    event_key = f"listing-memory:{draft.shop_id}:{task_id}:imported"
    if db.scalar(select(DecisionFeedbackReceiptRecord.id).where(
        DecisionFeedbackReceiptRecord.event_key == event_key,
    )) is not None:
        return {"category": 0, "attributes": 0}
    receipt = DecisionFeedbackReceiptRecord(
        event_key=event_key, shop_id=draft.shop_id,
        source_product_id=draft.source_product_id,
        outcome="imported",
        details_json="{}",
    )
    try:
        # Reserve the unique task receipt before touching memories. A concurrent
        # worker loses here and rolls back without incrementing any counters.
        db.add(receipt)
        db.flush()
        category_count = 0
        if draft.source_product_id and draft.category_id and draft.type_id:
            category = db.scalar(select(OzonGlobalCategoryCacheRecord).where(
                OzonGlobalCategoryCacheRecord.category_id == str(draft.category_id),
                OzonGlobalCategoryCacheRecord.type_id == str(draft.type_id),
            ))
            record_category_decision(
                db, shop_id=draft.shop_id, source_product_id=draft.source_product_id,
                category_id=str(draft.category_id), type_id=str(draft.type_id),
                category_title=(category.title_zh or category.title) if category else "",
                learning_mode="ozon", actor="ozon_import", commit=False,
            )
            category_count = 1
        attribute_count = record_listing_attribute_memories(db, draft, actor="ozon_import", commit=False)
        receipt.details_json = json.dumps({
            "draft_id": draft.id, "offer_id": draft.offer_id,
            "category_memories": category_count, "attribute_memories": attribute_count,
        }, ensure_ascii=False)
        db.commit()
    except IntegrityError:
        db.rollback()
        return {"category": 0, "attributes": 0}
    return {"category": category_count, "attributes": attribute_count}


def apply_ozon_feedback(db: Session, *, shop_id: int, source_product_id: int, accepted: bool, details: dict[str, Any] | None = None, decision_types: set[str] | None = None, event_key: str | None = None) -> int:
    if event_key and db.scalar(select(DecisionFeedbackReceiptRecord.id).where(DecisionFeedbackReceiptRecord.event_key == event_key)) is not None:
        return 0
    rows = db.scalars(select(DecisionMemoryRecord).where(
        DecisionMemoryRecord.shop_id == shop_id,
        DecisionMemoryRecord.source_product_id == source_product_id,
        DecisionMemoryRecord.status.in_(("active", "negative")),
    )).all()
    if decision_types is not None:
        rows = [row for row in rows if row.decision_type in decision_types]
    for memory in rows:
        before = {"trust_score": float(memory.trust_score), "status": memory.status}
        if accepted:
            memory.ozon_success_count += 1
            memory.trust_score = min(Decimal("1.0000"), Decimal(memory.trust_score) + Decimal("0.1000"))
            memory.status = "active" if Decimal(memory.trust_score) >= Decimal("0.7000") else "negative"
        else:
            memory.rejection_count += 1
            memory.trust_score = max(Decimal("0.0000"), Decimal(memory.trust_score) - Decimal("0.3500"))
            if Decimal(memory.trust_score) < Decimal("0.7000"):
                memory.status = "negative"
        db.add(DecisionFeedbackRecord(
            memory_id=memory.id, shop_id=shop_id, source_product_id=source_product_id,
            action="ozon_accepted" if accepted else "ozon_rejected", actor="ozon",
            before_json=json.dumps(before),
            after_json=json.dumps({"trust_score": float(memory.trust_score), "status": memory.status}),
            details_json=json.dumps(details or {}, ensure_ascii=False),
        ))
    if event_key:
        db.add(DecisionFeedbackReceiptRecord(
            event_key=event_key, shop_id=shop_id, source_product_id=source_product_id,
            outcome="accepted" if accepted else "rejected",
            details_json=json.dumps(details or {}, ensure_ascii=False),
        ))
    db.commit()
    return len(rows)
