import json

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.erp_models import (
    AuditEventRecord,
    ListingDraftRecord,
    ListingVariantRecord,
    SourceProductRecord,
    SourceVariantRecord,
    VisualImageJobRecord,
)
from app.models import Shop
from app.visual_image_service import _source_variant_group, _validate_public_image_url, apply_set, plan, queue_set, reconcile_interrupted_jobs, serialize
from app.visual_image_service import image_config


def _records(db: Session):
    shop = Shop(name="AI图片测试店", currency="CNY")
    db.add(shop)
    db.flush()
    source = SourceProductRecord(
        shop_id=shop.id,
        source_product_id="1688-AI-1",
        title="羽毛杯垫硅胶模具",
    )
    db.add(source)
    db.flush()
    draft = ListingDraftRecord(
        shop_id=shop.id,
        source_product_id=source.id,
        offer_id="AI-DRAFT-1",
        title="羽毛杯垫硅胶模具",
        primary_image_url="https://old.test/main.jpg",
        images_json=json.dumps(["https://old.test/main.jpg", "https://old.test/detail.jpg"]),
    )
    draft.variants.extend([
        ListingVariantRecord(seller_sku="AI-DRAFT-1-WHITE", image_url="https://old.test/white.jpg"),
        ListingVariantRecord(seller_sku="AI-DRAFT-1-PINK", image_url="https://old.test/pink.jpg"),
    ])
    job = VisualImageJobRecord(
        shop_id=shop.id,
        source_product_id=source.id,
        listing_draft_id=draft.id,
        status="ready",
        generated_images_json=json.dumps([
            {"slot": "hero", "url": "https://ai.test/hero.png"},
            {"slot": "details", "url": "https://ai.test/details.png"},
        ]),
    )
    db.add_all([draft, job])
    db.commit()
    db.refresh(draft)
    db.refresh(job)
    return shop, draft, job


def test_apply_set_only_updates_the_selected_style_skus_and_keeps_public_gallery() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop, draft, job = _records(db)

        result = apply_set(
            db,
            job,
            draft,
            ["https://ai.test/hero.png", "https://ai.test/details.png"],
            "image-reviewer",
            ["AI-DRAFT-1-WHITE"],
        )

        assert draft.images == ["https://old.test/main.jpg", "https://old.test/detail.jpg"]
        assert draft.primary_image_url == "https://old.test/main.jpg"
        white, pink = draft.variants
        assert white.image_url == "https://ai.test/hero.png"
        assert white.image_urls == ["https://ai.test/hero.png", "https://ai.test/details.png", "https://old.test/white.jpg"]
        assert pink.image_url == "https://old.test/pink.jpg" and pink.image_urls is None
        assert result.status == "applied" and result.applied_by == "image-reviewer"
        event = db.scalar(select(AuditEventRecord).where(AuditEventRecord.shop_id == shop.id))
        assert event is not None and event.action == "ai_visual_style_set_applied"
        details = json.loads(event.details_json)
        assert details["before"]["variant_images"]["AI-DRAFT-1-PINK"] == "https://old.test/pink.jpg"


def test_apply_set_rejects_urls_not_generated_by_this_job() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        _, draft, job = _records(db)
        with pytest.raises(ValueError, match="不属于当前AI任务"):
            apply_set(db, job, draft, ["https://attacker.test/not-generated.png"], "reviewer")
        assert draft.primary_image_url == "https://old.test/main.jpg"


def test_apply_set_allows_a_partial_run_without_the_planned_hero() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        _, draft, job = _records(db)
        job.status = "failed"
        apply_set(db, job, draft, ["https://ai.test/details.png"], "reviewer", ["AI-DRAFT-1-PINK"])
        assert draft.primary_image_url == "https://old.test/main.jpg"
        assert draft.images[0] == "https://old.test/main.jpg"
        assert draft.variants[1].image_url == "https://ai.test/details.png"


def test_serialize_empty_job_is_safe_for_first_page_load() -> None:
    assert serialize(None) == {"status": "not_started", "generated_images": []}


def test_reference_download_rejects_loopback_and_non_http_urls() -> None:
    with pytest.raises(ValueError, match="内网"):
        _validate_public_image_url("http://127.0.0.1/private.png")
    with pytest.raises(ValueError, match="HTTP"):
        _validate_public_image_url("file:///etc/passwd")


def test_image_config_defaults_to_cangyuan_gpt_image_2(monkeypatch) -> None:
    monkeypatch.delenv("IMAGE_MODEL", raising=False)
    assert image_config()[2] == "gpt-image-2"


def test_image_config_normalizes_legacy_1k_and_user_shorthand(monkeypatch) -> None:
    for value in ("gpt-image-2-1k", "image-2-1k", "imag-2", "image-2"):
        monkeypatch.setenv("IMAGE_MODEL", value)
        assert image_config()[2] == "gpt-image-2"


def test_generation_reference_policy_is_single_reference() -> None:
    import inspect
    from app import visual_image_service
    source = inspect.getsource(visual_image_service.generate_one)
    assert "refs[0]" in source
    assert "refs[:2]" not in source


def test_style_group_prefers_structured_non_size_axis_and_plan_has_eight_slots() -> None:
    variant = SourceVariantRecord(
        source_sku="MAT-1-80",
        spec_name='[{"attributeName":"款式","attributeValue":"多肉趣集"},{"attributeName":"尺寸","attributeValue":"80*100"}]',
        raw_json="{}",
    )
    assert _source_variant_group(variant) == ("款式:多肉趣集", "多肉趣集")
    product = SourceProductRecord(shop_id=1, source_product_id="style-plan", title="门垫")
    assert [item["slot"] for item in plan(product, {}, "多肉趣集")] == [
        "hero", "dimensions", "details", "steps", "lifestyle", "scene_home", "scene_entry", "scene_gift",
    ]


def test_generated_result_download_has_idle_total_and_size_guards() -> None:
    import inspect
    from app import visual_image_service
    source = inspect.getsource(visual_image_service._download_generated_result)
    assert "read=30" in source
    assert "max_seconds" in source
    assert "max_bytes" in source
    assert "iter_bytes" in source


def test_new_run_preserves_previous_successful_images(monkeypatch) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop, _, job = _records(db)
        old_images = json.loads(job.generated_images_json)
        monkeypatch.setattr("app.visual_image_service.source_bundle", lambda *_: (object(), [], []))
        queued, should_start = queue_set(db, shop.id, job.source_product_id, job.listing_draft_id)
        assert should_start is True
        assert queued.status == "queued"
        assert json.loads(queued.generated_images_json) == old_images
        assert json.loads(queued.selected_images_json) == [item["url"] for item in old_images]


def test_single_slot_retry_is_recorded_without_removing_previous_images(monkeypatch) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop, _, job = _records(db)
        old_images = json.loads(job.generated_images_json)
        monkeypatch.setattr("app.visual_image_service.source_bundle", lambda *_: (object(), [], []))
        queued, should_start = queue_set(db, shop.id, job.source_product_id, job.listing_draft_id, ["details"])
        assert should_start is True
        assert json.loads(queued.generated_images_json) == old_images
        current_run = json.loads(queued.attempt_history_json)[-1]
        assert current_run["requested_slots"] == ["details"]


def test_restart_marks_active_image_request_interrupted_without_replaying_it() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop, _, job = _records(db)
        job.status = "generating"
        job.current_run_id = "run-a"
        job.attempt_history_json = json.dumps([
            {"kind": "run", "run_id": "run-a", "state": "generating"},
            {
                "kind": "image_request",
                "run_id": "run-a",
                "slot": "hero",
                "state": "provider_requesting",
                "provider_request_started_at": "2026-08-17T03:29:13+00:00",
            },
        ])
        db.commit()

        assert reconcile_interrupted_jobs(db) == 1
        assert job.status == "interrupted"
        assert "请求账本已保留" in (job.error_message or "")
        history = json.loads(job.attempt_history_json)
        assert history[0]["state"] == "interrupted"
        assert history[1]["state"] == "interrupted_unknown"
        assert shop.id > 0


def test_serialized_job_exposes_attempt_history() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        _, _, job = _records(db)
        job.current_run_id = "run-a"
        job.attempt_history_json = json.dumps([{"kind": "run", "run_id": "run-a", "state": "ready"}])
        db.commit()
        payload = serialize(job)
        assert payload["current_run_id"] == "run-a"
        assert payload["attempt_history"][0]["run_id"] == "run-a"


def test_restart_marks_legacy_active_job_charge_unknown() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        _, _, job = _records(db)
        job.status = "generating"
        job.attempt_history_json = "[]"
        db.commit()
        reconcile_interrupted_jobs(db)
        assert job.status == "interrupted"
        assert "无法确认" in (job.error_message or "")
