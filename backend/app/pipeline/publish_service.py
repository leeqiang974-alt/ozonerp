"""P7: Approval and small-batch write-back.

Manages the approval flow, audit trail, and staged submission to the Ozon
/v3/product/import endpoint.  All write operations require explicit approval
and produce audit events.
"""

from __future__ import annotations

import json
import hashlib
import uuid
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..offer_id_service import normalize_offer_id

from ..erp_models import (
    AuditEventRecord,
    ListingAttributeValueRecord,
    ListingDraftRecord,
    ListingVariantRecord,
    OzonGlobalDictValueRecord,
    PipelineProductRecord,
    SourceMediaRecord,
    SourceProductRecord,
    SourceVariantRecord,
)
from ..integrations.ozon_seller import OzonSellerClient, OzonSellerError
from .rich_content import get_rich_content_attribute
from ..sync_service import SyncConfigurationError, _credentials
from ..decision_memory_service import apply_ozon_feedback
from ..listing_cache_service import promote_legacy_listing_caches
from ..ai_service import generate_product_hashtags, generate_rich_content, sanitize_hashtags
from ..models import Shop


_COLOR_RU = {
    "白色":"Белый","米色":"Бежевый","黑色":"Черный","棕色":"Коричневый","灰色":"Серый",
    "黄色":"Желтый","红色":"Красный","粉红色":"Розовый","蓝色":"Синий","金色":"Золотой",
    "绿色":"Зеленый","橙色":"Оранжевый","紫色":"Фиолетовый","银色":"Серебристый","多色":"Разноцветный",
}
_STABLE_COLOR_NAMES = tuple(_COLOR_RU)


def _variant_color(db: Session, pipeline: PipelineProductRecord, source: SourceProductRecord, var: dict[str, Any], variant_index: int = 0) -> dict[str, str]:
    """Resolve an exact SKU color or a deterministic dictionary fallback."""
    promote_legacy_listing_caches(
        db, category_id=str(pipeline.matched_category_id or ""),
        type_id=str(pipeline.matched_type_id or ""),
    )
    spec=str(var.get("spec_name") or "")
    candidates=list(db.scalars(select(OzonGlobalDictValueRecord).where(
        OzonGlobalDictValueRecord.category_id==str(pipeline.matched_category_id),
        OzonGlobalDictValueRecord.type_id==str(pipeline.matched_type_id),
        OzonGlobalDictValueRecord.attribute_id=="10096",
    )))
    by_name={str(row.value):str(row.value_id) for row in candidates}
    exact=next((name for name in sorted(by_name,key=len,reverse=True) if name and name in spec),None)
    if exact:
        name=exact
    else:
        available=[name for name in _STABLE_COLOR_NAMES if name in by_name and name!="多色"]
        if not available and "多色" in by_name:
            available=["多色"]
        if not available:
            raise ValueError("当前类目缺少可用的Ozon颜色字典，不能生成批量草稿")
        # One stable offset per Offer plus the stable SKU order prevents
        # collisions within the same product card while remaining repeatable.
        index=(int(hashlib.sha256(str(source.source_product_id).encode("utf-8")).hexdigest()[:8],16)+variant_index)%len(available)
        name=available[index]
    return {"value_id":by_name[name],"value_text":name,"name_ru":_COLOR_RU.get(name,name)}


def _common_product_images(source: SourceProductRecord, variant_data: dict[str, Any]) -> list[str]:
    variant_urls={str(row.get("image_url") or "") for row in variant_data.get("variants",[]) if row.get("image_url")}
    primary = variant_data.get("primary_image_url") or source.main_image_url
    if str(primary or "") in variant_urls:
        primary = source.main_image_url if str(source.main_image_url or "") not in variant_urls else None
    ordered=[primary]+[
        row.get("url") for row in variant_data.get("media",[])
        if row.get("type")!="variant" and row.get("url") not in variant_urls and row.get("url") != primary
    ]
    # The shared/public gallery is capped independently from SKU images.
    return list(dict.fromkeys(url for url in ordered if isinstance(url,str) and url.startswith(("http://","https://"))))[:15]


def source_public_gallery(
    db: Session,
    source: SourceProductRecord,
    existing_images: list[str] | None = None,
) -> list[str]:
    """Return the draft's public gallery without any SKU-specific image.

    A 1688 snapshot may legitimately have dozens of SKU images.  They belong
    only on variant rows, while this list is the Ozon shared gallery and is
    capped independently at 15 images.  Existing public selections retain
    their order; the latest source public images only fill missing entries.
    """
    sku_urls = {
        str(row.image_url).strip()
        for row in db.scalars(select(SourceVariantRecord).where(
            SourceVariantRecord.source_product_id == source.id,
        ))
        if row.image_url and str(row.image_url).strip()
    }
    source_images = [
        str(row.url).strip()
        for row in db.scalars(select(SourceMediaRecord).where(
            SourceMediaRecord.source_product_id == source.id,
            SourceMediaRecord.media_type == "image",
        ).order_by(SourceMediaRecord.sort_order, SourceMediaRecord.id))
        if str(row.url or "").strip().startswith(("http://", "https://"))
        and str(row.url).strip() not in sku_urls
    ]
    retained = [
        str(url).strip()
        for url in (existing_images or [])
        if isinstance(url, str)
        and str(url).strip().startswith(("http://", "https://"))
        and str(url).strip() not in sku_urls
    ]
    if not source_images and source.main_image_url and str(source.main_image_url).startswith(("http://", "https://")):
        source_images = [str(source.main_image_url)]
    return list(dict.fromkeys(retained + source_images))[:15]


def build_import_payload(db: Session, shop_id: int, source_product_id: int) -> dict[str, Any]:
    """Build the Ozon /v3/product/import items list from pipeline data.

    Shared between P6 payload preview and P7 actual submission so the preview
    always matches what gets sent.
    """
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found")
    source = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.id == source_product_id,
    ))
    if source is None:
        raise ValueError("source product not found")
    variant_data = json.loads(pipeline.variant_mapping_json) if pipeline.variant_mapping_json else {}
    attr_mapping = json.loads(pipeline.attribute_mapping_json) if pipeline.attribute_mapping_json else []
    pricing = json.loads(pipeline.pricing_json) if pipeline.pricing_json else {}
    weight_g, depth_mm, width_mm, height_mm = _extract_dimensions(pricing)
    draft = db.get(ListingDraftRecord, pipeline.listing_draft_id) if pipeline.listing_draft_id else None
    if draft is None:
        draft = db.scalar(select(ListingDraftRecord).where(
            ListingDraftRecord.shop_id == shop_id,
            ListingDraftRecord.source_product_id == source_product_id,
        ))
    draft_variants={row.seller_sku:row for row in (draft.variants if draft else [])}

    # Build attribute list from P3 mapping
    attributes_list: list[dict[str, Any]] = []
    if draft:
        attribute_rows=[{"attribute_id":row.attribute_id,"value_id":row.value_id,"value_text":row.value_text} for row in draft.attribute_values]
    else:
        attribute_rows=[row for row in attr_mapping if row.get("matched")]
    for attr in attribute_rows:
        value_text=str(attr.get("value_text") or "")
        value_id=str(attr.get("value_id") or "")
        if not value_text and not value_id: continue
        # Ozon's theme-tag attribute accepts exactly one attribute value.  The
        # value itself is the space-separated tag line; sending every tag as a
        # separate value is rejected with ERROR_ATTRIBUTE_IS_NOT_COLLECTION.
        if str(attr.get("attribute_id")) == "23171":
            tags=sanitize_hashtags(value_text, max_count=30)
            if not tags:
                continue
            attributes_list.append({
                "complex_id":0,
                "id":"23171",
                "values":[{"dictionary_value_id":0,"value":" ".join(tags)}],
            })
            continue
        ids=[part.strip() for part in value_id.split("|") if part.strip()] if value_id else []
        texts=[part.strip() for part in value_text.split("|")] if "|" in value_text else [value_text]
        values=[]
        for index,text in enumerate(texts):
            values.append({"dictionary_value_id":ids[index] if index<len(ids) else 0,"value":text})
        attributes_list.append({"complex_id":0,"id":str(attr["attribute_id"]),"values":values})

    # Variant-dimension attributes (Ozon is_aspect) must carry each SKU's own
    # value on submission, not the single product-level value copied into every
    # item.  Load the aspect attribute map (id -> name) once from the shared
    # category cache; colour (10096/10097) keeps its dedicated path below.
    aspect_attrs: dict[str, str] = {}
    try:
        from ..listing_metadata_service import get_category_attributes
        for _ca in get_category_attributes(db, shop_id, str(pipeline.matched_category_id or ""), str(pipeline.matched_type_id or "")):
            if _ca.get("is_aspect") and str(_ca.get("id") or "") not in {"10096", "10097"}:
                aspect_attrs[str(_ca["id"])] = str(_ca.get("name") or "")
    except Exception:
        aspect_attrs = {}

    # Filter valid image URLs. Variant-specific images are kept separately
    # and must never inflate the shared gallery count.
    pipeline_variants = variant_data.get("variants", [])
    # A saved draft is the canonical submission snapshot. Older pipeline rows
    # can contain a stale or truncated variant mapping (for example one item
    # after a 42-SKU draft was edited). Preserve every saved draft SKU and use
    # the pipeline row only to enrich source_sku/spec_name for pricing lookup.
    variants = pipeline_variants
    if draft and draft.variants:
        by_offer = {
            normalize_offer_id(str(row.get("seller_sku") or "")): row
            for row in pipeline_variants
            if row.get("seller_sku")
        }
        variants = []
        for index, draft_var in enumerate(draft.variants):
            pipeline_var = by_offer.get(normalize_offer_id(draft_var.seller_sku))
            if pipeline_var is None and index < len(pipeline_variants):
                pipeline_var = pipeline_variants[index]
            pipeline_var = pipeline_var or {}
            variants.append({
                **pipeline_var,
                "seller_sku": draft_var.seller_sku,
                "source_sku": pipeline_var.get("source_sku", ""),
                "spec_name": pipeline_var.get("spec_name", ""),
                "price_cny": draft_var.price_cny,
                "stock": draft_var.stock,
                "image_url": draft_var.image_url,
                "image_urls": draft_var.image_urls,
            })
    sku_image_urls = {str(row.get("image_url") or "").strip() for row in variants if str(row.get("image_url") or "").strip()}
    valid_images=(json.loads(draft.images_json or "[]") if draft else _common_product_images(source,variant_data))
    valid_images=[url for url in valid_images if isinstance(url,str) and url.startswith(("http://","https://")) and url not in sku_image_urls]
    valid_images=list(dict.fromkeys(valid_images))[:15]

    # Add Rich Content attribute (id=11254) from images + description
    rich_attr = get_rich_content_attribute(
        image_urls=valid_images,
        description_ru=pipeline.generated_description_ru or "",
        title_ru=pipeline.generated_title_ru or "",
    )
    # A number of legacy drafts contain an empty 11254 placeholder.  Treat it
    # as missing and replace it with the generated JSON; otherwise Ozon sees
    # the empty value and silently ignores the real rich content.
    attributes_list = [row for row in attributes_list if str(row.get("id")) != "11254"]
    attributes_list.append(rich_attr)

    # Build one item per variant (each variant is a separate Ozon product)
    items: list[dict[str, Any]] = []
    if not variants:
        # Fallback: single item with no variant
        variants = [{"seller_sku": f"SRC{source_product_id}", "source_sku": "", "price_cny": None}]

    for variant_index,var in enumerate(variants):
        draft_var=draft_variants.get(normalize_offer_id(var["seller_sku"])) or draft_variants.get(var["seller_sku"])
        color=_variant_color(db,pipeline,source,var,variant_index)
        saved_vv: dict[str, Any] = {}
        if draft_var and draft_var.variant_values_json:
            try:
                saved_vv=json.loads(draft_var.variant_values_json)
            except (json.JSONDecodeError, TypeError):
                saved_vv={}
        saved_ids=saved_vv.get("__ids__") if isinstance(saved_vv.get("__ids__"),dict) else {}
        saved_color_ids=saved_ids.get("商品颜色") if isinstance(saved_ids.get("商品颜色"),list) else []
        if saved_vv.get("商品颜色") and saved_color_ids:
            color={"value_id":str(saved_color_ids[0]),"value_text":str(saved_vv["商品颜色"]),"name_ru":str(saved_vv.get("颜色名称") or draft_var.name_ru or saved_vv["商品颜色"])}
        var_pricing = next(
            (p for p in pricing.get("variants", []) if p.get("source_sku") == var.get("source_sku")),
            {},
        )
        price_val=(draft_var.price_cny if draft_var and draft_var.price_cny is not None else var_pricing.get("price_cny") or var.get("price_cny"))
        old_price_val=(draft_var.old_price_cny if draft_var and draft_var.old_price_cny is not None else var_pricing.get("old_price_cny"))
        price_str = _format_price(price_val)
        old_price_str = _format_price(old_price_val) if old_price_val else price_str

        # Every is_aspect dimension (besides colour) uses this SKU's own saved
        # value, so SKUs differing by e.g. pack quantity keep their own values
        # on Ozon.  Missing per-SKU values fall back to the product-level value.
        item_attributes=[row for row in attributes_list if str(row.get("id")) not in aspect_attrs and str(row.get("id")) not in {"10096","10097"}]
        for aspect_id, aspect_name in aspect_attrs.items():
            per_sku = saved_vv.get(aspect_name)
            if per_sku is None or str(per_sku).strip() == "":
                common = next((r for r in attributes_list if str(r.get("id")) == aspect_id), None)
                if common:
                    item_attributes.append(common)
                continue
            ids = saved_ids.get(aspect_name)
            if not isinstance(ids, list):
                ids = []
            texts = [part.strip() for part in str(per_sku).split("|") if part.strip()] if "|" in str(per_sku) else [str(per_sku).strip()]
            values=[]
            for index,text in enumerate(texts):
                vid=str(ids[index]) if index < len(ids) and str(ids[index]).strip() else "0"
                values.append({"dictionary_value_id": int(vid) if str(vid).isdigit() else 0, "value": text})
            if values:
                item_attributes.append({"complex_id":0,"id":aspect_id,"values":values})
        item_attributes.extend([
            {"complex_id":0,"id":"10096","values":[{"dictionary_value_id":color["value_id"],"value":color["value_text"]}]},
            {"complex_id":0,"id":"10097","values":[{"dictionary_value_id":0,"value":color["name_ru"]}]},
        ])
        sku_image=(draft_var.image_url if draft_var and draft_var.image_url else var.get("image_url"))
        selected_images = draft_var.image_urls if draft_var and draft_var.image_urls is not None else var.get("image_urls")
        if selected_images is not None:
            item_images = list(dict.fromkeys([
                url for url in selected_images
                if isinstance(url, str) and url.startswith(("http://", "https://"))
            ]))
            if isinstance(sku_image, str) and sku_image.startswith(("http://", "https://")) and sku_image not in item_images:
                item_images.insert(0, sku_image)
        else:
            item_images=list(dict.fromkeys(([sku_image] if isinstance(sku_image,str) and sku_image.startswith(("http://","https://")) else [])+valid_images))
        items.append({
            "name": (draft.title if draft else None) or pipeline.generated_title_ru or source.title,
            "offer_id": normalize_offer_id(var["seller_sku"]),
            "description_category_id": int(pipeline.matched_category_id) if pipeline.matched_category_id else None,
            "type_id": int(pipeline.matched_type_id) if pipeline.matched_type_id else 0,
            "price": price_str,
            "old_price": old_price_str,
            "premium_price": "",
            "vat": "0",
            "description": (draft.description if draft else None) or pipeline.generated_description_ru or "",
            "depth": int(draft_var.length_mm) if draft_var and draft_var.length_mm else depth_mm,
            "width": int(draft_var.width_mm) if draft_var and draft_var.width_mm else width_mm,
            "height": int(draft_var.height_mm) if draft_var and draft_var.height_mm else height_mm,
            "weight": int(draft_var.weight_g) if draft_var and draft_var.weight_g else weight_g,
            "dimension_unit": "mm",
            "weight_unit": "g",
            "images": item_images,
            "attributes": item_attributes,
        })

    return {"items": items}


_MIRROR_IMAGE_HOSTS = {
    "cbu01.alicdn.com",
    "cbu02.alicdn.com",
    "cbu03.alicdn.com",
    "cbu04.alicdn.com",
    "img.alicdn.com",
}
_INVALID_IMAGE_VALUES = {"", "none", "null", "undefined"}
_OZON_IMAGE_MIN_EDGE_PX = 200
_OZON_IMAGE_MAX_WIDTH_PX = 4320
_OZON_IMAGE_MAX_HEIGHT_PX = 7680


def _needs_image_mirror(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower().rstrip(".")
    return host in _MIRROR_IMAGE_HOSTS or host.endswith(".alicdn.com")


def _inspect_submission_image(url: str, client: httpx.Client) -> dict[str, Any]:
    """Read a public image as Ozon will and validate its decoded dimensions.

    HTTP(S) syntax alone is insufficient: 1688 SKU thumbnails can be public
    and still be smaller than Ozon's 200px minimum.  The result is deliberately
    payload-only; source and per-SKU editor media remain untouched.
    """
    try:
        response = client.get(url)
        if response.status_code != 200:
            return {"valid": False, "reason": f"HTTP {response.status_code}"}
        content_type = str(response.headers.get("content-type") or "").lower()
        if not content_type.startswith("image/"):
            return {"valid": False, "reason": f"不是图片响应（{content_type or '无 Content-Type'}）"}
        with Image.open(BytesIO(response.content)) as image:
            width, height = image.size
        if width < _OZON_IMAGE_MIN_EDGE_PX or height < _OZON_IMAGE_MIN_EDGE_PX:
            return {"valid": False, "reason": f"分辨率 {width}×{height} 小于 Ozon 最低 200×200", "width": width, "height": height}
        if width > _OZON_IMAGE_MAX_WIDTH_PX or height > _OZON_IMAGE_MAX_HEIGHT_PX:
            return {"valid": False, "reason": f"分辨率 {width}×{height} 超过 Ozon 上限 4320×7680", "width": width, "height": height}
        return {"valid": True, "width": width, "height": height}
    except (httpx.HTTPError, OSError, UnidentifiedImageError) as exc:
        return {"valid": False, "reason": f"下载或解析失败：{str(exc)[:180]}"}


def _filter_submission_images_by_ozon_constraints(payload: dict[str, Any]) -> dict[str, Any]:
    """Remove inaccessible/out-of-range images from the outgoing Ozon payload.

    A product may still be safely submitted when its SKU thumbnail is too
    small as long as it has a compliant public detail image.  In that case the
    first compliant image becomes the Ozon main image.  If no compliant image
    remains for an item, stop before Ozon receives a broken card.
    """
    items = payload.get("items") or []
    urls = list(dict.fromkeys(
        str(url).strip()
        for item in items
        for url in (item.get("images") or [])
        if str(url or "").strip()
    ))
    checks: dict[str, dict[str, Any]] = {}
    # Images are unique per card but can still include many SKU thumbnails.
    # Bound concurrency keeps a 100-SKU card responsive without creating an
    # unbounded burst against the source host or OSS.
    with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(12.0), headers={"User-Agent": "OzonERP/1.0 image-preflight"}) as client:
        with ThreadPoolExecutor(max_workers=min(8, max(1, len(urls)))) as executor:
            future_to_url = {executor.submit(_inspect_submission_image, url, client): url for url in urls}
            for future in as_completed(future_to_url):
                url = future_to_url[future]
                try:
                    checks[url] = future.result(timeout=20.0)
                except TimeoutError:
                    checks[url] = {"valid": False, "reason": "图片校验超时（20s），已跳过"}
                except Exception as exc:
                    checks[url] = {"valid": False, "reason": f"图片校验异常：{str(exc)[:180]}"}

    filtered_urls: list[dict[str, str]] = []
    invalid_dimensions = 0
    download_failed = 0
    for item in items:
        original = [str(url).strip() for url in (item.get("images") or []) if str(url or "").strip()]
        accepted = [url for url in original if checks.get(url, {}).get("valid")]
        for url in original:
            check = checks.get(url, {})
            if check.get("valid"):
                continue
            reason = str(check.get("reason") or "图片校验失败")
            filtered_urls.append({"url": url, "reason": reason})
            if "分辨率" in reason:
                invalid_dimensions += 1
            else:
                download_failed += 1
        if not accepted:
            offer_id = str(item.get("offer_id") or "未知 SKU")
            reasons = "; ".join(str(checks.get(url, {}).get("reason") or "图片校验失败") for url in original[:3])
            raise ValueError(f"提交前图片检查失败：SKU {offer_id} 没有符合 Ozon 尺寸和下载要求的图片（{reasons}）。")
        item["images"] = list(dict.fromkeys(accepted))[:15]
    return {
        "filtered_urls": filtered_urls,
        "dimension_invalid_count": invalid_dimensions,
        "download_failed_count": download_failed,
    }


def _materialize_submission_images(
    db: Session,
    shop_id: int,
    source_product_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Make known hotlink-prone 1688 images durable before an Ozon write.

    Ozon downloads image URLs from its own servers.  Alibaba CDN URLs can be
    valid in a browser and still return ``pics_url_unsupported`` or
    ``some_image_failed`` to Ozon.  Mirror those URLs to the configured public
    OSS bucket and persist the mapping on the draft.  Unknown public domains
    are retained after syntactic validation so this function remains safe for
    existing user-provided URLs and offline tests.
    """
    items = payload.get("items") or []
    invalid: list[str] = []
    for item in items:
        for raw_url in item.get("images") or []:
            url = str(raw_url or "").strip()
            parsed = urlparse(url)
            if url.lower() in _INVALID_IMAGE_VALUES or parsed.scheme not in {"http", "https"} or not parsed.netloc:
                invalid.append(url or "<empty>")
                continue
    if invalid:
        raise ValueError(f"提交前图片检查失败：存在无效图片链接（{', '.join(invalid[:3])}）。")

    # Check source URLs before attempting OSS mirroring.  A 1688 gallery can
    # contain one image that was subsequently deleted while the remaining
    # SKU and detail images are still valid.  Mirroring first made that one
    # 404 abort the whole card.  The Ozon constraint filter removes only the
    # bad outgoing URL and keeps a valid fallback per SKU; it raises only when
    # an item would otherwise have no image at all.
    dimension_audit = _filter_submission_images_by_ozon_constraints(payload)
    removed_urls = {
        str(row.get("url") or "").strip()
        for row in dimension_audit.get("filtered_urls") or []
        if str(row.get("url") or "").strip()
    }
    all_urls = list(dict.fromkeys(
        str(raw_url).strip()
        for item in items
        for raw_url in (item.get("images") or [])
        if str(raw_url or "").strip()
    ))

    mappings: dict[str, str] = {}
    mirror_errors: list[str] = []
    mirror_candidates = [url for url in all_urls if _needs_image_mirror(url)]
    if mirror_candidates:
        try:
            from ..oss_upload import fetch_and_upload, get_bucket
            bucket = get_bucket()
        except Exception as exc:
            raise ValueError(f"提交前无法准备公共图片存储：{exc}") from exc
        for url in mirror_candidates:
            object_key = f"ozon-erp/source-images/{datetime.now(timezone.utc):%Y%m%d}/{hashlib.sha256(url.encode('utf-8')).hexdigest()[:32]}"
            try:
                mappings[url] = fetch_and_upload(url, object_key, verify=True, bucket=bucket)
            except Exception as exc:
                mirror_errors.append(f"{url}: {str(exc)[:240]}")
        # A source image can disappear between the HTTP preflight and the OSS
        # fetch.  Treat that URL as another removable source image instead of
        # aborting an otherwise valid card; only a SKU left without any image
        # is a blocking error (the payload filter has already checked that).
        if mirror_errors:
            failed_urls = {
                entry.split(": ", 1)[0].strip()
                for entry in mirror_errors
                if ": " in entry
            }
            removed_urls.update(failed_urls)
            for item in items:
                item["images"] = [url for url in item.get("images") or [] if str(url).strip() not in failed_urls]
                if not item.get("images"):
                    offer_id = str(item.get("offer_id") or "未知 SKU")
                    raise ValueError(f"提交前图片检查失败：SKU {offer_id} 的图片均无法下载。")

    def replace(value: Any) -> Any:
        if isinstance(value, str):
            if value.strip() in removed_urls:
                return ""
            return mappings.get(value, value)
        if isinstance(value, list):
            return [replace(item) for item in value]
        if isinstance(value, dict):
            return {key: replace(item) for key, item in value.items()}
        return value

    for item in items:
        item["images"] = [mappings.get(str(url), str(url)) for url in item.get("images") or []]

    if mappings:
        draft = db.scalar(select(ListingDraftRecord).where(
            ListingDraftRecord.shop_id == shop_id,
            ListingDraftRecord.source_product_id == source_product_id,
        ))
        if draft:
            if draft.images_json:
                draft.images_json = json.dumps(replace(json.loads(draft.images_json)), ensure_ascii=False)
            if draft.primary_image_url:
                draft.primary_image_url = mappings.get(draft.primary_image_url, draft.primary_image_url)
            for variant in draft.variants:
                if variant.image_url:
                    variant.image_url = mappings.get(variant.image_url, variant.image_url)
            for attr in draft.attribute_values:
                if str(attr.attribute_id) == "11254" and attr.value_text:
                    try:
                        attr.value_text = json.dumps(replace(json.loads(attr.value_text)), ensure_ascii=False)
                    except (TypeError, json.JSONDecodeError):
                        continue
            db.commit()

    # Persist deterministic dead-image removals in the draft snapshot.  The
    # source product/media rows remain untouched as collection evidence, while
    # retries and draft rebuilds no longer reintroduce a URL already confirmed
    # as 404/unreadable.
    if removed_urls:
        draft = db.scalar(select(ListingDraftRecord).where(
            ListingDraftRecord.shop_id == shop_id,
            ListingDraftRecord.source_product_id == source_product_id,
        ))
        if draft:
            if draft.images_json:
                draft.images_json = json.dumps([
                    url for url in json.loads(draft.images_json or "[]")
                    if str(url or "").strip() not in removed_urls
                ], ensure_ascii=False)
            if draft.primary_image_url and draft.primary_image_url.strip() in removed_urls:
                draft.primary_image_url = next((url for url in json.loads(draft.images_json or "[]") if url), None)
            for variant in draft.variants:
                if variant.image_url and variant.image_url.strip() in removed_urls:
                    variant.image_url = None
            for attr in draft.attribute_values:
                if str(attr.attribute_id) == "11254" and attr.value_text:
                    try:
                        attr.value_text = json.dumps(replace(json.loads(attr.value_text)), ensure_ascii=False)
                    except (TypeError, json.JSONDecodeError):
                        attr.value_text = attr.value_text
            db.commit()

    for item in items:
        item["attributes"] = replace(item.get("attributes") or [])
    return {
        "public_count": len({u for item in items for u in (item.get("images") or [])[1:]}),
        "sku_count": len(items),
        "invalid_count": len(dimension_audit["filtered_urls"]),
        "dimension_invalid_count": dimension_audit["dimension_invalid_count"],
        "download_failed_count": dimension_audit["download_failed_count"],
        "filtered_urls": dimension_audit["filtered_urls"],
        "mirrored_count": len(mappings),
        "mappings": mappings,
    }


def _format_price(value: Any) -> str:
    """Format a price value as a clean string for the Ozon API."""
    if value is None:
        return "0"
    try:
        f = float(value)
        if f == int(f):
            return str(int(f))
        return f"{f:.2f}".rstrip("0").rstrip(".")
    except (TypeError, ValueError):
        return "0"



def _extract_dimensions(pricing: dict) -> tuple[int, int, int, int]:
    """Extract dimensions from pricing_json, falling back to defaults."""
    weight = int(pricing.get("_extracted_weight_g") or 500)
    dims = pricing.get("_extracted_dimensions_mm") or [200, 150, 100]
    return weight, int(dims[0]), int(dims[1]), int(dims[2])

def create_listing_draft_from_pipeline(db: Session, shop_id: int, source_product_id: int) -> ListingDraftRecord:
    """Create a ListingDraftRecord from the pipeline output for approval."""
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found")
    if pipeline.pipeline_stage not in {"quality_checked","draft_created","approved","published"}:
        raise ValueError(f"pipeline must have completed quality check, current: {pipeline.pipeline_stage}")
    previous_stage=pipeline.pipeline_stage
    source = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.id == source_product_id,
    ))
    if source is None:
        raise ValueError("source product not found")
    variant_data = json.loads(pipeline.variant_mapping_json) if pipeline.variant_mapping_json else {}
    pricing = json.loads(pipeline.pricing_json) if pipeline.pricing_json else {}
    weight_g, depth_mm, width_mm, height_mm = _extract_dimensions(pricing)
    offer_id = variant_data.get("variants", [{}])[0].get("seller_sku", f"SRC{source_product_id}")
    # Read the current source snapshot directly, not an old pipeline media
    # mapping. This persistently separates public detail images from SKU rows
    # as the draft is created, so an operator never has to click a repair
    # button just to see/use collected source images.
    common_images=source_public_gallery(
        db,
        source,
        _common_product_images(source, variant_data),
    )
    shop = db.get(Shop, shop_id)
    rich_result = generate_rich_content(
        pipeline.generated_description_ru or "",
        common_images[:5],
        shop_name=shop.name if shop else "",
    )
    rich_value = rich_result["raw_json"]
    raw_source=json.loads(source.raw_json or "{}")
    video=((raw_source.get("video") or {}).get("url") if isinstance(raw_source.get("video"),dict) else None)
    # Check for existing draft
    existing = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.shop_id == shop_id,
        ListingDraftRecord.offer_id == offer_id,
    ))
    if existing:
        draft = existing
    else:
        draft = ListingDraftRecord(
            shop_id=shop_id,
            offer_id=offer_id,
            title=pipeline.generated_title_ru or source.title,
            description=pipeline.generated_description_ru,
            category_id=pipeline.matched_category_id,
            type_id=pipeline.matched_type_id,
            primary_image_url=source.main_image_url,
            status="ready_for_approval",
        )
        db.add(draft)
        db.flush()
    draft.title=pipeline.generated_title_ru or source.title
    draft.description=pipeline.generated_description_ru
    draft.category_id=pipeline.matched_category_id
    draft.type_id=pipeline.matched_type_id
    draft.source_product_id=source.id
    draft.images_json=json.dumps(common_images,ensure_ascii=False)
    draft.primary_image_url=common_images[0] if common_images else source.main_image_url
    draft.video_url=video
    draft.status="ready_for_approval"
    db.query(ListingAttributeValueRecord).filter(ListingAttributeValueRecord.draft_id==draft.id).delete()
    mapping=json.loads(pipeline.attribute_mapping_json or "[]")
    for attr in mapping:
        if str(attr.get("attribute_id")) in {"11254","4191"}:
            continue
        if not attr.get("matched") or (not attr.get("value_id") and not str(attr.get("value_text") or "").strip()):
            continue
        db.add(ListingAttributeValueRecord(draft_id=draft.id,attribute_id=str(attr["attribute_id"]),name=str(attr.get("name") or attr["attribute_id"]),value_id=str(attr.get("value_id")) if attr.get("value_id") else None,value_text=str(attr.get("value_text") or "")))
    # Reuse fields proven by successful ERP listings.
    db.add(ListingAttributeValueRecord(draft_id=draft.id,attribute_id="11254",name="JSON富内容",value_id=None,value_text=rich_value))
    db.add(ListingAttributeValueRecord(draft_id=draft.id,attribute_id="4191",name="简介",value_id=None,value_text=pipeline.generated_description_ru or ""))
    if not any(str(attr.get("attribute_id"))=="23171" and attr.get("matched") for attr in mapping):
        hashtags = generate_product_hashtags(
            pipeline.generated_title_ru or source.title,
            pipeline.generated_description_ru or "",
            "",
        )
        db.add(ListingAttributeValueRecord(draft_id=draft.id,attribute_id="23171",name="#主题标签",value_id=None,value_text=hashtags))
    # Update variants
    db.query(ListingVariantRecord).filter(ListingVariantRecord.draft_id == draft.id).delete()
    for variant_index,var in enumerate(variant_data.get("variants", [])):
        color=_variant_color(db,pipeline,source,var,variant_index)
        var_pricing = next((p for p in pricing.get("variants", []) if p.get("source_sku") == var.get("source_sku")), {})
        db.add(ListingVariantRecord(
            draft_id=draft.id,
            seller_sku=var["seller_sku"],
            purchase_cost_cny=var.get("price_cny"),
            weight_g=weight_g,
            length_mm=depth_mm,
            width_mm=width_mm,
            height_mm=height_mm,
            calculated_price_cny=var_pricing.get("price_cny"),
            price_cny=var_pricing.get("price_cny"),
            min_price_cny=str(var_pricing.get("min_price_cny", "")),
            old_price_cny=var_pricing.get("old_price_cny"),
            image_url=var.get("image_url"),
            name_ru=color["name_ru"],
            variant_values_json=json.dumps({"商品颜色":color["value_text"],"颜色名称":color["name_ru"],"__ids__":{"商品颜色":[color["value_id"]]}},ensure_ascii=False),
        ))
    pipeline.listing_draft_id = draft.id
    if previous_stage not in {"approved","published"}:
        pipeline.pipeline_stage = "draft_created"
    db.commit()
    db.refresh(draft)
    return draft


def approve_for_publish(
    db: Session,
    shop_id: int,
    source_product_id: int,
    approver_id: str,
) -> PipelineProductRecord:
    """Record an approval decision with full audit trail."""
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found")
    if pipeline.listing_draft_id is None:
        raise ValueError("listing draft must be created before approval")
    pipeline.publish_status = "approved"
    pipeline.pipeline_stage = "approved"
    db.add(AuditEventRecord(
        shop_id=shop_id,
        actor_id=approver_id,
        action="pipeline_product_approved",
        entity_type="pipeline_product",
        entity_id=str(source_product_id),
        details_json=json.dumps({
            "listing_draft_id": pipeline.listing_draft_id,
            "quality_score": float(pipeline.quality_score) if pipeline.quality_score else None,
        }, ensure_ascii=False),
    ))
    db.commit()
    db.refresh(pipeline)
    return pipeline


def submit_to_ozon(
    db: Session,
    shop_id: int,
    source_product_id: int,
    approver_id: str,
) -> dict[str, Any]:
    """Submit an approved product to Ozon /v3/product/import.

    This is the ONLY stage that performs an Ozon write.  It is guarded by
    the approval check and produces an audit event.
    """
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found")
    if pipeline.publish_status != "approved":
        raise ValueError("product must be approved before submission")

    # Build the import payload from pipeline data, then make captured 1688
    # images durable before Ozon's servers attempt to download them.
    payload = build_import_payload(db, shop_id, source_product_id)
    if not payload["items"]:
        raise ValueError("no items to import; pipeline data may be incomplete")

    try:
        image_audit = _materialize_submission_images(db, shop_id, source_product_id, payload)
    except ValueError as exc:
        db.add(AuditEventRecord(
            shop_id=shop_id,
            actor_id=approver_id,
            action="pipeline_product_submit_preflight_failed",
            entity_type="pipeline_product",
            entity_id=str(source_product_id),
            details_json=json.dumps({"error": str(exc), "image_audit": {"invalid_count": 1}}, ensure_ascii=False),
        ))
        db.commit()
        return {"status": "failed", "error": str(exc), "error_type": "ImagePreflightError"}

    # Call the real Ozon API
    try:
        client_id, api_key = _credentials(db, shop_id)
    except SyncConfigurationError as exc:
        raise ValueError(f"无法获取店铺授权: {exc}") from exc

    try:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            response = client.create_products(items=payload["items"])
    except OzonSellerError as exc:
        # Record the failure in audit, keep status at approved for retry
        db.add(AuditEventRecord(
            shop_id=shop_id,
            actor_id=approver_id,
            action="pipeline_product_submit_failed",
            entity_type="pipeline_product",
            entity_id=str(source_product_id),
            details_json=json.dumps({
                "error": str(exc)[:2000],
                "error_type": type(exc).__name__,
                "image_audit": {
                    "public_count": image_audit.get("public_count", 0),
                    "sku_count": image_audit.get("sku_count", 0),
                    "invalid_count": image_audit.get("invalid_count", 0),
                    "mirrored_count": image_audit.get("mirrored_count", 0),
                },
            }, ensure_ascii=False),
        ))
        db.commit()
        return {
            "status": "failed",
            "error": str(exc),
            "error_type": type(exc).__name__,
        }

    # Extract the real task_id from Ozon's response
    result = response.get("result", {}) if isinstance(response, dict) else {}
    task_id = str(result.get("task_id", "")) if result else ""

    if not task_id:
        # Ozon returned a response without a task_id -- unusual but handle it
        task_id = str(uuid.uuid4())

    pipeline.task_id = task_id
    pipeline.publish_status = "submitted"
    pipeline.pipeline_stage = "published"
    db.add(AuditEventRecord(
        shop_id=shop_id,
        actor_id=approver_id,
        action="pipeline_product_submitted",
        entity_type="pipeline_product",
        entity_id=str(source_product_id),
        details_json=json.dumps({
            "task_id": task_id,
            "listing_draft_id": pipeline.listing_draft_id,
            "item_count": len(payload["items"]),
            "image_audit": {
                "public_count": image_audit.get("public_count", 0),
                "sku_count": image_audit.get("sku_count", 0),
                "invalid_count": image_audit.get("invalid_count", 0),
                "mirrored_count": image_audit.get("mirrored_count", 0),
                "rich_content_present": any(
                    any(str(attr.get("id")) == "11254" and bool((attr.get("values") or [{}])[0].get("value")) for attr in item.get("attributes") or [])
                    for item in payload["items"]
                ),
            },
        }, ensure_ascii=False),
    ))
    db.commit()
    return {
        "task_id": task_id,
        "status": "submitted",
        "item_count": len(payload["items"]),
    }


def poll_task_status(db: Session, shop_id: int, source_product_id: int) -> dict[str, Any]:
    """Check the status of a submitted product import task via Ozon API."""
    pipeline = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if pipeline is None:
        raise ValueError("pipeline product not found")
    if not pipeline.task_id:
        return {"status": "not_submitted", "message": "product has not been submitted to Ozon"}

    # Call the real Ozon API to poll task status
    try:
        client_id, api_key = _credentials(db, shop_id)
    except SyncConfigurationError as exc:
        return {
            "status": "error",
            "task_id": pipeline.task_id,
            "error": f"无法获取店铺授权: {exc}",
        }

    try:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            response = client.get_import_info(task_id=pipeline.task_id)
    except OzonSellerError as exc:
        return {
            "status": "error",
            "task_id": pipeline.task_id,
            "error": str(exc),
            "error_type": type(exc).__name__,
        }

    # Parse Ozon's import-info response
    result = response.get("result", {}) if isinstance(response, dict) else {}
    items = result.get("items", []) if isinstance(result, dict) else []

    # Determine overall status from individual item statuses
    previous_publish_status = pipeline.publish_status
    statuses = [str(item.get("status", "")).lower() for item in items if isinstance(item, dict)]
    if not statuses:
        ozon_status = "pending"
    elif all(s == "imported" for s in statuses):
        ozon_status = "imported"
        pipeline.publish_status = "imported"
    elif any(s == "failed" for s in statuses):
        ozon_status = "failed"
        pipeline.publish_status = "import_failed"
    else:
        ozon_status = "pending"

    # Collect errors if any
    errors = []
    for item in items:
        if isinstance(item, dict) and item.get("errors"):
            errors.append({
                "offer_id": item.get("offer_id"),
                "errors": item["errors"],
            })

    db.commit()
    if pipeline.publish_status != previous_publish_status:
        if pipeline.publish_status == "imported":
            apply_ozon_feedback(
                db, shop_id=shop_id, source_product_id=source_product_id, accepted=True,
                event_key=f"ozon-import:{shop_id}:{pipeline.task_id}:imported:all",
            )
        elif pipeline.publish_status == "import_failed":
            error_text = json.dumps(errors, ensure_ascii=False).lower()
            affected_types: set[str] = set()
            if any(token in error_text for token in ("category", "type_id", "description_category", "类目", "категор")):
                affected_types.add("category")
            if affected_types:
                apply_ozon_feedback(
                    db, shop_id=shop_id, source_product_id=source_product_id,
                    accepted=False, details={"errors": errors}, decision_types=affected_types,
                    event_key=f"ozon-import:{shop_id}:{pipeline.task_id}:failed:{','.join(sorted(affected_types))}",
                )
    error_message = None
    if errors:
        error_message = json.dumps(errors, ensure_ascii=False)
    return {
        "task_id": pipeline.task_id,
        "publish_status": pipeline.publish_status,
        "pipeline_stage": pipeline.pipeline_stage,
        "ozon_status": ozon_status,
        "items": [
            {
                "offer_id": item.get("offer_id"),
                "product_id": item.get("product_id"),
                "status": item.get("status"),
            }
            for item in items if isinstance(item, dict)
        ],
        "errors": errors,
        "error": error_message,
    }
