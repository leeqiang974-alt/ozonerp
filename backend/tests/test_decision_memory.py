"""Trusted-memory tests use an isolated in-memory database only."""

from decimal import Decimal

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.decision_memory_service import (
    apply_ozon_feedback,
    finalize_successful_listing_memories,
    recommend_attribute_memories,
    record_category_decision,
    recommend_categories,
)
from app.erp_models import (
    DecisionFeedbackReceiptRecord,
    DecisionMemoryRecord,
    ListingAttributeValueRecord,
    ListingDraftRecord,
    OzonCategoryCacheRecord,
    SourceProductRecord,
)
from app.models import Shop
from app.main import DecisionMemoryStatusRequest, MatchCategoryRequest, ai_match_category, update_decision_memory_status
from fastapi import HTTPException


def _fixture():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    db = Session(engine)
    shop = Shop(name="memory-test", currency="CNY")
    db.add(shop); db.commit(); db.refresh(shop)
    db.add_all([
        OzonCategoryCacheRecord(shop_id=shop.id, category_id="cook", type_id="mold", title="Cooking mold", title_zh="烹饪配件 / 冰格、糖果模具"),
        OzonCategoryCacheRecord(shop_id=shop.id, category_id="fashion", type_id="badge", title="Badge", title_zh="服装首饰 / 徽章"),
    ])
    product = SourceProductRecord(shop_id=shop.id, source_product_id="memory-1", title="六孔硅胶蛋糕甜品装饰模具", material="硅胶")
    db.add(product); db.commit(); db.refresh(product)
    return db, shop, product


def test_one_off_selection_never_creates_memory():
    db, shop, product = _fixture()
    record_category_decision(db, shop_id=shop.id, source_product_id=product.id, category_id="cook", type_id="mold", category_title="烹饪配件 / 冰格、糖果模具", learning_mode="one_off")
    assert db.scalar(select(DecisionMemoryRecord)) is None
    db.close()


def test_explicit_correction_is_retrievable_with_evidence():
    db, shop, product = _fixture()
    memory = record_category_decision(db, shop_id=shop.id, source_product_id=product.id, category_id="cook", type_id="mold", category_title="烹饪配件 / 冰格、糖果模具", learning_mode="remember")
    recommendations = recommend_categories(db, shop_id=shop.id, title="硅胶冰格蛋糕烘焙模具", material="硅胶")
    assert memory is not None
    assert recommendations[0]["category_id"] == "cook"
    assert recommendations[0]["source"] == "trusted_memory"
    assert recommendations[0]["evidence"]["trust"] == 0.8
    db.close()


def test_domain_gate_blocks_bad_cross_domain_memory():
    db, shop, product = _fixture()
    record_category_decision(db, shop_id=shop.id, source_product_id=product.id, category_id="fashion", type_id="badge", category_title="服装首饰 / 徽章", learning_mode="remember")
    assert recommend_categories(db, shop_id=shop.id, title="硅胶冰格蛋糕烘焙模具", material="硅胶") == []
    db.close()


def test_correction_revokes_previous_decision_for_same_product():
    db, shop, product = _fixture()
    old = record_category_decision(db, shop_id=shop.id, source_product_id=product.id, category_id="fashion", type_id="badge", category_title="服装首饰 / 徽章", learning_mode="confirm")
    new = record_category_decision(db, shop_id=shop.id, source_product_id=product.id, category_id="cook", type_id="mold", category_title="烹饪配件 / 冰格、糖果模具", learning_mode="remember")
    db.refresh(old); db.refresh(new)
    assert old.status == "revoked"
    assert new.status == "active"
    assert [item["category_id"] for item in recommend_categories(db, shop_id=shop.id, title=product.title, material="硅胶")] == ["cook"]
    db.close()


def test_unrelated_ozon_failure_does_not_demote_category_memory():
    db, shop, product = _fixture()
    memory = record_category_decision(db, shop_id=shop.id, source_product_id=product.id, category_id="cook", type_id="mold", category_title="烹饪配件 / 冰格、糖果模具", learning_mode="remember")
    changed = apply_ozon_feedback(db, shop_id=shop.id, source_product_id=product.id, accepted=False, details={"reason": "bad image"}, decision_types=set())
    db.refresh(memory)
    assert changed == 0
    assert Decimal(memory.trust_score) == Decimal("0.8000")
    db.close()


def test_source_product_cannot_train_an_unrelated_shop():
    db, shop, product = _fixture()
    other = Shop(name="other-shop", currency="CNY")
    db.add(other); db.commit(); db.refresh(other)
    with pytest.raises(ValueError, match="does not belong"):
        record_category_decision(db, shop_id=other.id, source_product_id=product.id, category_id="cook", type_id="mold", category_title="烹饪配件 / 冰格、糖果模具", learning_mode="remember")
    db.close()


def test_trusted_memory_replaces_normal_candidate_metadata_on_collision():
    db, shop, product = _fixture()
    record_category_decision(db, shop_id=shop.id, source_product_id=product.id, category_id="cook", type_id="mold", category_title="烹饪配件 / 冰格、糖果模具", learning_mode="remember")
    result = ai_match_category(shop.id, MatchCategoryRequest(title=product.title, material="硅胶", source_product_id=product.id), db)
    candidate = next(item for item in result["candidates"] if item["category_id"] == "cook")
    assert candidate["source"] == "trusted_memory"
    assert candidate["evidence"]["source"] == "manual_corrected"
    db.close()


def test_ozon_feedback_event_key_is_idempotent():
    db, shop, product = _fixture()
    memory = record_category_decision(db, shop_id=shop.id, source_product_id=product.id, category_id="cook", type_id="mold", category_title="烹饪配件 / 冰格、糖果模具", learning_mode="remember")
    first = apply_ozon_feedback(db, shop_id=shop.id, source_product_id=product.id, accepted=True, event_key="task:1:imported")
    second = apply_ozon_feedback(db, shop_id=shop.id, source_product_id=product.id, accepted=True, event_key="task:1:imported")
    db.refresh(memory)
    assert first == 1 and second == 0
    assert memory.ozon_success_count == 1
    db.close()


def test_revoked_memory_cannot_be_reactivated():
    db, shop, product = _fixture()
    memory = record_category_decision(db, shop_id=shop.id, source_product_id=product.id, category_id="cook", type_id="mold", category_title="烹饪配件 / 冰格、糖果模具", learning_mode="confirm")
    update_decision_memory_status(shop.id, memory.id, DecisionMemoryStatusRequest(status="revoked"), db)
    with pytest.raises(HTTPException) as exc:
        update_decision_memory_status(shop.id, memory.id, DecisionMemoryStatusRequest(status="active"), db)
    assert exc.value.status_code == 409
    db.close()


def test_ozon_rejection_demotes_and_success_promotes_once_per_feedback():
    db, shop, product = _fixture()
    memory = record_category_decision(db, shop_id=shop.id, source_product_id=product.id, category_id="cook", type_id="mold", category_title="烹饪配件 / 冰格、糖果模具", learning_mode="remember")
    apply_ozon_feedback(db, shop_id=shop.id, source_product_id=product.id, accepted=False, details={"reason": "wrong category"})
    db.refresh(memory)
    assert memory.status == "negative"
    assert Decimal(memory.trust_score) == Decimal("0.4500")
    assert recommend_categories(db, shop_id=shop.id, title=product.title, material="硅胶") == []
    apply_ozon_feedback(db, shop_id=shop.id, source_product_id=product.id, accepted=True)
    db.refresh(memory)
    assert memory.status == "negative"
    assert Decimal(memory.trust_score) == Decimal("0.5500")
    assert memory.ozon_success_count == 1
    db.close()


def test_successful_listing_learns_category_and_only_checked_attributes_once():
    db, shop, product = _fixture()
    draft = ListingDraftRecord(
        shop_id=shop.id, offer_id="KC-LEARN", title=product.title,
        source_product_id=product.id, category_id="cook", type_id="mold",
        learning_attribute_ids_json='["10400"]', status="submitted",
    )
    draft.attribute_values.extend([
        ListingAttributeValueRecord(attribute_id="10400", name="保证", value_text="无担保"),
        ListingAttributeValueRecord(attribute_id="12222", name="包括棍棒", value_text="不"),
    ])
    db.add(draft); db.commit(); db.refresh(draft)

    first = finalize_successful_listing_memories(db, draft, task_id="task-learn-1")
    second = finalize_successful_listing_memories(db, draft, task_id="task-learn-1")
    remembered = recommend_attribute_memories(db, shop_id=shop.id, category_id="cook", type_id="mold")

    assert first == {"category": 1, "attributes": 1}
    assert second == {"category": 0, "attributes": 0}
    assert set(remembered) == {"10400"}
    assert remembered["10400"]["value_text"] == "无担保"
    assert remembered["10400"]["method"] == "trusted_memory"
    category_memory = db.scalar(select(DecisionMemoryRecord).where(DecisionMemoryRecord.decision_type == "category"))
    attribute_memory = db.scalar(select(DecisionMemoryRecord).where(DecisionMemoryRecord.decision_type == "attribute"))
    assert category_memory.confirmation_count == 0 and category_memory.ozon_success_count == 1
    assert attribute_memory.confirmation_count == 0 and attribute_memory.ozon_success_count == 1
    assert db.scalar(select(DecisionFeedbackReceiptRecord).where(
        DecisionFeedbackReceiptRecord.event_key == f"listing-memory:{shop.id}:task-learn-1:imported"
    )) is not None
    assert len(recommend_categories(db, shop_id=shop.id, title=product.title, material="硅胶")) == 1
    db.close()
