import json

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.database import Base
from app.erp_models import (
    ListingAttributeValueRecord,
    ListingDraftRecord,
    PipelineProductRecord,
    ListingVariantRecord,
    OzonAttributeDictionaryValueRecord,
    SourceProductRecord,
)
from app.models import Shop
from app.pipeline.publish_service import (
    _filter_submission_images_by_ozon_constraints,
    _materialize_submission_images,
    build_import_payload,
)
from app.quality_preflight import run_quality_preflight
from app.automation_scheduler import _has_deterministic_image_payload_feedback


def _session() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_preflight_removes_source_brand_and_platform_from_all_product_text_surfaces():
    with _session() as db:
        db.execute(text("CREATE TABLE IF NOT EXISTS ozon_error_patterns (error_code TEXT, error_field TEXT, auto_fixable INTEGER, fix_action TEXT)"))
        shop = Shop(name="quality-brand", currency="CNY")
        db.add(shop); db.flush()
        source = SourceProductRecord(
            shop_id=shop.id, source_product_id="source-brand", title="Slipknot Ozon 金属徽章", brand="Slipknot",
        )
        db.add(source); db.flush()
        draft = ListingDraftRecord(
            shop_id=shop.id, offer_id="BRAND-1", source_product_id=source.id,
            title="Значок Ozon Slipknot", description="Бренд: Slipknot для Ozon",
        )
        db.add(draft); db.flush()
        db.add_all([
            ListingAttributeValueRecord(draft_id=draft.id, attribute_id="4191", name="简介", value_text="Ozon Slipknot значок"),
            ListingAttributeValueRecord(draft_id=draft.id, attribute_id="23171", name="主题标签", value_text="#значок #музыка #Slipknot"),
            ListingAttributeValueRecord(
                draft_id=draft.id, attribute_id="11254", name="JSON富内容",
                value_text=json.dumps({"content": [{"text": "Ozon Slipknot значок"}]}, ensure_ascii=False),
            ),
        ])
        db.commit(); db.refresh(draft)

        result = run_quality_preflight(db, draft)
        db.commit()

        assert result["fixed"] is True
        combined = " ".join([
            draft.title, draft.description or "",
            *(row.value_text or "" for row in draft.attribute_values),
        ]).lower()
        assert "ozon" not in combined
        assert "slipknot" not in combined


def test_preflight_reports_unrecoverable_title_after_auto_fix():
    with _session() as db:
        shop = Shop(name="quality-title-block", currency="CNY")
        db.add(shop); db.flush()
        source = SourceProductRecord(shop_id=shop.id, source_product_id="source-title", title="徽章")
        db.add(source); db.flush()
        draft = ListingDraftRecord(
            shop_id=shop.id, offer_id="TITLE-BLOCK-1", source_product_id=source.id,
            title="!!!", description="Описание",
        )
        db.add(draft); db.commit(); db.refresh(draft)

        result = run_quality_preflight(db, draft, auto_fix=True)

        assert any(issue["error_code"] == "title_quality_invalid" for issue in result["issues_remaining"])


def test_preflight_blocks_lgbt_symbolism_in_title_description_tags_and_rich_content():
    with _session() as db:
        shop = Shop(name="quality-prohibited-symbol", currency="CNY")
        db.add(shop); db.flush()
        source = SourceProductRecord(shop_id=shop.id, source_product_id="source-prohibited", title="彩虹胸针")
        db.add(source); db.flush()
        draft = ListingDraftRecord(
            shop_id=shop.id, offer_id="PROHIBITED-1", source_product_id=source.id,
            title="Значок с радужным градиентом", description="Аксессуар с trans rights символикой",
        )
        db.add(draft); db.flush()
        db.add_all([
            ListingAttributeValueRecord(draft_id=draft.id, attribute_id="23171", name="主题标签", value_text="#значок_прайд"),
            ListingAttributeValueRecord(draft_id=draft.id, attribute_id="11254", name="JSON富内容", value_text=json.dumps({"text": "LGBT символ"})),
        ])
        db.commit(); db.refresh(draft)

        result = run_quality_preflight(db, draft, auto_fix=False)

        hits = [issue for issue in result["issues_remaining"] if issue["error_code"] == "prohibited_lgbt_symbolism"]
        assert {issue["error_field"] for issue in hits} >= {"description", "attribute:23171", "attribute:11254"}
        assert "title" not in {issue["error_field"] for issue in hits}


def test_preflight_blocks_a_source_with_confirmed_image_policy_risk():
    with _session() as db:
        shop = Shop(name="quality-source-risk", currency="CNY")
        db.add(shop); db.flush()
        source = SourceProductRecord(
            shop_id=shop.id, source_platform="ozon", source_product_id="source-risk",
            title="普通渐变颜色商品", ingestion_status="content_policy_blocked",
        )
        db.add(source); db.flush()
        draft = ListingDraftRecord(
            shop_id=shop.id, offer_id="SOURCE-RISK-1", source_product_id=source.id,
            title="Обычный цветной товар",
        )
        db.add(draft); db.flush()

        result = run_quality_preflight(db, draft, auto_fix=False)

        assert any(issue["error_code"] == "source_content_policy_blocked" for issue in result["issues_remaining"])


def test_theme_tags_are_submitted_as_one_ozon_attribute_value():
    with _session() as db:
        shop = Shop(name="tag-payload", currency="CNY")
        db.add(shop); db.flush()
        source = SourceProductRecord(shop_id=shop.id, source_product_id="source-tags", title="徽章")
        db.add(source); db.flush()
        draft = ListingDraftRecord(
            shop_id=shop.id, offer_id="TAG-1", source_product_id=source.id,
            title="Металлический значок", description="Описание", category_id="1", type_id="2",
        )
        db.add(draft); db.flush()
        db.add(ListingVariantRecord(
            draft_id=draft.id, seller_sku="TAG-1-BLACK", price_cny=26, old_price_cny=52, stock=10,
            image_url="https://img.test/sku.jpg",
            variant_values_json=json.dumps({"商品颜色": "黑色", "颜色名称": "Черный", "__ids__": {"商品颜色": ["61574"]}}),
        ))
        db.add(ListingAttributeValueRecord(
            draft_id=draft.id, attribute_id="23171", name="主题标签",
            value_text="#значок #металл #украшение",
        ))
        db.add(ListingAttributeValueRecord(
            draft_id=draft.id, attribute_id="11254", name="JSON富内容", value_text="",
        ))
        db.add(OzonAttributeDictionaryValueRecord(
            shop_id=shop.id, category_id="1", type_id="2", attribute_id="10096", value_id="61574", value="黑色",
        ))
        db.flush()
        db.add(PipelineProductRecord(
            shop_id=shop.id, source_product_id=source.id, matched_category_id="1", matched_type_id="2",
            listing_draft_id=draft.id, variant_mapping_json="{}", pricing_json="{}",
            generated_title_ru=draft.title, generated_description_ru=draft.description,
        ))
        db.commit()

        payload = build_import_payload(db, shop.id, source.id)
        tags = next(attr for attr in payload["items"][0]["attributes"] if attr["id"] == "23171")
        assert tags["values"] == [{"dictionary_value_id": 0, "value": "#значок #металл #украшение"}]
        rich = [attr for attr in payload["items"][0]["attributes"] if attr["id"] == "11254"]
        assert len(rich) == 1
        assert json.loads(rich[0]["values"][0]["value"])["content"]


def test_submission_image_preflight_rejects_non_http_links_before_write():
    payload = {"items": [{"images": ["None", "file:///tmp/product.jpg"]}]}
    try:
        _materialize_submission_images(None, 1, 1, payload)
    except ValueError as exc:
        assert "无效图片链接" in str(exc)
    else:
        raise AssertionError("invalid image URLs must block an Ozon write")


def test_submission_image_preflight_mirrors_alibaba_urls(monkeypatch):
    calls = []

    class FakeBucket:
        pass

    def fake_upload(url, key, *, verify, bucket):
        calls.append((url, key, verify, bucket))
        return "https://ozonshanghai.oss-cn-shanghai.aliyuncs.com/" + key + ".jpg"

    monkeypatch.setattr("app.oss_upload.get_bucket", lambda: FakeBucket())
    monkeypatch.setattr("app.oss_upload.fetch_and_upload", fake_upload)
    monkeypatch.setattr(
        "app.pipeline.publish_service._filter_submission_images_by_ozon_constraints",
        lambda _payload: {"filtered_urls": [], "dimension_invalid_count": 0, "download_failed_count": 0},
    )

    class EmptyDb:
        def scalar(self, *_args, **_kwargs):
            return None

    source_url = "https://cbu01.alicdn.com/img/ibank/source.jpg"
    payload = {"items": [{"images": [source_url]}]}
    audit = _materialize_submission_images(EmptyDb(), 1, 1, payload)
    assert audit["mirrored_count"] == 1
    assert calls and calls[0][0] == source_url
    assert payload["items"][0]["images"][0].startswith("https://ozonshanghai.")


def test_submission_image_preflight_drops_deleted_alibaba_gallery_image_before_mirroring(monkeypatch):
    """One deleted source gallery URL must not stop a card with valid images."""
    uploaded = []

    class FakeBucket:
        pass

    def fake_upload(url, key, *, verify, bucket):
        uploaded.append(url)
        if url.endswith("deleted.jpg"):
            raise RuntimeError("HTTP Error 404: Not Found")
        return "https://ozonshanghai.oss-cn-shanghai.aliyuncs.com/" + key + ".jpg"

    def fake_inspect(url, _client):
        if url.endswith("deleted.jpg"):
            return {"valid": False, "reason": "HTTP 404"}
        return {"valid": True, "width": 800, "height": 800}

    monkeypatch.setattr("app.oss_upload.get_bucket", lambda: FakeBucket())
    monkeypatch.setattr("app.oss_upload.fetch_and_upload", fake_upload)
    monkeypatch.setattr("app.pipeline.publish_service._inspect_submission_image", fake_inspect)

    class EmptyDb:
        def scalar(self, *_args, **_kwargs):
            return None

    kept = "https://cbu01.alicdn.com/img/ibank/kept.jpg"
    deleted = "https://cbu01.alicdn.com/img/ibank/deleted.jpg"
    payload = {"items": [{"offer_id": "SKU-1", "images": [kept, deleted]}]}

    audit = _materialize_submission_images(EmptyDb(), 1, 1, payload)

    assert uploaded == [kept]
    assert audit["download_failed_count"] == 1
    assert audit["mirrored_count"] == 1
    assert len(payload["items"][0]["images"]) == 1
    assert payload["items"][0]["images"][0].startswith("https://ozonshanghai.oss-cn-shanghai.aliyuncs.com/")


def test_submission_image_preflight_drops_too_small_sku_image_and_keeps_public_fallback(monkeypatch):
    def fake_inspect(url, _client):
        if url.endswith("sku-thumb.jpg"):
            return {"valid": False, "reason": "分辨率 160×140 小于 Ozon 最低 200×200", "width": 160, "height": 140}
        return {"valid": True, "width": 800, "height": 800}

    monkeypatch.setattr("app.pipeline.publish_service._inspect_submission_image", fake_inspect)
    payload = {"items": [{"offer_id": "SKU-1", "images": [
        "https://img.test/sku-thumb.jpg", "https://img.test/detail.jpg",
    ]}]}

    audit = _filter_submission_images_by_ozon_constraints(payload)

    assert payload["items"][0]["images"] == ["https://img.test/detail.jpg"]
    assert audit["dimension_invalid_count"] == 1
    assert audit["download_failed_count"] == 0


def test_ozon_image_transport_feedback_is_auto_repairable_but_not_image_moderation():
    assert _has_deterministic_image_payload_feedback([
        {"code": "primary_image_load_failed"},
        {"code": "pics_invalid_dimensions"},
        {"code": "some_image_failed"},
    ])
    assert not _has_deterministic_image_payload_feedback([
        {"code": "IMAGE_MODERATION_DECLINE"},
    ])
