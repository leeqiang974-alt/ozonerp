from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.erp_models import ListingAttributeValueRecord, ListingDraftRecord, ListingVariantRecord, OzonAttributeCacheRecord, OzonAttributeDictionaryValueRecord, OzonCategoryCacheRecord, OzonGlobalAttributeCacheRecord, OzonGlobalCategoryCacheRecord, OzonGlobalDictValueRecord, SourceProductRecord, SourceProductShopRecord, SourceVariantRecord
from app.listing_service import build_variant_image_list, validate_listing_draft
from app.main import SourcePackageUpdate, _listing_change_hash, _listing_non_attribute_signature, auto_fix_listing, create_listing_draft, sync_listing_feedback, update_source_product_package
from app.models import Shop
from app.schemas import ListingDraftCreate
from app.integrations.ozon_seller import OzonSellerClient
from app.ai_service import _strip_ozon_assortment_claims
import httpx


def test_listing_draft_validation_calculates_cny_prices() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="上架测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        draft = ListingDraftRecord(shop_id=shop.id, offer_id="DRAFT-1", title="测试商品", category_id="123", type_id="456", primary_image_url="https://example.test/main.jpg")
        db.add(OzonAttributeCacheRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="999", name="可选属性", required=False, dictionary_id="", value_type="String"))
        draft.variants.append(ListingVariantRecord(seller_sku="DRAFT-1-RED", purchase_cost_cny=Decimal("20"), weight_g=Decimal("300"), length_mm=Decimal("100"), width_mm=Decimal("100"), height_mm=Decimal("100")))
        db.add(draft); db.commit()
        issues = validate_listing_draft(db, draft)
        assert issues == [] and draft.status == "ready_for_approval"
        assert draft.variants[0].calculated_price_cny is not None
        assert Decimal(draft.variants[0].min_price_cny) < draft.variants[0].calculated_price_cny


def test_variant_image_list_uses_each_sku_image_as_ozon_primary_image() -> None:
    """Ozon treats images[0] as primary, so it must be this SKU's image."""
    gallery = ["https://img.test/gallery-main.jpg", "https://img.test/detail.jpg"]

    assert build_variant_image_list("https://img.test/sku-red.jpg", gallery) == [
        "https://img.test/sku-red.jpg",
        "https://img.test/gallery-main.jpg",
        "https://img.test/detail.jpg",
    ]


def test_variant_image_list_honors_explicit_per_sku_selection() -> None:
    gallery = ["https://img.test/public-a.jpg", "https://img.test/public-b.jpg"]
    assert build_variant_image_list(
        "https://img.test/sku-red.jpg",
        gallery,
        variant_image_urls=["https://img.test/sku-red.jpg", "https://img.test/public-b.jpg"],
    ) == ["https://img.test/sku-red.jpg", "https://img.test/public-b.jpg"]
    # An explicit empty selection is repaired to the SKU primary only; it must
    # never silently re-expand to another SKU's or the shared gallery's images.
    assert build_variant_image_list(
        "https://img.test/sku-red.jpg", gallery, variant_image_urls=[]
    ) == ["https://img.test/sku-red.jpg"]


def test_attribute_update_uses_existing_offer_without_import_task() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["body"] = request.json() if hasattr(request, "json") else None
        return httpx.Response(200, json={"result": {"updated": True}})

    # httpx.Request has no json() helper; parse exactly what would cross the API boundary.
    def json_handler(request: httpx.Request) -> httpx.Response:
        import json
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(200, json={"result": {"updated": True}})

    with OzonSellerClient(
        client_id="test-client", api_key="test-key",
        transport=httpx.MockTransport(json_handler),
    ) as client:
        result = client.update_product_attributes(items=[{
            "offer_id": "KC000021-BLACK",
            "attributes": [{"complex_id": 0, "id": 1001, "values": [{"dictionary_value_id": 1, "value": "Black"}]}],
        }])

    assert result == {"result": {"updated": True}}
    assert captured["path"] == "/v1/product/attributes/update"
    assert captured["body"] == {"items": [{
        "offer_id": "KC000021-BLACK",
        "attributes": [{"complex_id": 0, "id": 1001, "values": [{"dictionary_value_id": 1, "value": "Black"}]}],
    }]}


def test_generated_content_assortment_claims_are_removed() -> None:
    content = "Материал: хлопок\nЦвет: в ассортименте (уточняйте при заказе).\n随机发货\nРазмер: 30 см"
    cleaned = _strip_ozon_assortment_claims(content)
    assert "в ассортименте" not in cleaned.lower()
    assert "随机" not in cleaned
    assert "Материал: хлопок" in cleaned
    assert "Размер: 30 см" in cleaned


def test_listing_change_classifier_treats_attribute_values_as_narrow_update() -> None:
    previous = {
        "title": "Товар", "images": ["https://example.test/a.jpg"],
        "attributes": [{"id": "100", "value_id": "1", "value": "Красный"}],
        "variants": [{"seller_sku": "XY000002-1", "price": "26.99", "variant_values": '{"Цвет":"Красный"}'}],
    }
    attributes_only = {
        **previous,
        "attributes": [{"id": "100", "value_id": "2", "value": "Чёрный"}],
        "variants": [{"seller_sku": "XY000002-1", "price": "26.99", "variant_values": '{"Цвет":"Чёрный"}'}],
    }
    price_changed = {
        **attributes_only,
        "variants": [{"seller_sku": "XY000002-1", "price": "29.99", "variant_values": '{"Цвет":"Чёрный"}'}],
    }

    assert _listing_change_hash(_listing_non_attribute_signature(previous)) == _listing_change_hash(_listing_non_attribute_signature(attributes_only))
    assert _listing_change_hash(_listing_non_attribute_signature(previous)) != _listing_change_hash(_listing_non_attribute_signature(price_changed))


def test_variant_image_list_falls_back_to_gallery_when_sku_image_is_missing() -> None:
    assert build_variant_image_list(None, ["https://img.test/gallery-main.jpg"]) == [
        "https://img.test/gallery-main.jpg",
    ]


def test_listing_validation_blocks_cross_category_type_and_type_attribute() -> None:
    """Do not create an Ozon import task with category/type values from different branches."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="类目类型测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(OzonGlobalCategoryCacheRecord(
            category_id="17028996", type_id="93531", title="旅游灯", title_zh="露营灯",
        ))
        draft = ListingDraftRecord(
            shop_id=shop.id, offer_id="TYPE-1", title="测试灯",
            category_id="17028996", type_id="91637", primary_image_url="https://example.test/main.jpg",
        )
        draft.variants.append(ListingVariantRecord(
            seller_sku="TYPE-1-BLACK", purchase_cost_cny=Decimal("20"),
            weight_g=Decimal("300"), length_mm=Decimal("100"), width_mm=Decimal("100"), height_mm=Decimal("100"),
        ))
        db.add(draft); db.commit()

        issues = validate_listing_draft(db, draft)
        assert any(issue["field"] == "category_type" for issue in issues)

        draft.type_id = "93531"
        draft.attribute_values.append(ListingAttributeValueRecord(
            attribute_id="8229", name="类型", value_id="91637", value_text="台灯",
        ))
        db.commit()
        issues = validate_listing_draft(db, draft)
        assert any(issue["field"] == "attributes.8229" for issue in issues)


def test_listing_draft_validation_blocks_missing_media_and_dimensions() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="上架错误测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        draft = ListingDraftRecord(shop_id=shop.id, offer_id="DRAFT-2", title="测试商品")
        draft.variants.append(ListingVariantRecord(seller_sku="DRAFT-2-ONE"))
        db.add(draft); db.commit()
        issues = validate_listing_draft(db, draft)
        assert draft.status == "validation_failed"
        assert {issue["field"] for issue in issues} >= {"category_id", "type_id", "primary_image_url", "variants.DRAFT-2-ONE"}


def test_listing_validation_requires_current_category_attributes() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="属性预检测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(OzonGlobalAttributeCacheRecord(category_id="123", type_id="456", attribute_id="85", name="品牌", required=True, dictionary_id="1", value_type="String"))
        draft = ListingDraftRecord(shop_id=shop.id, offer_id="ATTR-1", title="属性测试商品", category_id="123", type_id="456", primary_image_url="https://example.test/main.jpg")
        draft.variants.append(ListingVariantRecord(seller_sku="ATTR-1-ONE", purchase_cost_cny=Decimal("20"), weight_g=Decimal("300"), length_mm=Decimal("100"), width_mm=Decimal("100"), height_mm=Decimal("100")))
        db.add(draft); db.commit()

        issues = validate_listing_draft(db, draft)
        assert {issue["field"] for issue in issues} == {"attributes.85"}

        draft.attribute_values.append(ListingAttributeValueRecord(attribute_id="85", name="品牌", value_text="仅文本品牌"))
        db.commit()
        assert {issue["field"] for issue in validate_listing_draft(db, draft)} == {"attributes.85"}
        draft.attribute_values[0].value_id = "970718"
        draft.attribute_values[0].value_text = "测试品牌"
        db.commit()
        assert {issue["field"] for issue in validate_listing_draft(db, draft)} == {"attributes.85"}
        db.add(OzonGlobalDictValueRecord(category_id="123", type_id="456", attribute_id="85", value_id="970718", value="测试品牌"))
        db.commit()
        assert validate_listing_draft(db, draft) == []


def test_listing_validation_accepts_multiple_dictionary_values() -> None:
    """A multi-select Ozon attribute stores IDs/texts pipe-separated in one row."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="多选属性测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(OzonAttributeCacheRecord(
            shop_id=shop.id, category_id="123", type_id="456", attribute_id="9163",
            name="性别", required=True, dictionary_id="1", value_type="String", is_collection=True,
        ))
        db.add_all([
            OzonAttributeDictionaryValueRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="9163", value_id="22880", value="男士"),
            OzonAttributeDictionaryValueRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="9163", value_id="22881", value="女士"),
        ])
        draft = ListingDraftRecord(shop_id=shop.id, offer_id="GENDER-1", title="性别多选测试", category_id="123", type_id="456", primary_image_url="https://example.test/main.jpg")
        draft.attribute_values.append(ListingAttributeValueRecord(
            attribute_id="9163", name="性别", value_id="22880|22881", value_text="男士|女士",
        ))
        draft.variants.append(ListingVariantRecord(seller_sku="GENDER-1-ONE", purchase_cost_cny=Decimal("20"), weight_g=Decimal("300"), length_mm=Decimal("100"), width_mm=Decimal("100"), height_mm=Decimal("100")))
        db.add(draft); db.commit()

        assert validate_listing_draft(db, draft) == []


def test_dictionary_selection_uses_global_cache_and_canonicalizes_label() -> None:
    """A UI-selected global menu value must not depend on a stale shop cache."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="全局字典测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(OzonAttributeCacheRecord(
            shop_id=shop.id, category_id="123", type_id="456", attribute_id="23191",
            name="灯罩材料", required=False, dictionary_id="124413080", value_type="String", is_collection=True,
        ))
        db.add(OzonGlobalDictValueRecord(
            category_id="123", type_id="456", attribute_id="23191", value_id="972271100", value="玻璃",
        ))
        draft = ListingDraftRecord(
            shop_id=shop.id, offer_id="GLOBAL-DICT-1", title="全局字典测试", category_id="123", type_id="456",
            primary_image_url="https://example.test/main.jpg",
        )
        draft.attribute_values.append(ListingAttributeValueRecord(
            attribute_id="23191", name="灯罩材料", value_id="972271100", value_text="旧显示文字",
        ))
        draft.variants.append(ListingVariantRecord(
            seller_sku="GLOBAL-DICT-1-ONE", purchase_cost_cny=Decimal("20"), weight_g=Decimal("300"),
            length_mm=Decimal("100"), width_mm=Decimal("100"), height_mm=Decimal("100"),
        ))
        db.add(draft); db.commit()

        assert validate_listing_draft(db, draft) == []


def test_listing_validation_uses_global_attribute_template_for_new_shop() -> None:
    """A shop need not have a copied attribute cache before its first submit."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="新店全局属性测试店", currency="CNY")
        db.add(shop)
        db.add(OzonGlobalCategoryCacheRecord(
            category_id="17028650", type_id="122770107", title="手机挂绳",
        ))
        db.add(OzonGlobalAttributeCacheRecord(
            category_id="17028650", type_id="122770107", attribute_id="9048",
            name="型号名称（针对合并为一张商品卡片）", required=False,
            dictionary_id="", value_type="String",
        ))
        db.commit(); db.refresh(shop)
        draft = ListingDraftRecord(
            shop_id=shop.id, offer_id="XY000002", title="手机挂绳",
            category_id="17028650", type_id="122770107",
            primary_image_url="https://example.test/main.jpg",
        )
        draft.attribute_values.append(ListingAttributeValueRecord(
            attribute_id="9048", name="型号名称（针对合并为一张商品卡片）", value_text="XY000002",
        ))
        draft.variants.append(ListingVariantRecord(
            seller_sku="XY000002-ONE", purchase_cost_cny=Decimal("20"),
            weight_g=Decimal("300"), length_mm=Decimal("100"), width_mm=Decimal("100"), height_mm=Decimal("100"),
        ))
        db.add(draft); db.commit()

        assert validate_listing_draft(db, draft) == []


def test_listing_validation_rejects_optional_dictionary_text_without_ozon_id() -> None:
    """Even optional dictionary attributes become invalid once text is supplied."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="可选字典属性测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(OzonAttributeCacheRecord(
            shop_id=shop.id, category_id="123", type_id="456", attribute_id="10016",
            name="装修风格", required=False, dictionary_id="35294382", value_type="String",
        ))
        draft = ListingDraftRecord(
            shop_id=shop.id, offer_id="STYLE-1", title="装修风格测试", category_id="123", type_id="456",
            primary_image_url="https://example.test/main.jpg",
        )
        draft.attribute_values.append(ListingAttributeValueRecord(
            attribute_id="10016", name="装修风格", value_id=None, value_text="休闲",
        ))
        draft.variants.append(ListingVariantRecord(
            seller_sku="STYLE-1-ONE", purchase_cost_cny=Decimal("20"), weight_g=Decimal("300"),
            length_mm=Decimal("100"), width_mm=Decimal("100"), height_mm=Decimal("100"),
        ))
        db.add(draft); db.commit()

        issues = validate_listing_draft(db, draft)
        assert any(issue["field"] == "attributes.10016" and "下拉菜单" in issue["message"] for issue in issues)


def test_auto_fix_removes_assortment_claim_and_optional_zero_measurements() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="Ozon 反馈自动修复店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add_all([
            OzonGlobalAttributeCacheRecord(category_id="123", type_id="456", attribute_id="7914", name="体积/容量，毫升", required=False, dictionary_id="", value_type="Decimal"),
            OzonGlobalAttributeCacheRecord(category_id="123", type_id="456", attribute_id="4191", name="简介", required=False, dictionary_id="", value_type="String"),
        ])
        draft = ListingDraftRecord(
            shop_id=shop.id, offer_id="FIX-1", title="反馈自动修复", category_id="123", type_id="456",
            description="产品说明。\n- Цвет: в ассортименте (уточняйте при заказе).",
            ozon_issues_json='[{"code":"VALUE_MIN_LIMIT"},{"code":"BR_ASSORTMENT"}]',
        )
        draft.attribute_values.extend([
            ListingAttributeValueRecord(attribute_id="7914", name="体积/容量，毫升", value_text="0"),
            ListingAttributeValueRecord(attribute_id="4191", name="简介", value_text="Цвет: в ассортименте (уточняйте при заказе)."),
        ])
        db.add(draft); db.commit(); db.refresh(draft)

        result = auto_fix_listing(shop.id, draft.id, db)
        db.refresh(draft)
        assert result["fix_count"] >= 3
        assert "в ассортименте" not in draft.description
        assert all(value.attribute_id != "7914" for value in draft.attribute_values)
        assert "в ассортименте" not in next(value.value_text for value in draft.attribute_values if value.attribute_id == "4191")


def test_create_listing_draft_persists_attribute_values() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="草稿属性保存店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        db.add(OzonCategoryCacheRecord(shop_id=shop.id, category_id="123", type_id="456", title="测试类目"))
        db.add(OzonAttributeCacheRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="85", name="品牌", required=True, dictionary_id="1", value_type="String"))
        db.add(OzonAttributeDictionaryValueRecord(shop_id=shop.id, category_id="123", type_id="456", attribute_id="85", value_id="970718", value="测试品牌"))
        db.commit()
        payload = ListingDraftCreate.model_validate({
            "offer_id": "SAVE-ATTR-1",
            "title": "保存属性测试",
            "category_id": "123",
            "type_id": "456",
            "primary_image_url": "https://example.test/main.jpg",
            "attributes": [{"attribute_id": "85", "name": "品牌", "value_id": "970718", "value_text": "测试品牌"}],
            "variants": [{"seller_sku": "SAVE-ATTR-1-ONE", "purchase_cost_cny": 20, "weight_g": 300, "length_mm": 100, "width_mm": 100, "height_mm": 100}],
        })

        draft = create_listing_draft(shop.id, payload, db)
        assert len(draft.attribute_values) == 1
        assert draft.attribute_values[0].attribute_id == "85"
        assert draft.attribute_values[0].value_id == "970718"


def test_create_listing_draft_uses_shared_category_cache_across_shops() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        first = Shop(name="类目来源店", currency="CNY")
        second = Shop(name="草稿目标店", currency="CNY")
        db.add_all([first, second]); db.commit(); db.refresh(first); db.refresh(second)
        # Category metadata is global.  A category cached while working on
        # one shop must be usable when creating a draft for another shop.
        db.add(OzonGlobalCategoryCacheRecord(category_id="123", type_id="456", title="共享类目"))
        db.commit()
        payload = ListingDraftCreate.model_validate({
            "offer_id": "CROSS-SHOP-1", "title": "跨店类目测试", "category_id": "123", "type_id": "456",
            "variants": [{"seller_sku": "CROSS-SHOP-1-ONE"}],
        })
        draft = create_listing_draft(second.id, payload, db)
        assert draft.shop_id == second.id
        assert draft.category_id == "123"


def test_listing_validation_rejects_offer_id_over_50_characters() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="Offer ID 长度测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        draft = ListingDraftRecord(
            shop_id=shop.id, offer_id="KC000006", title="测试", category_id="123", type_id="456",
            primary_image_url="https://example.test/main.jpg",
        )
        draft.variants.append(ListingVariantRecord(
            seller_sku="KC000006-Чехол_для_телефона_с_дизайном_Человека-паука",
            purchase_cost_cny=Decimal("20"), weight_g=Decimal("300"),
            length_mm=Decimal("100"), width_mm=Decimal("100"), height_mm=Decimal("100"),
        ))
        db.add(draft); db.commit()

        issues = validate_listing_draft(db, draft)
        assert any("50 字符" in issue["message"] for issue in issues)


def test_sync_feedback_reads_failed_import_task_before_offer_lookup(monkeypatch) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="导入反馈测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        draft = ListingDraftRecord(
            shop_id=shop.id, offer_id="KC000015", title="尺寸错误商品",
            status="submitted", import_task_id="ozon-task-failed", ozon_product_id=None,
        )
        db.add(draft); db.commit(); db.refresh(draft)

        class FakeOzonClient:
            def __init__(self, **_): pass
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def get_import_info(self, *, task_id):
                assert task_id == "ozon-task-failed"
                return {"result": {"items": [{"offer_id": "KC000015", "errors": [{"code": "DIMENSIONS", "field": "height", "message": "尺寸不正确"}]}]}}
            def list_products(self, **_):
                raise AssertionError("失败导入任务不得回退按 Offer ID 查询商品")

        monkeypatch.setattr("app.sync_service._credentials", lambda *_: ("client", "api-key"))
        monkeypatch.setattr("app.integrations.ozon_seller.OzonSellerClient", FakeOzonClient)

        result = sync_listing_feedback(shop.id, draft.id, db)

        assert result["ozon_product_id"] is None
        assert result["issues"] == [{
            "type": "ozon_error", "code": "DIMENSIONS", "field": "height",
            "level": "", "attribute_id": None, "attribute_name": "",
            "message": "尺寸不正确", "auto_fixable": False,
        }]


def test_sync_feedback_uses_ozon_error_texts_when_message_is_empty(monkeypatch) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="Ozon错误文案测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        draft = ListingDraftRecord(shop_id=shop.id, offer_id="KC000016", title="密度错误商品", ozon_product_id=123)
        db.add(draft); db.commit(); db.refresh(draft)

        class FakeOzonClient:
            def __init__(self, **_): pass
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def get_product_info(self, **_):
                return {"items": [{"errors": [{"code": "INCORRECT_DENSITY", "field": "density", "level": "ERROR_LEVEL_ERROR", "texts": {"message": "尺寸或重量不正确"}}], "statuses": {}, "sources": []}]}
            def get_product_attributes_v4(self, **_): return {"result": []}

        monkeypatch.setattr("app.sync_service._credentials", lambda *_: ("client", "api-key"))
        monkeypatch.setattr("app.integrations.ozon_seller.OzonSellerClient", FakeOzonClient)

        result = sync_listing_feedback(shop.id, draft.id, db)

        assert result["issues"][0]["message"] == "尺寸或重量不正确"


def test_manual_package_correction_updates_linked_draft_variants() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="尺重联动测试店", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)
        source = SourceProductRecord(shop_id=shop.id, source_platform="1688", source_product_id="package-test", title="尺重测试商品")
        db.add(source); db.flush()
        db.add_all([
            SourceProductShopRecord(source_product_id=source.id, shop_id=shop.id),
            SourceVariantRecord(source_product_id=source.id, source_sku="source-sku", spec_name="默认", stock=10),
        ])
        draft = ListingDraftRecord(shop_id=shop.id, source_product_id=source.id, offer_id="PACKAGE-1", title="尺重测试草稿")
        draft.variants.append(ListingVariantRecord(seller_sku="PACKAGE-1-A", weight_g=Decimal("10"), length_mm=Decimal("10"), width_mm=Decimal("10"), height_mm=Decimal("10")))
        db.add(draft); db.commit(); db.refresh(draft)

        result = update_source_product_package(shop.id, source.id, SourcePackageUpdate(weight_g=150, length_mm=100, width_mm=100, height_mm=100), db)

        assert result["updated_draft_ids"] == [draft.id]
        variant = draft.variants[0]
        assert (float(variant.weight_g), float(variant.length_mm), float(variant.width_mm), float(variant.height_mm)) == (150, 100, 100, 100)
