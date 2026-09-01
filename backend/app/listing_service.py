"""Local-only listing draft validation; it never invokes an Ozon write API."""

from __future__ import annotations

import json
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .erp_models import (
    ListingDraftRecord,
    OzonGlobalCategoryCacheRecord,
    OzonGlobalAttributeCacheRecord,
    OzonGlobalDictValueRecord,
)
from .pricing import PriceInput, PricingService
from .pricing_policy_service import domain_policy, get_pricing_policy
from .offer_id_service import OZON_OFFER_ID_MAX_LENGTH
from .listing_cache_service import promote_legacy_listing_caches


def build_variant_image_list(variant_image_url: str | None, gallery_images: list[str], *, variant_image_urls: list[str] | None = None, limit: int = 15) -> list[str]:
    """Build one SKU's image list; explicit selections stay independent."""
    def valid_image(value: str | None) -> bool:
        return bool(value and str(value).strip().lower() not in {"none", "null", "undefined"}
                    and str(value).strip().lower().startswith(("http://", "https://")))

    if variant_image_urls is not None:
        selected = list(variant_image_urls)
        if valid_image(variant_image_url) and (not selected or selected[0] != variant_image_url):
            selected = [variant_image_url, *selected]
        ordered = selected
    else:
        ordered = [variant_image_url, *gallery_images] if valid_image(variant_image_url) else list(gallery_images)
    result: list[str] = []
    for image_url in ordered:
        if valid_image(image_url) and image_url not in result:
            result.append(image_url)
        if len(result) >= limit:
            break
    return result


def normalize_dictionary_attribute_value(
    db: Session,
    *,
    shop_id: int,
    category_id: str,
    type_id: str,
    attribute: OzonGlobalAttributeCacheRecord,
    value_id: str | None,
    value_text: str | None,
) -> tuple[str | None, str | None]:
    """Resolve and canonicalize an Ozon dictionary selection from the local cache.

    A dictionary label is never safe to send by itself.  The editor may contain
    legacy text-only values, so an exact cached label can be repaired; otherwise
    the operator must select an Ozon option explicitly.
    """
    if not attribute.dictionary_id or not (value_text or value_id):
        return value_id, value_text

    promote_legacy_listing_caches(db, category_id=str(category_id), type_id=str(type_id))

    ids = [part.strip() for part in (value_id or "").split("|") if part.strip()]
    texts = [part.strip() for part in (value_text or "").split("|") if part.strip()]
    resolved_ids: list[str] = []
    resolved_texts: list[str] = []
    count = max(len(ids), len(texts))
    for index in range(count):
        current_id = ids[index] if index < len(ids) else None
        current_text = texts[index] if index < len(texts) else None
        # Ozon category dictionaries are global. The editor reads the global
        # cache, so persistence must validate against that same source instead
        # of rejecting a valid menu option merely because an old shop cache has
        # not yet copied it.
        global_statement = select(OzonGlobalDictValueRecord).where(
            OzonGlobalDictValueRecord.category_id == str(category_id),
            OzonGlobalDictValueRecord.type_id == str(type_id),
            OzonGlobalDictValueRecord.attribute_id == attribute.attribute_id,
        )
        if current_id:
            cached = db.scalar(global_statement.where(OzonGlobalDictValueRecord.value_id == current_id))
        elif current_text:
            cached = db.scalar(global_statement.where(func.lower(OzonGlobalDictValueRecord.value) == current_text.casefold()))
        else:
            cached = None
        # A selected Ozon ID is authoritative. Return its canonical cached
        # label, which also makes labels with trailing spaces harmless.
        if cached is None:
            raise ValueError(f"属性“{attribute.name}”必须从 Ozon 下拉菜单选择，不能只填写文字。")
        resolved_ids.append(cached.value_id)
        resolved_texts.append(cached.value)

    if not resolved_ids:
        raise ValueError(f"属性“{attribute.name}”必须从 Ozon 下拉菜单选择，不能只填写文字。")
    if not attribute.is_collection and len(resolved_ids) != 1:
        raise ValueError(f"属性“{attribute.name}”只能选择一个 Ozon 菜单值。")
    return "|".join(resolved_ids), "|".join(resolved_texts)


def validate_listing_draft(db: Session, draft: ListingDraftRecord) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    if not draft.category_id:
        issues.append({"field": "category_id", "message": "请选择 Ozon 末级类目后再进入发布审批。"})
    if not draft.type_id:
        issues.append({"field": "type_id", "message": "请选择 Ozon 商品类型后再进入发布审批。"})
    if draft.category_id and draft.type_id:
        promote_legacy_listing_caches(
            db, category_id=str(draft.category_id), type_id=str(draft.type_id),
        )
        # Category and type are a pair in Ozon's tree.  A valid category ID and
        # a valid type ID from different branches still produces an async Ozon
        # import failure, so reject that combination before an import task is
        # created.  Keep isolated/unit-test databases usable until they have a
        # category snapshot at all.
        has_category_snapshot = db.scalar(select(OzonGlobalCategoryCacheRecord.id).limit(1)) is not None
        category_type_exists = db.scalar(select(OzonGlobalCategoryCacheRecord.id).where(
            OzonGlobalCategoryCacheRecord.category_id == str(draft.category_id),
            OzonGlobalCategoryCacheRecord.type_id == str(draft.type_id),
        ).limit(1)) is not None
        if has_category_snapshot and not category_type_exists:
            issues.append({
                "field": "category_type",
                "message": "所选 Ozon 类目与商品类型不是同一有效组合；请重新从“类目和类型”菜单选择后保存。",
            })
        # Category attributes are shared by Ozon across shops.  Submission and
        # dictionary normalization already use the global snapshot; validation
        # must use that same source or a newly connected shop with no copied
        # shop-level rows will be rejected despite having a valid category.
        global_attribute_templates = list(db.scalars(select(OzonGlobalAttributeCacheRecord).where(
            OzonGlobalAttributeCacheRecord.category_id == str(draft.category_id),
            OzonGlobalAttributeCacheRecord.type_id == str(draft.type_id),
        )))
        attribute_templates = global_attribute_templates
        if not attribute_templates:
            issues.append({"field": "attributes", "message": "当前类目的 Ozon 属性模板尚未缓存，请重新选择类目后再预检。"})
        values_by_attribute = {value.attribute_id: value for value in draft.attribute_values}
        # Ozon attribute 8229 is the product type selector.  It is not an
        # independent merchandising attribute: its dictionary value must be
        # exactly the type_id sent at the top level of each import item.
        type_attribute = values_by_attribute.get("8229")
        if type_attribute and (type_attribute.value_id or "").strip() and str(type_attribute.value_id).strip() != str(draft.type_id):
            issues.append({
                "field": "attributes.8229",
                "message": "“类型”属性与所选 Ozon 商品类型不一致；请重新选择类目和类型后保存。",
            })
        for attribute in attribute_templates:
            value = values_by_attribute.get(attribute.attribute_id)
            has_text = bool(value and (value.value_text or "").strip())
            has_value = bool(value and ((value.value_id or "").strip() if attribute.dictionary_id else has_text))
            if attribute.dictionary_id and (has_text or has_value):
                try:
                    normalize_dictionary_attribute_value(
                        db, shop_id=draft.shop_id, category_id=draft.category_id,
                        type_id=draft.type_id, attribute=attribute,
                        value_id=value.value_id, value_text=value.value_text,
                    )
                    has_value = True
                except ValueError as exc:
                    has_value = False
                    issues.append({"field": f"attributes.{attribute.attribute_id}", "message": str(exc)})
            if attribute.required and not has_value:
                issues.append({"field": f"attributes.{attribute.attribute_id}", "message": f"请填写 Ozon 必填属性：{attribute.name}。"})
    if not _is_http_url(draft.primary_image_url):
        issues.append({"field": "primary_image_url", "message": "请提供可访问的主图 URL。"})
    if not draft.variants:
        issues.append({"field": "variants", "message": "至少需要一个商品变体。"})
    if len(draft.offer_id or "") > OZON_OFFER_ID_MAX_LENGTH:
        issues.append({"field": "offer_id", "message": "ParentSKU / Offer ID 不能超过 50 个字符。"})
    seen_offer_ids: set[str] = set()
    all_risk_codes: list[str] = []
    for variant in draft.variants:
        prefix = f"variants.{variant.seller_sku}"
        if len(variant.seller_sku or "") > OZON_OFFER_ID_MAX_LENGTH:
            issues.append({"field": f"{prefix}.seller_sku", "message": f"SKU 编号超过 Ozon 50 字符限制：{variant.seller_sku}"})
        if variant.seller_sku in seen_offer_ids:
            issues.append({"field": f"{prefix}.seller_sku", "message": f"SKU 编号重复：{variant.seller_sku}"})
        seen_offer_ids.add(variant.seller_sku)
        values = (variant.purchase_cost_cny, variant.weight_g, variant.length_mm, variant.width_mm, variant.height_mm)
        if any(value is None for value in values):
            issues.append({"field": prefix, "message": "请补全采购成本、重量和包装尺寸（CNY / g / mm）。"})
            continue
        try:
            calculation = PricingService().calculate(PriceInput(
                purchase_cost=Decimal(variant.purchase_cost_cny), weight_g=Decimal(variant.weight_g),
                length_mm=Decimal(variant.length_mm), width_mm=Decimal(variant.width_mm), height_mm=Decimal(variant.height_mm),
                policy=domain_policy(get_pricing_policy(db), draft.shop_id),
            ))
            variant.calculated_price_cny = calculation.price
            all_risk_codes = [r.value for r in calculation.risk_codes]
            # User pricing rules: if price_cny is manually set, derive old_price and min_price from it
            # old_price = price * 2; min_price = floor(price), if integer then -1
            if variant.price_cny:
                from decimal import ROUND_FLOOR
                _p = Decimal(str(variant.price_cny))
                variant.old_price_cny = str(_p * Decimal(get_pricing_policy(db).old_price_multiplier))
                _whole = _p.to_integral_value(rounding=ROUND_FLOOR)
                if _whole == _p:
                    variant.min_price_cny = str(_whole - Decimal("1"))
                else:
                    variant.min_price_cny = str(_whole)
            else:
                variant.min_price_cny = calculation.min_price
                variant.old_price_cny = calculation.old_price
        except ValueError as exc:
            issues.append({"field": prefix, "message": f"CNY 核价未通过：{exc}"})
    draft.status = "ready_for_approval" if not issues else "validation_failed"
    risk_data = {"issues": issues}
    if all_risk_codes:
        risk_data["risk_codes"] = all_risk_codes
    draft.validation_json = json.dumps(risk_data, ensure_ascii=False, separators=(",", ":"))
    db.commit()
    return issues


def _is_http_url(value: str | None) -> bool:
    return bool(value and value.startswith(("https://", "http://")))
