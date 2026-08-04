"""Tests for the 1688 -> Ozon listing pipeline (P0-P7)."""

from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.erp_models import (
    OzonAttributeCacheRecord,
    OzonCategoryCacheRecord,
    SourceProductRecord,
)
from cryptography.fernet import Fernet

from app.models import Shop, ApiCredential
from app.security import encrypt_secret
from app.pipeline.contract import (
    SnapshotError,
    idempotent_key,
    normalize_snapshot,
    validate_snapshot,
)
from app.pipeline.ingestion_service import ingest_source_product, list_source_products
from app.pipeline.fact_extraction import extract_facts
from app.pipeline.category_matching import match_categories, lock_category
from app.pipeline.attribute_mapping import map_attributes
from app.pipeline.variant_mapping import generate_sku, map_variants, check_media_compliance
from app.pipeline.content_generation import generate_content
from app.pipeline.quality_check import run_quality_check, preview_payload
from app.pipeline.publish_service import (
    approve_for_publish,
    create_listing_draft_from_pipeline,
    poll_task_status,
    submit_to_ozon,
)
from app.pipeline.progress import get_progress


# ---------------------------------------------------------------------------
# P0: contract
# ---------------------------------------------------------------------------

class TestP0Contract:
    def test_valid_snapshot_passes_validation(self):
        snapshot = {
            "source_product_id": "678901234",
            "title": "不锈钢厨房收纳架 壁挂式",
            "source_url": "https://detail.1688.com/offer/678901234.html",
            "main_image_url": "https://cbu01.alicdn.com/img/test.jpg",
            "variants": [{"source_sku": "red-xl", "spec_name": "Red-XL", "price_cny": "15.50", "stock": 100}],
            "media": [{"url": "https://cbu01.alicdn.com/img/test.jpg", "is_primary": True}],
        }
        errors = validate_snapshot(snapshot)
        assert errors == []

    def test_missing_required_fields(self):
        errors = validate_snapshot({})
        assert "missing required field: source_product_id" in errors
        assert "missing required field: title" in errors

    def test_invalid_price_is_caught(self):
        errors = validate_snapshot({
            "source_product_id": "123",
            "title": "test",
            "variants": [{"source_sku": "s1", "spec_name": "spec", "price_cny": "not-a-number"}],
        })
        assert any("price_cny" in e for e in errors)

    def test_validate_or_raise_raises(self):
        with pytest.raises(SnapshotError):
            validate_or_raise_fn({})

    def test_normalize_strips_and_caps_title(self):
        normalized = normalize_snapshot({"source_product_id": "  123  ", "title": "  test  "})
        assert normalized["source_product_id"] == "123"
        assert normalized["title"] == "test"

    def test_idempotent_key_is_stable(self):
        key1 = idempotent_key("1688", "678901234")
        key2 = idempotent_key("1688", "678901234")
        assert key1 == key2

    def test_idempotent_key_differs_by_platform(self):
        assert idempotent_key("1688", "123") != idempotent_key("taobao", "123")


def validate_or_raise_fn(snapshot):
    from app.pipeline.contract import validate_or_raise
    validate_or_raise(snapshot)


# ---------------------------------------------------------------------------
# P1: ingestion
# ---------------------------------------------------------------------------

class TestP1Ingestion:
    def _snapshot(self):
        return {
            "source_product_id": "678901234",
            "title": "不锈钢厨房收纳架 壁挂式 现货",
            "source_url": "https://detail.1688.com/offer/678901234.html",
            "main_image_url": "https://cbu01.alicdn.com/img/test.jpg",
            "material": "不锈钢",
            "brand": "测试品牌",
            "variants": [
                {"source_sku": "red-xl", "spec_name": "红色-XL", "price_cny": "15.50", "stock": 100},
                {"source_sku": "blue-m", "spec_name": "蓝色-M", "price_cny": "12.00", "stock": 50},
            ],
            "media": [
                {"url": "https://cbu01.alicdn.com/img/test.jpg", "is_primary": True},
                {"url": "https://cbu01.alicdn.com/img/test2.jpg"},
            ],
        }

    def test_ingest_creates_product_with_variants_and_media(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop = Shop(name="ingest-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            record = ingest_source_product(db, shop.id, self._snapshot())
            assert record.source_product_id == "678901234"
            assert record.title == "不锈钢厨房收纳架 壁挂式 现货"
            assert record.material == "不锈钢"
            assert len(record.variants) == 2
            assert len(record.media) == 2
            assert record.ingestion_status == "ingested"

    def test_re_import_is_idempotent(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop = Shop(name="idempotent-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            first = ingest_source_product(db, shop.id, self._snapshot())
            first_id = first.id
            # Re-import with updated title
            snapshot = self._snapshot()
            snapshot["title"] = "updated title"
            second = ingest_source_product(db, shop.id, snapshot)
            assert second.id == first_id  # same record, not a duplicate
            assert second.title == "updated title"
            assert second.ingestion_status == "updated"
            products = list_source_products(db, shop.id)
            assert len(products) == 1


# ---------------------------------------------------------------------------
# P2: fact extraction + category matching
# ---------------------------------------------------------------------------

class TestP2FactExtraction:
    def test_extracts_material_and_form(self):
        source = SourceProductRecord(
            shop_id=1, source_platform="1688", source_product_id="123",
            title="不锈钢厨房收纳架 圆形 壁挂式",
            material="不锈钢",
        )
        facts = extract_facts(source)
        assert facts.material == "不锈钢"
        assert "圆形" in facts.form or "壁挂" in facts.form
        assert facts.confidence > 0

    def test_strips_marketing_stopwords(self):
        source = SourceProductRecord(
            shop_id=1, source_platform="1688", source_product_id="456",
            title="厂家直销 批发 不锈钢锅",
        )
        facts = extract_facts(source)
        assert "厂家直销" not in facts.keywords
        assert "批发" not in facts.keywords


class TestP2CategoryMatching:
    def test_match_categories_persists_pipeline(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop = Shop(name="cat-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            record = ingest_source_product(db, shop.id, {
                "source_product_id": "111",
                "title": "不锈钢厨房收纳架",
                "material": "不锈钢",
                "variants": [{"source_sku": "s1", "spec_name": "default"}],
            })
            db.add(OzonCategoryCacheRecord(shop_id=shop.id, category_id="100", type_id="200", title="厨房收纳"))
            db.commit()
            facts, candidates = match_categories(db, shop.id, record.id)
            assert facts.core_product != ""
            assert len(candidates) > 0
            assert candidates[0].category_id == "100"

    def test_lock_category_updates_pipeline(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop = Shop(name="lock-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            record = ingest_source_product(db, shop.id, {
                "source_product_id": "222",
                "title": "test product",
                "variants": [{"source_sku": "s1", "spec_name": "default"}],
            })
            pipeline = lock_category(db, shop.id, record.id, "999", "888")
            assert pipeline.matched_category_id == "999"
            assert pipeline.matched_type_id == "888"
            assert pipeline.pipeline_stage == "category_locked"


    def test_domain_compatibility_prevents_wrong_category(self):
        """Headphones should not match to fire-protection equipment."""
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop = Shop(name="domain-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            record = ingest_source_product(db, shop.id, {
                "source_product_id": "domain-1",
                "title": "主动降噪蓝牙耳机头戴式",
                "variants": [{"source_sku": "s1", "spec_name": "default"}],
            })
            # Correct category: electronics
            db.add(OzonCategoryCacheRecord(
                shop_id=shop.id, category_id="200", type_id="201",
                title="消费电子 / 蓝牙耳机", title_zh="消费电子 / 蓝牙耳机",
            ))
            # Wrong category: fire protection (contains 降噪 in type name)
            db.add(OzonCategoryCacheRecord(
                shop_id=shop.id, category_id="300", type_id="301",
                title="防护和消防设备 / 降噪耳机配件", title_zh="防护和消防设备 / 降噪耳机配件",
            ))
            db.commit()
            facts, candidates = match_categories(db, shop.id, record.id)
            assert len(candidates) >= 2
            # The electronics category should score significantly higher
            electronics = [c for c in candidates if c.category_id == "200"]
            fire_safety = [c for c in candidates if c.category_id == "300"]
            if electronics and fire_safety:
                assert electronics[0].score > fire_safety[0].score * 2, (
                    f"Electronics ({electronics[0].score}) should beat fire-safety ({fire_safety[0].score})"
                )
            # Top candidate should NOT be fire protection
            assert candidates[0].category_id != "300", "headphones must not match fire-protection category"


# ---------------------------------------------------------------------------
# P3: attribute mapping
# ---------------------------------------------------------------------------

class TestP3AttributeMapping:
    def test_maps_material_to_attribute(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop = Shop(name="attr-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            record = ingest_source_product(db, shop.id, {
                "source_product_id": "333",
                "title": "不锈钢收纳架",
                "material": "不锈钢",
                "variants": [{"source_sku": "s1", "spec_name": "default"}],
            })
            lock_category(db, shop.id, record.id, "500", "600")
            db.add(OzonAttributeCacheRecord(
                shop_id=shop.id, category_id="500", type_id="600",
                attribute_id="1001", name="Material", required=True,
                dictionary_id="", value_type="String",
            ))
            db.add(OzonAttributeCacheRecord(
                shop_id=shop.id, category_id="500", type_id="600",
                attribute_id="1002", name="Color", required=False,
                dictionary_id="", value_type="String",
            ))
            db.commit()
            result = map_attributes(db, shop.id, record.id)
            assert result["total_attributes"] == 2
            assert result["matched"] >= 1
            mapping = result["mapping"]
            material_attr = next(m for m in mapping if m["attribute_id"] == "1001")
            assert material_attr["matched"] is True
            assert material_attr["value_text"] is not None


# ---------------------------------------------------------------------------
# P4: variant mapping
# ---------------------------------------------------------------------------

class TestP4VariantMapping:
    def test_generate_sku_is_stable_and_unique(self):
        sku1 = generate_sku(1, 100, "red-xl")
        sku2 = generate_sku(1, 100, "red-xl")
        sku3 = generate_sku(1, 100, "blue-m")
        assert sku1 == sku2
        assert sku1 != sku3
        assert sku1.startswith("OZ")

    def test_map_variants_creates_stable_skus(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop = Shop(name="var-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            record = ingest_source_product(db, shop.id, {
                "source_product_id": "444",
                "title": "test",
                "variants": [
                    {"source_sku": "red-xl", "spec_name": "红色-XL", "price_cny": "10", "stock": 5},
                    {"source_sku": "blue-m", "spec_name": "蓝色-M", "price_cny": "12", "stock": 3},
                ],
                "media": [{"url": "https://example.com/1.jpg", "is_primary": True}],
            })
            lock_category(db, shop.id, record.id, "700", "800")
            result = map_variants(db, shop.id, record.id)
            assert result["sku_count"] == 2
            assert len(result["variants"]) == 2
            skus = [v["seller_sku"] for v in result["variants"]]
            assert len(set(skus)) == 2  # all unique

    def test_media_compliance_checks(self):
        assert len(check_media_compliance(0)) > 0
        assert len(check_media_compliance(5)) > 0  # below recommended
        assert len(check_media_compliance(8)) == 0
        assert len(check_media_compliance(16)) > 0  # over max


# ---------------------------------------------------------------------------
# P5: content generation
# ---------------------------------------------------------------------------

class TestP5ContentGeneration:
    def test_generates_russian_title_and_pricing(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop = Shop(name="content-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            record = ingest_source_product(db, shop.id, {
                "source_product_id": "555",
                "title": "不锈钢厨房收纳架",
                "material": "不锈钢",
                "variants": [{"source_sku": "s1", "spec_name": "default", "price_cny": "20", "stock": 10}],
            })
            lock_category(db, shop.id, record.id, "900", "1000")
            db.add(OzonCategoryCacheRecord(shop_id=shop.id, category_id="900", type_id="1000", title="Kitchen Storage"))
            db.add(OzonAttributeCacheRecord(
                shop_id=shop.id, category_id="900", type_id="1000",
                attribute_id="2001", name="Material", required=False, dictionary_id="", value_type="String",
            ))
            db.commit()
            map_attributes(db, shop.id, record.id)
            map_variants(db, shop.id, record.id)
            result = generate_content(db, shop.id, record.id)
            assert result["title_ru"] != ""
            assert result["pricing"]["rule_version"] == "1.0.0"
            assert len(result["pricing"]["variants"]) == 1
            var_pricing = result["pricing"]["variants"][0]
            assert var_pricing["price_cny"] > 0
            assert "profit_cny" in var_pricing


# ---------------------------------------------------------------------------
# P6: quality check
# ---------------------------------------------------------------------------

class TestP6QualityCheck:
    def test_quality_check_scores_product(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop = Shop(name="quality-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            record = ingest_source_product(db, shop.id, {
                "source_product_id": "666",
                "title": "不锈钢收纳架",
                "material": "不锈钢",
                "variants": [{"source_sku": "s1", "spec_name": "default", "price_cny": "20", "stock": 10}],
                "media": [{"url": f"https://example.com/{i}.jpg"} for i in range(8)],
            })
            lock_category(db, shop.id, record.id, "1100", "1200")
            db.add(OzonCategoryCacheRecord(shop_id=shop.id, category_id="1100", type_id="1200", title="Storage"))
            db.add(OzonAttributeCacheRecord(
                shop_id=shop.id, category_id="1100", type_id="1200",
                attribute_id="3001", name="Material", required=False, dictionary_id="", value_type="String",
            ))
            db.commit()
            map_attributes(db, shop.id, record.id)
            map_variants(db, shop.id, record.id)
            generate_content(db, shop.id, record.id)
            result = run_quality_check(db, shop.id, record.id)
            assert "overall_score" in result
            assert "scores" in result
            assert result["overall_score"] > 0

    def test_payload_preview_does_not_write(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop = Shop(name="payload-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            record = ingest_source_product(db, shop.id, {
                "source_product_id": "777",
                "title": "test product",
                "variants": [{"source_sku": "s1", "spec_name": "default", "price_cny": "10", "stock": 5}],
            })
            lock_category(db, shop.id, record.id, "1300", "1400")
            db.add(OzonCategoryCacheRecord(shop_id=shop.id, category_id="1300", type_id="1400", title="Test Cat"))
            db.add(OzonAttributeCacheRecord(
                shop_id=shop.id, category_id="1300", type_id="1400",
                attribute_id="3001", name="Material", required=False, dictionary_id="", value_type="String",
            ))
            db.commit()
            map_attributes(db, shop.id, record.id)
            map_variants(db, shop.id, record.id)
            generate_content(db, shop.id, record.id)
            run_quality_check(db, shop.id, record.id)
            payload = preview_payload(db, shop.id, record.id)
            assert payload["preview_only"] is True
            assert len(payload["items"]) > 0


# ---------------------------------------------------------------------------
# P7: publish service
# ---------------------------------------------------------------------------

class TestP7Publish:
    def test_full_pipeline_to_submission(self, monkeypatch):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            monkeypatch.setenv("ERP_CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
            shop = Shop(name="publish-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            db.add(ApiCredential(shop_id=shop.id, provider="ozon", client_id_reference="123", encrypted_secret_placeholder=encrypt_secret("x" * 30), status="configured"))
            db.commit()
            record = ingest_source_product(db, shop.id, {
                "source_product_id": "888",
                "title": "不锈钢厨房收纳架",
                "material": "不锈钢",
                "variants": [{"source_sku": "s1", "spec_name": "default", "price_cny": "20", "stock": 10}],
                "media": [{"url": "https://example.com/1.jpg"}],
            })
            lock_category(db, shop.id, record.id, "1500", "1600")
            db.add(OzonCategoryCacheRecord(shop_id=shop.id, category_id="1500", type_id="1600", title="Kitchen"))
            db.add(OzonAttributeCacheRecord(
                shop_id=shop.id, category_id="1500", type_id="1600",
                attribute_id="4001", name="Material", required=False, dictionary_id="", value_type="String",
            ))
            db.commit()
            map_attributes(db, shop.id, record.id)
            map_variants(db, shop.id, record.id)
            generate_content(db, shop.id, record.id)
            run_quality_check(db, shop.id, record.id)
            # Create listing draft
            draft = create_listing_draft_from_pipeline(db, shop.id, record.id)
            assert draft.id is not None
            assert draft.status == "ready_for_approval"
            # Approve
            pipeline = approve_for_publish(db, shop.id, record.id, "test-approver")
            assert pipeline.publish_status == "approved"
            # Submit (mocked Ozon API)
            class _FakeOzonClient:
                def __init__(self, **_): pass
                def __enter__(self): return self
                def __exit__(self, *_): pass
                def create_products(self, *, items):
                    return {"result": {"task_id": "test-task-123"}}
                def get_import_info(self, *, task_id):
                    return {"result": {"items": [{"offer_id": "test-sku", "product_id": 999, "status": "imported"}]}}
            monkeypatch.setattr("app.pipeline.publish_service.OzonSellerClient", _FakeOzonClient)
            result = submit_to_ozon(db, shop.id, record.id, "test-approver")
            assert result["task_id"] != ""
            assert result["status"] == "submitted"
            # Poll task status
            status = poll_task_status(db, shop.id, record.id)
            assert status["task_id"] == result["task_id"]

    def test_submit_without_approval_raises(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop = Shop(name="no-approve-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            record = ingest_source_product(db, shop.id, {
                "source_product_id": "999",
                "title": "test",
                "variants": [{"source_sku": "s1", "spec_name": "default"}],
            })
            lock_category(db, shop.id, record.id, "1700", "1800")
            db.add(OzonCategoryCacheRecord(shop_id=shop.id, category_id="1700", type_id="1800", title="Cat"))
            db.add(OzonAttributeCacheRecord(
                shop_id=shop.id, category_id="1700", type_id="1800",
                attribute_id="4001", name="Material", required=False, dictionary_id="", value_type="String",
            ))
            db.commit()
            map_attributes(db, shop.id, record.id)
            map_variants(db, shop.id, record.id)
            generate_content(db, shop.id, record.id)
            run_quality_check(db, shop.id, record.id)
            create_listing_draft_from_pipeline(db, shop.id, record.id)
            with pytest.raises(ValueError, match="approved"):
                submit_to_ozon(db, shop.id, record.id, "hacker")


# ---------------------------------------------------------------------------
# Rich Content
# ---------------------------------------------------------------------------

class TestRichContent:
    def test_build_rich_content_with_images_and_text(self):
        from app.pipeline.rich_content import build_rich_content, get_rich_content_attribute
        import json

        json_str = build_rich_content(
            image_urls=["https://example.com/1.jpg", "https://example.com/2.jpg"],
            description_ru="Отличные наушники с шумоподавлением",
            title_ru="Беспроводные наушники",
        )
        parsed = json.loads(json_str)
        assert "content" in parsed
        widgets = parsed["content"]
        # Should have 2 widgets: showcase (images) + list (text)
        assert len(widgets) == 2
        assert widgets[0]["widgetName"] == "raShowcase"
        assert widgets[1]["widgetName"] == "list"
        # Showcase should have 2 image blocks
        assert len(widgets[0]["blocks"]) == 2
        assert widgets[0]["blocks"][0]["img"]["src"] == "https://example.com/1.jpg"
        # Text widget should have title and text
        assert "title" in widgets[1]["blocks"][0]
        assert "text" in widgets[1]["blocks"][0]

    def test_build_rich_content_images_only(self):
        from app.pipeline.rich_content import build_rich_content
        import json

        json_str = build_rich_content(
            image_urls=["https://example.com/1.jpg"],
            description_ru="",
            title_ru="",
        )
        parsed = json.loads(json_str)
        assert len(parsed["content"]) == 1
        assert parsed["content"][0]["widgetName"] == "raShowcase"

    def test_get_rich_content_attribute_format(self):
        from app.pipeline.rich_content import get_rich_content_attribute
        import json

        attr = get_rich_content_attribute(
            image_urls=["https://example.com/1.jpg"],
            description_ru="Test description",
            title_ru="Test title",
        )
        assert attr["id"] == "11254"
        assert attr["complex_id"] == 0
        value = attr["values"][0]["value"]
        parsed = json.loads(value)
        assert "content" in parsed

    def test_invalid_urls_filtered(self):
        from app.pipeline.rich_content import build_rich_content
        import json

        json_str = build_rich_content(
            image_urls=["https://valid.com/1.jpg", "invalid-url", "", None],
            description_ru="desc",
        )
        parsed = json.loads(json_str)
        showcase = parsed["content"][0]
        assert len(showcase["blocks"]) == 1  # only valid URL


# ---------------------------------------------------------------------------
# Progress tracking
# ---------------------------------------------------------------------------

class TestProgress:
    def test_progress_reports_all_stages(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            report = get_progress(db)
            assert report["total_stages"] == 8
            assert len(report["stages"]) == 8
            # Code files exist, so code-based tasks should be done
            for stage in report["stages"]:
                assert stage["progress_percent"] > 0
                assert stage["status"] in ("active", "completed")

    def test_progress_reflects_ingested_data(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop = Shop(name="progress-data-test", currency="CNY")
            db.add(shop); db.commit(); db.refresh(shop)
            # Before ingestion
            report = get_progress(db)
            p1_stage = next(s for s in report["stages"] if s["stage"] == "P1")
            ingest_task = next(t for t in p1_stage["tasks"] if "ingest at least" in t["text"])
            assert ingest_task["done"] is False
            # After ingestion
            ingest_source_product(db, shop.id, {
                "source_product_id": "progress-1",
                "title": "test",
                "variants": [{"source_sku": "s1", "spec_name": "default"}],
            })
            report = get_progress(db)
            assert report["source_product_count"] == 1
            p1_stage = next(s for s in report["stages"] if s["stage"] == "P1")
            ingest_task = next(t for t in p1_stage["tasks"] if "ingest at least" in t["text"])
            assert ingest_task["done"] is True
