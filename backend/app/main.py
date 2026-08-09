import hashlib
import os
import time
import httpx
import json
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, or_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import Base, engine, ensure_sqlite_operational_columns, get_db, settings
from . import erp_models  # noqa: F401 - registers persistent operational tables.
from .erp_models import AuditEventRecord, FbsPostingRecord, ListingAttributeValueRecord, ListingDraftRecord, ListingVariantRecord, OzonAttributeCacheRecord, OzonAttributeDictionaryQueryCacheRecord, OzonAttributeDictionaryValueRecord, OzonCategoryCacheRecord, ProductRecord, SyncRun, SyncState, SourceProductRecord
from .models import ApiCredential, Shop
from .schemas import OzonCredentialStatus, OzonCredentialUpsert, ShopCreate, ShopRead, ShopUpdate
from .security import CredentialEncryptionUnavailable, encrypt_secret
from .sync_service import sync_category_cache, sync_fbs_postings, sync_fbs_product_images, sync_products
from .schemas import FbsPostingDetailRead, FbsPostingRead, FbsPostingSyncRequest, ListingDraftCreate, ListingDraftRead, ListingValidationRead, ProductRead, ProductSyncRequest, SyncRunRead, ListingAttributeValueCreate, ListingVariantCreate
from .listing_service import validate_listing_draft
from .auto_sync import AutoSyncShopNotFound, request_auto_sync, run_auto_sync_resource
from .schemas import AutoSyncDecisionRead, AutoSyncRequest
from .listing_metadata_service import get_category_attributes, search_category_attribute_values
from .pipeline.routes import router as pipeline_router, ext_router as pipeline_ext_router
from .ai_service import translate_text, suggest_attribute_value, generate_description, generate_rich_content, match_category_with_ai, _chat
from .auto_fill_service import auto_fill_attributes
from .pipeline.fact_extraction import ProductFacts, extract_facts
from .pipeline.category_matching import recall_categories, rerank_categories
from .erp_models import SourceProductRecord, SourceVariantRecord, SourceMediaRecord
from .models import Warehouse
from .erp_models import CategoryMatchHistoryRecord

import hashlib
import time as _time

if settings.database_url.startswith("sqlite"):
    Base.metadata.create_all(bind=engine)
    ensure_sqlite_operational_columns()

app = FastAPI(title="Ozon ERP API", version="0.1.0")


# ── Debug error logging ──
_DEBUG_LOG_FILE = os.path.join(os.path.dirname(__file__), "save_errors.log")

@app.exception_handler(Exception)
async def _log_all_errors(request: Request, exc: Exception):
    err_detail = str(exc)
    if hasattr(exc, "errors"):
        try:
            err_detail = str(exc.errors())
        except Exception:
            pass
    log_line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {request.method} {request.url.path} -> {type(exc).__name__}: {err_detail}\n"
    try:
        with open(_DEBUG_LOG_FILE, "a", encoding="utf-8") as lf:
            lf.write(log_line)
            lf.write(_traceback.format_exc())
            lf.write("\n---\n")
    except Exception:
        pass
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    if hasattr(exc, "errors"):
        return JSONResponse(status_code=422, content={"detail": str(exc.errors())})
    return JSONResponse(status_code=500, content={"detail": err_detail})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipeline_router)
app.include_router(pipeline_ext_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}




@app.post("/api/v1/shops", response_model=ShopRead, status_code=status.HTTP_201_CREATED)
def create_shop(payload: ShopCreate, db: Session = Depends(get_db)) -> Shop:
    shop = Shop(**payload.model_dump())
    db.add(shop)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Shop name already exists") from exc
    db.refresh(shop)
    return shop


@app.get("/api/v1/shops", response_model=list[ShopRead])
def list_shops(db: Session = Depends(get_db)) -> list[Shop]:
    return list(db.scalars(select(Shop).order_by(Shop.id)))


@app.get("/api/v1/shops/{shop_id}", response_model=ShopRead)
def get_shop(shop_id: int, db: Session = Depends(get_db)) -> Shop:
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=404, detail="Shop not found")
    return shop


@app.patch("/api/v1/shops/{shop_id}", response_model=ShopRead)
def update_shop(shop_id: int, payload: ShopUpdate, db: Session = Depends(get_db)) -> Shop:
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=404, detail="Shop not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(shop, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Shop name already exists") from exc
    db.refresh(shop)
    return shop


@app.delete("/api/v1/shops/{shop_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shop(shop_id: int, db: Session = Depends(get_db)) -> Response:
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=404, detail="Shop not found")
    has_business_data = any(
        db.scalar(select(model.id).where(model.shop_id == shop_id).limit(1)) is not None
        for model in (ProductRecord, FbsPostingRecord, AuditEventRecord)
    )
    if has_business_data:
        raise HTTPException(status_code=409, detail="店铺已有业务数据，请先停用，不可删除")
    db.query(SyncState).filter(SyncState.shop_id == shop_id).delete()
    db.query(SyncRun).filter(SyncRun.shop_id == shop_id).delete()
    db.query(OzonAttributeDictionaryQueryCacheRecord).filter(OzonAttributeDictionaryQueryCacheRecord.shop_id == shop_id).delete()
    db.query(OzonAttributeDictionaryValueRecord).filter(OzonAttributeDictionaryValueRecord.shop_id == shop_id).delete()
    db.query(OzonAttributeCacheRecord).filter(OzonAttributeCacheRecord.shop_id == shop_id).delete()
    db.query(OzonCategoryCacheRecord).filter(OzonCategoryCacheRecord.shop_id == shop_id).delete()
    db.delete(shop)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.put("/api/v1/shops/{shop_id}/credentials/ozon", response_model=OzonCredentialStatus)
def upsert_ozon_credential(
    shop_id: int, payload: OzonCredentialUpsert, db: Session = Depends(get_db)
) -> ApiCredential:
    """Save Ozon Seller Client-Id + Api-Key encrypted at rest; never returns Api-Key."""
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="Shop not found")
    try:
        encrypted_key = encrypt_secret(payload.api_key.get_secret_value())
    except CredentialEncryptionUnavailable as exc:
        raise HTTPException(status_code=503, detail="Credential encryption is not configured") from exc
    credential = db.scalar(select(ApiCredential).where(ApiCredential.shop_id == shop_id, ApiCredential.provider == "ozon"))
    if credential is None:
        credential = ApiCredential(shop_id=shop_id, provider="ozon")
        db.add(credential)
    credential.client_id_reference = payload.client_id
    credential.encrypted_secret_placeholder = encrypted_key
    credential.key_identifier = payload.key_label or f"ozon-{shop_id}"
    credential.status = "configured"
    db.commit()
    db.refresh(credential)
    return credential


@app.get("/api/v1/shops/{shop_id}/credentials/ozon", response_model=OzonCredentialStatus)
def get_ozon_credential_status(shop_id: int, db: Session = Depends(get_db)) -> ApiCredential:
    credential = db.scalar(select(ApiCredential).where(ApiCredential.shop_id == shop_id, ApiCredential.provider == "ozon"))
    if credential is None:
        raise HTTPException(status_code=404, detail="Ozon credential is not configured")
    return credential


@app.post("/api/v1/shops/{shop_id}/sync/products", response_model=SyncRunRead)
def run_product_sync(shop_id: int, payload: ProductSyncRequest, db: Session = Depends(get_db)):
    return sync_products(db, shop_id, limit=payload.limit, last_id=payload.last_id)


@app.post("/api/v1/shops/{shop_id}/sync/fbs-postings", response_model=SyncRunRead)
def run_fbs_posting_sync(shop_id: int, payload: FbsPostingSyncRequest, db: Session = Depends(get_db)):
    return sync_fbs_postings(db, shop_id, since=payload.since, to=payload.to, limit=payload.limit, offset=payload.offset, status=payload.status)


@app.post("/api/v1/shops/{shop_id}/sync/fbs-product-images", response_model=SyncRunRead)
def run_fbs_product_image_sync(shop_id: int, db: Session = Depends(get_db)):
    return sync_fbs_product_images(db, shop_id)


@app.get("/api/v1/shops/{shop_id}/sync-runs", response_model=list[SyncRunRead])
def list_sync_runs(shop_id: int, db: Session = Depends(get_db)) -> list[SyncRun]:
    return list(db.scalars(select(SyncRun).where(SyncRun.shop_id == shop_id).order_by(SyncRun.id.desc()).limit(100)))


@app.post(
    "/api/v1/shops/{shop_id}/auto-sync",
    response_model=list[AutoSyncDecisionRead],
    status_code=status.HTTP_202_ACCEPTED,
)
def auto_sync_shop_view(
    shop_id: int,
    payload: AutoSyncRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> list[dict[str, str | None]]:
    try:
        decisions = request_auto_sync(db, shop_id, payload.view)
    except AutoSyncShopNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    for decision in decisions:
        if decision["status"] == "started" and decision["lease_owner"]:
            background_tasks.add_task(run_auto_sync_resource, shop_id, decision["resource"], decision["lease_owner"])
    return decisions


@app.get("/api/v1/shops/{shop_id}/products", response_model=list[ProductRead])
def list_products(shop_id: int, db: Session = Depends(get_db)) -> list[ProductRecord]:
    return list(db.scalars(select(ProductRecord).where(ProductRecord.shop_id == shop_id).order_by(ProductRecord.updated_at.desc()).limit(500)))


@app.get("/api/v1/shops/{shop_id}/fbs-postings", response_model=list[FbsPostingRead])
def list_fbs_postings(shop_id: int, status_filter: str | None = None, db: Session = Depends(get_db)) -> list[FbsPostingRecord]:
    statement = select(FbsPostingRecord).where(FbsPostingRecord.shop_id == shop_id)
    if status_filter:
        statement = statement.where(FbsPostingRecord.normalized_status == status_filter)
    return list(db.scalars(statement.order_by(FbsPostingRecord.pack_by.asc().nulls_last(), FbsPostingRecord.id.desc()).limit(500)))


@app.get("/api/v1/shops/{shop_id}/fbs-postings/{posting_id}", response_model=FbsPostingDetailRead)
def get_fbs_posting(shop_id: int, posting_id: int, db: Session = Depends(get_db)) -> FbsPostingRecord:
    posting = db.scalar(select(FbsPostingRecord).where(FbsPostingRecord.id == posting_id, FbsPostingRecord.shop_id == shop_id))
    if posting is None:
        raise HTTPException(status_code=404, detail="FBS order not found")
    return posting


@app.get("/api/v1/shops/{shop_id}/listing-drafts", response_model=list[ListingDraftRead])
def list_listing_drafts(shop_id: int, db: Session = Depends(get_db)) -> list[ListingDraftRecord]:
    return list(db.scalars(select(ListingDraftRecord).where(ListingDraftRecord.shop_id == shop_id).order_by(ListingDraftRecord.id.desc()).limit(500)))


@app.post("/api/v1/shops/{shop_id}/listing-drafts", response_model=ListingDraftRead, status_code=status.HTTP_201_CREATED)
def create_listing_draft(shop_id: int, payload: ListingDraftCreate, db: Session = Depends(get_db)) -> ListingDraftRecord:
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")
    if payload.category_id and payload.type_id and db.scalar(select(OzonCategoryCacheRecord.id).where(OzonCategoryCacheRecord.shop_id == shop_id, OzonCategoryCacheRecord.category_id == payload.category_id, OzonCategoryCacheRecord.type_id == payload.type_id)) is None:
        raise HTTPException(status_code=422, detail="所选 Ozon 类目不属于当前店铺，请重新选择")
    templates = {row.attribute_id: row for row in db.scalars(select(OzonAttributeCacheRecord).where(OzonAttributeCacheRecord.shop_id == shop_id, OzonAttributeCacheRecord.category_id == payload.category_id, OzonAttributeCacheRecord.type_id == payload.type_id))} if payload.category_id and payload.type_id else {}
    draft = ListingDraftRecord(shop_id=shop_id, offer_id=payload.offer_id, title=payload.title, description=payload.description, category_id=payload.category_id, type_id=payload.type_id, primary_image_url=payload.primary_image_url, images_json=json.dumps(payload.images, ensure_ascii=False) if payload.images else None, source_product_id=payload.source_product_id)
    attribute_records = []
    for attribute in payload.attributes:
        template = templates.get(attribute.attribute_id)
        if template is None:
            raise HTTPException(status_code=422, detail=f"属性 {attribute.attribute_id} 不属于当前店铺所选类目")
        value_text = attribute.value_text
        value_id = attribute.value_id
        # For dictionary attributes: try to resolve value_id from cache, but don't block save
        if template.dictionary_id and value_id:
            cached_value = db.scalar(select(OzonAttributeDictionaryValueRecord).where(OzonAttributeDictionaryValueRecord.shop_id == shop_id, OzonAttributeDictionaryValueRecord.category_id == payload.category_id, OzonAttributeDictionaryValueRecord.type_id == payload.type_id, OzonAttributeDictionaryValueRecord.attribute_id == attribute.attribute_id, OzonAttributeDictionaryValueRecord.value_id == value_id))
            if cached_value:
                value_text = cached_value.value
            # If not found in cache, still save with provided values (validate later)
        attribute_records.append(ListingAttributeValueRecord(attribute_id=attribute.attribute_id, name=template.name, value_id=value_id, value_text=value_text))
    draft.attribute_values.extend(attribute_records)
    for variant in payload.variants:
        draft.variants.append(ListingVariantRecord(**variant.model_dump()))
    db.add(draft)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该店铺已存在相同 Offer ID 的上架草稿") from exc
    db.refresh(draft)
    return draft


@app.post("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}/validate", response_model=ListingValidationRead)
def validate_listing(shop_id: int, draft_id: int, db: Session = Depends(get_db)) -> dict:
    draft = db.scalar(select(ListingDraftRecord).where(ListingDraftRecord.id == draft_id, ListingDraftRecord.shop_id == shop_id))
    if draft is None:
        raise HTTPException(status_code=404, detail="上架草稿不存在")
    issues = validate_listing_draft(db, draft)
    return {"draft_id": draft.id, "status": draft.status, "issues": issues}

def _build_price_obj(variant) -> dict:
    """Build Ozon price object; omit old_price if not set."""
    price_val = str(variant.price_cny or variant.calculated_price_cny or "0")
    price_obj = {
        "price": price_val,
        "min_price": str(variant.min_price_cny or "0"),
        "vat": "0",
    }
    if variant.old_price_cny is not None:
        price_obj["old_price"] = str(variant.old_price_cny)
    return price_obj


@app.post("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}/submit")
def submit_listing_to_ozon(shop_id: int, draft_id: int, db: Session = Depends(get_db)) -> dict:
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient

    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.id == draft_id,
        ListingDraftRecord.shop_id == shop_id,
    ))
    if draft is None:
        raise HTTPException(status_code=404, detail="上架草稿不存在")

    issues = validate_listing_draft(db, draft)
    if issues:
        raise HTTPException(status_code=422, detail="; ".join(i["message"] for i in issues[:5]))

    images = []
    if draft.images_json:
        try:
            images = json.loads(draft.images_json)
        except Exception:
            pass
    if not images and draft.primary_image_url:
        images = [draft.primary_image_url]

    # Upload localhost images to OSS for public access
    _has_local = any("127.0.0.1" in u or "localhost" in u for u in images)
    if _has_local:
        try:
            from .oss_upload import get_bucket, upload_bytes
            import hashlib as _hl
            _bucket = get_bucket()
            _date = time.strftime("%Y%m%d")
            _new_images = []
            for _url in images:
                if "127.0.0.1" in _url or "localhost" in _url:
                    try:
                        _parts = _url.split("/translated/", 1)
                        if len(_parts) == 2:
                            _local = os.path.join(
                                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "frontend", "translated", _parts[1]
                            )
                            if os.path.exists(_local):
                                with open(_local, "rb") as _f:
                                    _bytes = _f.read()
                                _digest = _hl.sha256(_bytes).hexdigest()[:24]
                                _key = f"ozon-erp/images/{_date}/{_digest}.jpg"
                                _oss_url = upload_bytes(_bytes, _key, content_type="image/jpeg", verify=True, bucket=_bucket)
                                _new_images.append(_oss_url)
                            else:
                                _new_images.append(_url)
                        else:
                            _new_images.append(_url)
                    except Exception:
                        _new_images.append(_url)
                else:
                    _new_images.append(_url)
            images = _new_images
        except Exception:
            pass  # fallback: keep original URLs

    attr_cache = {}
    if draft.category_id and draft.type_id:
        for row in db.scalars(select(OzonAttributeCacheRecord).where(
            OzonAttributeCacheRecord.shop_id == shop_id,
            OzonAttributeCacheRecord.category_id == draft.category_id,
            OzonAttributeCacheRecord.type_id == draft.type_id,
        )):
            attr_cache[row.name] = row

    # Build set of is_aspect attribute IDs to exclude from product-level attrs
    variant_attr_ids = set()
    for row in attr_cache.values():
        if row.is_aspect:
            variant_attr_ids.add(row.attribute_id)

    product_attrs = []
    for av in draft.attribute_values:
        if not av.value_text:
            continue
        # Skip variant-level (is_aspect) attributes - they go in item_attrs only
        if av.attribute_id in variant_attr_ids:
            continue
        attr_obj = {"complex_id": 0, "id": int(av.attribute_id) if av.attribute_id.isdigit() else 0}
        val_obj = {"value": av.value_text}
        # Only add dictionary_value_id for valid integer value_ids (not "None", empty, etc.)
        raw_vid = str(av.value_id).strip() if av.value_id is not None else ""
        if raw_vid and raw_vid not in ("None", "none", "null", "0", ""):
            try:
                val_obj["dictionary_value_id"] = int(raw_vid)
            except (ValueError, TypeError):
                pass  # Skip invalid value_id - don't add dictionary_value_id
        attr_obj["values"] = [val_obj]
        product_attrs.append(attr_obj)

    items = []
    for variant in draft.variants:
        item_attrs = list(product_attrs)
        if variant.variant_values_json:
            try:
                vv = json.loads(variant.variant_values_json)
                for attr_name, attr_value in vv.items():
                    if not attr_value:
                        continue
                    cached = attr_cache.get(attr_name)
                    if not cached:
                        continue
                    va = {"complex_id": int(cached.complex_id) if cached.complex_id and cached.complex_id.isdigit() else 0, "id": int(cached.attribute_id)}
                    val_obj = {"value": str(attr_value)}
                    if cached.dictionary_id:
                        dict_val = db.scalar(select(OzonAttributeDictionaryValueRecord).where(
                            OzonAttributeDictionaryValueRecord.shop_id == shop_id,
                            OzonAttributeDictionaryValueRecord.category_id == draft.category_id,
                            OzonAttributeDictionaryValueRecord.type_id == draft.type_id,
                            OzonAttributeDictionaryValueRecord.attribute_id == cached.attribute_id,
                            OzonAttributeDictionaryValueRecord.value == str(attr_value),
                        ))
                        if dict_val:
                            try:
                                val_obj["dictionary_value_id"] = int(dict_val.value_id)
                            except (ValueError, TypeError):
                                val_obj["dictionary_value_id"] = dict_val.value_id
                    va["values"] = [val_obj]
                    item_attrs.append(va)
            except Exception:
                pass

        _price = str(variant.price_cny or variant.calculated_price_cny or "0")
        _old_price_raw = str(variant.old_price_cny).strip() if variant.old_price_cny else ""
        _old_price = _old_price_raw if _old_price_raw and _old_price_raw not in ("0", "0.0", "0.00", "None") else ""
        _min_price = str(variant.min_price_cny or "0")
        item = {
            "offer_id": variant.seller_sku,
            "name": draft.title,
            "description_category_id": int(draft.category_id) if draft.category_id else 0,
            "type_id": int(draft.type_id) if draft.type_id else 0,
            "price": _price,
            "min_price": _min_price,
            "vat": "0",
            "weight": int(variant.weight_g or 0),
            "weight_unit": "g",
            "length": int(variant.length_mm or 0),
            "width": int(variant.width_mm or 0),
            "height": int(variant.height_mm or 0),
            "depth": int(variant.height_mm or 0),
            "images": images[:15],
            "description": draft.description or "",
            "attributes": item_attrs,
        }
        if _old_price:
            item["old_price"] = _old_price
        if variant.barcode:
            item["barcode"] = variant.barcode
        items.append(item)

    client_id, api_key = _credentials(db, shop_id)
    try:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            result = client.create_products(items=items)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ozon API error: {exc}")

    draft.status = "submitted"
    db.commit()

    task_id = result.get("result", {}).get("task_id", "")
    return {
        "ok": True,
        "task_id": task_id,
        "items_submitted": len(items),
        "message": f"submitted {len(items)} variants, task_id: {task_id}" if task_id else "done",
    }


class ImageTranslateRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=20)
    source_lang: str = Field(default="CHS")
    target_lang: str = Field(default="RUS")


@app.post("/api/v1/image/translate")
def translate_images(payload: ImageTranslateRequest) -> dict:
    """Translate images via Xiangji (象寄) batch image translation API."""
    import os
    private_key = os.environ.get("XIANGJI_PRIVATE_KEY", "")
    img_trans_key = os.environ.get("XIANGJI_IMG_TRANS_KEY", "")
    if not private_key or not img_trans_key:
        raise HTTPException(status_code=500, detail="象寄 API 密钥未配置")

    commit_time = str(int(time.time()))
    sign_str = f"{commit_time}_{private_key}_{img_trans_key}"
    sign = hashlib.md5(sign_str.encode()).hexdigest().lower()

    # URL-encode each image URL, then join with commas
    from urllib.parse import quote
    urls_param = ",".join(quote(u, safe="") for u in payload.urls)

    data = {
        "Action": "GetImageTranslateBatch",
        "SourceLanguage": payload.source_lang,
        "TargetLanguage": payload.target_lang,
        "Urls": urls_param,
        "ImgTransKey": img_trans_key,
        "CommitTime": commit_time,
        "Sign": sign,
        "Sync": "1",
        "NeedWatermark": "0",
        "Qos": "BestQuality",
    }

    try:
        resp = httpx.post(
            "https://api.xiangjifanyi.com/",
            data=data,
            timeout=120.0,
        )
        result = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"象寄 API 请求失败: {exc}")

    if result.get("Code") not in (200, 0, "200", "0"):
        raise HTTPException(status_code=502, detail=f"象寄 API 错误: {result.get('Message', result)}")

    # Parse translated URLs from response
    translated = []
    data_field = result.get("Data") or result.get("data") or {}
    if isinstance(data_field, list):
        for item in data_field:
            if isinstance(item, dict):
                translated.append(item.get("transUrl") or item.get("trans_url") or item.get("url", ""))
            elif isinstance(item, str):
                translated.append(item)
    elif isinstance(data_field, dict):
        for item in data_field.get("list", data_field.get("List", [])):
            if isinstance(item, dict):
                translated.append(item.get("transUrl") or item.get("trans_url") or item.get("url", ""))

    return {"ok": True, "translated": translated, "raw": result}


@app.post("/api/v1/image/translate-tencent")
def translate_images_tencent(payload: ImageTranslateRequest) -> dict:
    """Translate images via Tencent Cloud ImageTranslateLLM API.
    Downloads images, sends as Base64. Returns saved image URLs.
    Rate limit: 1 req/sec, so we add a delay between calls.
    """
    import os
    import base64
    import time as _time
    secret_id = os.environ.get("TENCENT_SECRET_ID", "")
    secret_key = os.environ.get("TENCENT_SECRET_KEY", "")
    if not secret_id or not secret_key:
        raise HTTPException(status_code=500, detail="腾讯云密钥未配置")

    try:
        from tencentcloud.common import credential as tc_cred
        from tencentcloud.tmt.v20180321 import tmt_client, models as tmt_models
    except ImportError:
        raise HTTPException(status_code=500, detail="tencentcloud-sdk-python-tmt 未安装")

    cred = tc_cred.Credential(secret_id, secret_key)
    client = tmt_client.TmtClient(cred, "ap-beijing")

    translated_urls = []
    errors = []

    for i, img_url in enumerate(payload.urls):
        if i > 0:
            _time.sleep(1.1)
        try:
            # Download image and convert to Base64
            dl_resp = httpx.get(img_url, timeout=30.0, follow_redirects=True)
            if dl_resp.status_code != 200:
                errors.append(f"image {i}: download failed ({dl_resp.status_code})")
                continue
            img_b64 = base64.b64encode(dl_resp.content).decode("utf-8")

            req = tmt_models.ImageTranslateLLMRequest()
            req.Data = img_b64
            req.Target = payload.target_lang.lower()
            req.Mode = 1  # lite version

            resp = client.ImageTranslateLLM(req)

            if resp.Data:
                out_bytes = base64.b64decode(resp.Data)
                filename = f"trans_{int(_time.time()*1000)}_{i}.jpg"
                save_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "frontend", "translated")
                save_dir = os.path.abspath(save_dir)
                os.makedirs(save_dir, exist_ok=True)
                filepath = os.path.join(save_dir, filename)
                with open(filepath, "wb") as f:
                    f.write(out_bytes)
                translated_urls.append(f"http://127.0.0.1:5500/translated/{filename}")
            else:
                errors.append(f"image {i}: empty response")
        except Exception as exc:
            errors.append(f"image {i}: {str(exc)}")

    # Save translations to cache directly (do not rely on frontend POST)
    if translated_urls:
        try:
            cache = _load_translation_cache()
            for i, t_url in enumerate(translated_urls):
                if i < len(payload.urls) and t_url:
                    cache[payload.urls[i]] = t_url
            _save_translation_cache(cache)
        except Exception:
            pass

    return {
        "ok": len(translated_urls) > 0,
        "translated": translated_urls,
        "errors": errors,
        "count": len(translated_urls),
    }





# ── Image translation cache (persists original→translated URL mapping) ──
_TRANSLATION_CACHE_FILE = os.path.join(os.path.dirname(__file__), "translation_cache.json")


def _load_translation_cache() -> dict:
    if os.path.exists(_TRANSLATION_CACHE_FILE):
        try:
            with open(_TRANSLATION_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_translation_cache(cache: dict) -> None:
    try:
        with open(_TRANSLATION_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


@app.get("/api/v1/image/translation-cache")
def get_translation_cache() -> dict:
    """Return all cached original→translated image URL mappings."""
    return {"cache": _load_translation_cache()}


@app.post("/api/v1/image/translation-cache")
def add_translation_cache(payload: dict) -> dict:
    """Add entries to the translation cache. Body: {"mappings": {"orig_url": "translated_url"}}"""
    mappings = payload.get("mappings", {})
    if not mappings:
        raise HTTPException(status_code=422, detail="mappings is required")
    cache = _load_translation_cache()
    for k, v in mappings.items():
        if k and v:
            cache[k] = v
    _save_translation_cache(cache)
    return {"ok": True, "count": len(cache)}


# Apply translation cache to source product images
@app.get("/api/v1/image/translation-cache/apply")
def apply_translation_cache(urls: str = Query(default="")) -> dict:
    """Given comma-separated URLs, return translated URLs where cached."""
    cache = _load_translation_cache()
    url_list = [u.strip() for u in urls.split(",") if u.strip()]
    result = {}
    for u in url_list:
        if u in cache:
            result[u] = cache[u]
    return {"translations": result}
@app.post("/api/v1/shops/{shop_id}/metadata/categories")
def sync_categories(shop_id: int, db: Session = Depends(get_db)) -> dict[str, int]:
    run = sync_category_cache(db, shop_id)
    if run.status != "succeeded":
        raise HTTPException(status_code=502, detail=run.error_summary or "Ozon 类目同步失败")
    return {"records": run.records_changed}


# ── Collection box (unified source products + drafts view) ──

@app.get("/api/v1/collection-box")
def list_collection_box(shop_id: int = Query(default=0), db: Session = Depends(get_db)) -> list[dict]:
    """Return unified list of collected source products with their listing draft status."""
    # Get source products
    sp_query = select(SourceProductRecord)
    if shop_id:
        sp_query = sp_query.where(SourceProductRecord.shop_id == shop_id)
    sp_query = sp_query.order_by(SourceProductRecord.id.desc()).limit(500)
    source_products = list(db.scalars(sp_query))

    # Get all drafts indexed by source_product_id
    drafts_by_sp = {}
    drafts = list(db.scalars(select(ListingDraftRecord).order_by(ListingDraftRecord.id.desc())))
    for d in drafts:
        if d.source_product_id and d.source_product_id not in drafts_by_sp:
            drafts_by_sp[d.source_product_id] = d

    # Get shop names
    shops = {s.id: s.name for s in db.scalars(select(Shop))}

    result = []
    for sp in source_products:
        draft = drafts_by_sp.get(sp.id)
        # Determine status
        if not draft:
            status = "未编辑"
        elif draft.status == "submitted":
            status = "已提交"
        elif draft.status in ("validation_failed", "ready_for_approval"):
            status = "待修改"
        else:
            status = "保存"

        result.append({
            "source_product_id": sp.id,
            "title": sp.title or "",
            "source_platform": sp.source_platform or "",
            "shop_id": sp.shop_id,
            "shop_name": shops.get(sp.shop_id, ""),
            "collected_at": sp.created_at.isoformat() if sp.created_at else "",
            "main_image_url": sp.main_image_url or "",
            "draft_id": draft.id if draft else None,
            "draft_status": status,
            "offer_id": draft.offer_id if draft else "",
            "category_id": draft.category_id if draft else None,
        })
    return result


@app.get("/api/v1/shops/{shop_id}/import-info/{task_id}")
def check_import_info(shop_id: int, task_id: str, db: Session = Depends(get_db)) -> dict:
    """Check Ozon product import task status."""
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient
    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        result = client.get_import_info(task_id=task_id)
    return result


# ── OSS image upload (replace localhost URLs with public OSS URLs) ──

class OssUploadRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=50)


@app.post("/api/v1/image/upload-to-oss")
def upload_images_to_oss(payload: OssUploadRequest) -> dict:
    """Upload localhost image URLs to Aliyun OSS and return public URLs.

    For URLs that are already public (not localhost), they are returned as-is.
    For localhost URLs (127.0.0.1:5500/translated/...), the local file is
    uploaded to OSS and the public URL is returned.
    """
    from .oss_upload import get_bucket, upload_bytes
    import hashlib as _hashlib

    bucket = None
    result = {}
    for url in payload.urls:
        if "127.0.0.1" not in url and "localhost" not in url:
            result[url] = url
            continue
        # Extract local file path from localhost URL
        # URL format: http://127.0.0.1:5500/translated/trans_xxx.jpg
        try:
            parsed = url.split("/translated/", 1)
            if len(parsed) != 2:
                result[url] = url
                continue
            local_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "frontend", "translated", parsed[1]
            )
            if not os.path.exists(local_path):
                result[url] = url
                continue
            with open(local_path, "rb") as fobj:
                img_bytes = fobj.read()
            # Generate OSS object key
            digest = _hashlib.sha256(img_bytes).hexdigest()[:24]
            date_str = time.strftime("%Y%m%d")
            object_key = f"ozon-erp/images/{date_str}/{digest}.jpg"
            if bucket is None:
                bucket = get_bucket()
            oss_url = upload_bytes(img_bytes, object_key, content_type="image/jpeg", verify=True, bucket=bucket)
            result[url] = oss_url
        except Exception as exc:
            result[url] = url  # fallback to original on error

    uploaded_count = sum(1 for k, v in result.items() if k != v)
    return {"mappings": result, "uploaded": uploaded_count}


@app.get("/api/v1/shops/{shop_id}/metadata/categories")
def list_categories(shop_id: int, query: str | None = None, db: Session = Depends(get_db)) -> list[dict[str, str]]:
    statement = select(OzonCategoryCacheRecord).where(OzonCategoryCacheRecord.shop_id == shop_id, OzonCategoryCacheRecord.type_id != "")
    if query:
        q = query[:100]
        statement = statement.where(or_(
            OzonCategoryCacheRecord.title.like(f"%{q}%"),
            OzonCategoryCacheRecord.title_zh.like(f"%{q}%"),
        ))
    rows = db.scalars(statement.order_by(OzonCategoryCacheRecord.title_zh).limit(1000))
    return [{"category_id": row.category_id, "type_id": row.type_id, "title": row.title, "title_zh": row.title_zh or ""} for row in rows]


@app.get("/api/v1/shops/{shop_id}/metadata/categories/{category_id}/types/{type_id}/attributes")
def list_category_attributes(shop_id: int, category_id: int, type_id: int, db: Session = Depends(get_db)) -> list[dict]:
    return get_category_attributes(db, shop_id, str(category_id), str(type_id))


@app.get("/api/v1/shops/{shop_id}/metadata/categories/{category_id}/types/{type_id}/attributes/{attribute_id}/values")
def list_category_attribute_values(shop_id: int, category_id: int, type_id: int, attribute_id: int, query: str = Query(default="", max_length=100), limit: int = Query(default=50, ge=1, le=100), db: Session = Depends(get_db)) -> list[dict]:
    return search_category_attribute_values(db, shop_id, str(category_id), str(type_id), str(attribute_id), query, limit)



# ---------------------------------------------------------------------------
# AI assistance endpoints (DeepSeek)
# ---------------------------------------------------------------------------

class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    target_lang: str = Field(default="ru", max_length=4)
    context: str = Field(default="", max_length=2000)


@app.post("/api/v1/ai/translate")
def ai_translate(payload: TranslateRequest) -> dict:
    try:
        return translate_text(payload.text, target_lang=payload.target_lang, context=payload.context)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class SuggestAttributeRequest(BaseModel):
    attribute_name: str = Field(min_length=1, max_length=500)
    attribute_description: str = Field(default="", max_length=2000)
    product_title: str = Field(min_length=1, max_length=500)
    product_description: str = Field(default="", max_length=10000)
    dictionary_options: list[dict] | None = Field(default=None)


@app.post("/api/v1/ai/suggest-attribute")
def ai_suggest_attribute(payload: SuggestAttributeRequest) -> dict:
    try:
        return suggest_attribute_value(
            payload.attribute_name,
            payload.attribute_description,
            payload.product_title,
            payload.product_description,
            dictionary_options=payload.dictionary_options,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class GenerateDescriptionRequest(BaseModel):
    product_title: str = Field(min_length=1, max_length=500)
    source_description: str = Field(default="", max_length=10000)
    specs: list[dict] | None = Field(default=None)
    target_lang: str = Field(default="ru", max_length=4)


class AutoFillRequest(BaseModel):
    category_id: str = Field(min_length=1)
    type_id: str = Field(min_length=1)
    source_product_id: int | None = Field(default=None)
    offer_id: str = Field(default="")


@app.post("/api/v1/shops/{shop_id}/auto-fill")
def auto_fill_attrs(shop_id: int, payload: AutoFillRequest, db: Session = Depends(get_db)) -> dict:
    """Three-layer funnel auto-fill: hardcoded -> hard match -> AI fallback.
    Returns fillable attribute values with method labels.
    """
    source_product = None
    if payload.source_product_id:
        row = db.scalar(select(SourceProductRecord).where(
            SourceProductRecord.id == payload.source_product_id,
        ))
        if row:
            import json as _json
            raw = row.raw_json
            if isinstance(raw, str):
                try:
                    raw = _json.loads(raw)
                except (ValueError, TypeError):
                    raw = {}
            source_product = {
                "title": row.title,
                "raw_json": raw,
                "variants": raw.get("variants", []) if isinstance(raw, dict) else [],
            }
    results = auto_fill_attributes(
        db, shop_id, payload.category_id, payload.type_id,
        source_product=source_product, offer_id=payload.offer_id,
    )
    # Summary stats
    stats = {"hardcoded": 0, "hard_match": 0, "ai_match": 0, "manual": 0, "skip": 0, "inferred": 0}
    for r in results:
        stats[r["method"]] = stats.get(r["method"], 0) + 1
    return {"results": results, "stats": stats}


@app.post("/api/v1/ai/generate-description")
def ai_generate_description(payload: GenerateDescriptionRequest) -> dict:
    try:
        return generate_description(
            payload.product_title,
            payload.source_description,
            payload.specs,
            target_lang=payload.target_lang,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class GenerateRichContentRequest(BaseModel):
    description: str = Field(default="", max_length=10000)
    image_urls: list[str] = Field(default_factory=list)
    shop_name: str = Field(default="", max_length=200)


@app.post("/api/v1/ai/generate-rich-content")
def ai_generate_rich_content(payload: GenerateRichContentRequest) -> dict:
    try:
        return generate_rich_content(payload.description, payload.image_urls, shop_name=payload.shop_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc



class MatchCategoryRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    material: str = Field(default="", max_length=200)
    brand: str = Field(default="", max_length=200)



# ── FBS Warehouse sync & matching


class WarehouseMatchRequest(BaseModel):
    weight_g: float = Field(gt=0)
    price_cny: float = Field(gt=0)
    length_mm: float = Field(gt=0)
    width_mm: float = Field(gt=0)
    height_mm: float = Field(gt=0)
RMB_SHIPPING_LEVELS = [
    {"name": "Extra Small", "weight_min": 1, "weight_max": 500, "price_min": 0.01, "price_max": 135, "sum_max": 90, "longest_max": 0, "rate_per_kg": 25, "fixed_fee": 3},
    {"name": "Budget", "weight_min": 500, "weight_max": 30000, "price_min": 0.01, "price_max": 135, "sum_max": 150, "longest_max": 80, "rate_per_kg": 17, "fixed_fee": 23},
    {"name": "Small", "weight_min": 1, "weight_max": 2000, "price_min": 135.01, "price_max": 635, "sum_max": 150, "longest_max": 80, "rate_per_kg": 25, "fixed_fee": 16},
    {"name": "Big", "weight_min": 2001, "weight_max": 30000, "price_min": 135.01, "price_max": 635, "sum_max": 250, "longest_max": 150, "rate_per_kg": 17, "fixed_fee": 36},
]


def _match_warehouse_level(weight_g: float, price_cny: float, length_mm: float, width_mm: float, height_mm: float) -> dict | None:
    """Match SKU to a warehouse level based on weight, price, and dimensions.
    Returns the matched level dict or None if no match.
    Multiple matches -> pick lowest shipping fee.
    """
    dims_cm = sorted([length_mm / 10, width_mm / 10, height_mm / 10], reverse=True)
    sum_cm = sum(dims_cm)
    longest_cm = dims_cm[0]
    weight_kg = weight_g / 1000

    candidates = []
    for level in RMB_SHIPPING_LEVELS:
        if not (level["weight_min"] <= weight_g <= level["weight_max"]):
            continue
        if not (level["price_min"] <= price_cny <= level["price_max"]):
            continue
        if sum_cm > level["sum_max"]:
            continue
        if level["longest_max"] > 0 and longest_cm > level["longest_max"]:
            continue
        fee = level["rate_per_kg"] * weight_kg + level["fixed_fee"]
        candidates.append({**level, "shipping_fee_cny": round(fee, 2), "sum_cm": round(sum_cm, 1), "longest_cm": round(longest_cm, 1)})

    if not candidates:
        return None
    return min(candidates, key=lambda c: c["shipping_fee_cny"])


@app.get("/api/v1/shops/{shop_id}/warehouses")
def list_shop_warehouses(shop_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """Fetch and cache FBS warehouses from Ozon API."""
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")
    client_id, api_key = _credentials(db, shop_id)
    try:
        with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
            resp = client.list_warehouses()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ozon API 错误: {exc}")
    warehouses = resp.get("result", [])
    # Cache to DB
    db.query(Warehouse).filter(Warehouse.shop_id == shop_id).delete()
    for wh in warehouses:
        db.add(Warehouse(
            shop_id=shop_id,
            name=wh.get("name", ""),
            pickup_point=wh.get("pickup_point", "") if isinstance(wh.get("pickup_point"), str) else "",
            cutoff_time=str(wh.get("cutoff_time", "")),
            workdays=str(wh.get("workdays", "")),
            carrier=str(wh.get("carrier", "")),
        ))
    db.commit()
    return [{"name": wh.get("name", ""), "carrier": wh.get("carrier", "")} for wh in warehouses]


@app.post("/api/v1/shops/{shop_id}/match-warehouse")
def match_warehouse(shop_id: int, payload: WarehouseMatchRequest, db: Session = Depends(get_db)) -> dict:
    """Match a SKU to the correct warehouse level based on weight, price, dimensions."""
    level = _match_warehouse_level(
        weight_g=payload.weight_g,
        price_cny=payload.price_cny,
        length_mm=payload.length_mm,
        width_mm=payload.width_mm,
        height_mm=payload.height_mm,
    )
    if level is None:
        return {"matched": False, "level": None, "error": "PRICING_SHIPPING_LEVEL_MISSING", "message": "尺重或售价不匹配任何仓库等级"}
    return {"matched": True, "level": level["name"], "shipping_fee_cny": level["shipping_fee_cny"], "details": level}


# ── Offer ID auto-generation ─────────────────────────────────────────────
@app.get("/api/v1/shops/{shop_id}/next-offer-id")
def get_next_offer_id(shop_id: int, db: Session = Depends(get_db)) -> dict:
    """Generate the next sequential offer ID for a shop."""
    shop = db.get(Shop, shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="店铺不存在")
    # Derive prefix from shop name: first 2 alphanumeric chars, uppercase
    raw = shop.name.upper()
    prefix = "".join(c for c in raw if c.isalnum())[:2] or "SK"
    # Find max sequence number from existing offer IDs matching the prefix pattern
    max_num = 0
    all_offer_ids = [r[0] for r in db.execute(select(ListingDraftRecord.offer_id).where(ListingDraftRecord.shop_id == shop_id)).all()]
    all_offer_ids += [r[0] for r in db.execute(select(ProductRecord.offer_id).where(ProductRecord.shop_id == shop_id)).all()]
    for oid in all_offer_ids:
        if oid and oid.startswith(prefix):
            num_part = oid[len(prefix):]
            if num_part.isdigit():
                max_num = max(max_num, int(num_part))
    next_num = max_num + 1
    offer_id = f"{prefix}{next_num:06d}"
    return {"offer_id": offer_id, "prefix": prefix, "sequence": next_num}


# ── Category tree (for manual browsing) ──────────────────────────────────
_category_tree_cache: dict[str, tuple[float, list]] = {}
_CATEGORY_TREE_TTL = 86400  # 24 hours

def _build_category_tree(items: list) -> list[dict]:
    """Transform Ozon nested tree into a simplified structure for the frontend."""
    result = []
    for item in items:
        if not isinstance(item, dict) or item.get("disabled") is True:
            continue
        cat_id = item.get("description_category_id")
        type_id = item.get("type_id")
        if cat_id is not None:
            children = _build_category_tree(item.get("children", []))
            result.append({
                "id": str(cat_id),
                "name": item.get("category_name", ""),
                "type": "category",
                "children": children,
                "children_count": len(children),
            })
        elif type_id is not None:
            result.append({
                "id": str(type_id),
                "category_id": str(item.get("description_category_id", "")),
                "name": item.get("type_name", ""),
                "type": "type",
            })
    return result


@app.get("/api/v1/shops/{shop_id}/metadata/category-tree")
def get_category_tree_endpoint(shop_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """Return the Ozon category tree (Chinese) for manual drill-down browsing.
    Cached in memory for 24 hours."""
    cache_key = str(shop_id)
    cached = _category_tree_cache.get(cache_key)
    if cached and (_time.time() - cached[0]) < _CATEGORY_TREE_TTL:
        return cached[1]

    from .sync_service import _credentials, SyncConfigurationError
    try:
        client_id, api_key = _credentials(db, shop_id)
    except SyncConfigurationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    from .integrations.ozon_seller import OzonSellerClient
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        response = client.get_category_tree("ZH_HANS")
    tree = _build_category_tree(response.get("result", []))
    _category_tree_cache[cache_key] = (_time.time(), tree)
    return tree


# ── Category match history ──────────────────────────────────────────────
class CategoryMatchHistoryRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    category_id: str = Field(min_length=1, max_length=64)
    type_id: str = Field(min_length=1, max_length=64)
    category_title_zh: str = Field(default="", max_length=500)
    source: str = Field(default="manual", max_length=20)


def _extract_title_keywords(title: str) -> str:
    """Extract meaningful keywords from a Chinese product title for matching."""
    import re as _re
    suffixes = ["包", "鞋", "衣", "裤", "裙", "帽", "表", "灯", "杯", "壳", "架", "盒",
                "箱", "袋", "垫", "毯", "枕", "碗", "盘", "壶", "锅", "刀", "剪",
                "链", "绳", "带", "扣", "环", "钩", "管", "棒", "板", "贴", "膜",
                "器", "机", "线", "充", "耳", "玩具", "收纳", "整理", "装饰",
                "配件", "套装", "工具", "仪器", "模具"]
    keywords = set()
    for suffix in suffixes:
        idx = title.rfind(suffix)
        if idx >= 0:
            start = max(0, idx - 4)
            keywords.add(title[start:idx + len(suffix)])
            keywords.add(suffix)
    parts = _re.split(r"[\s,，、/\\[\]\(\)（）【】]+", title)
    for part in parts:
        part = part.strip()
        if 2 <= len(part) <= 8:
            keywords.add(part)
    keywords = {k for k in keywords if 1 <= len(k) <= 8}
    return " ".join(sorted(keywords, key=len, reverse=True))


@app.post("/api/v1/shops/{shop_id}/category-match-history")
def save_category_match_history(shop_id: int, payload: CategoryMatchHistoryRequest, db: Session = Depends(get_db)) -> dict:
    """Save a category selection so future similar titles can auto-match."""
    keywords = _extract_title_keywords(payload.title)
    title_hash = hashlib.md5(keywords.encode("utf-8")).hexdigest()

    existing = db.scalar(select(CategoryMatchHistoryRecord).where(
        CategoryMatchHistoryRecord.shop_id == shop_id,
        CategoryMatchHistoryRecord.title_hash == title_hash,
    ))
    if existing:
        existing.hit_count += 1
        existing.category_id = payload.category_id
        existing.type_id = payload.type_id
        existing.category_title_zh = payload.category_title_zh
        existing.title = payload.title
        existing.title_keywords = keywords
        existing.source = payload.source
    else:
        db.add(CategoryMatchHistoryRecord(
            shop_id=shop_id,
            title=payload.title,
            title_keywords=keywords,
            title_hash=title_hash,
            category_id=payload.category_id,
            type_id=payload.type_id,
            category_title_zh=payload.category_title_zh,
            source=payload.source,
        ))
    db.commit()
    return {"status": "ok", "keywords": keywords, "hit_count": (existing.hit_count if existing else 1)}


@app.get("/api/v1/shops/{shop_id}/category-match-history")
def list_category_match_history(shop_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """List recent category match history entries."""
    rows = db.scalars(select(CategoryMatchHistoryRecord).where(
        CategoryMatchHistoryRecord.shop_id == shop_id,
    ).order_by(CategoryMatchHistoryRecord.updated_at.desc()).limit(100))
    return [{"title": r.title, "keywords": r.title_keywords, "category_id": r.category_id,
             "type_id": r.type_id, "category_title_zh": r.category_title_zh,
             "source": r.source, "hit_count": r.hit_count} for r in rows]


class HashtagRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=5000)
    category_zh: str = Field(default="", max_length=200)


@app.post("/api/v1/ai/generate-hashtags")
def generate_hashtags(payload: HashtagRequest) -> dict:
    """Generate 30 Russian search hashtags for a product.
    Rules: 1-2 words each, prefixed with #, space-separated.
    No marketing/promo/banned words, no brands, no numbers.
    """
    prompt = f"""Generate exactly 30 Russian search hashtags for an Ozon product.

Product title: {payload.title}
Description: {payload.description[:500]}
Category: {payload.category_zh}

Rules (STRICT - Ozon will reject non-compliant tags):
- Generate EXACTLY 30 hashtags, no more, no less
- Each hashtag starts with #
- Each hashtag is 1-2 Russian words only (use underscore for 2 words: #ручная_работа)
- NO 3+ word hashtags
- Space-separated, all on one line
- These are SEARCH keywords buyers would type to find this product
- NO brand names, NO numbers/digits, NO marketing words (sale, discount, promo, акции)
- NO banned words
- Each tag max 30 characters
- Return ONLY the hashtags line, nothing else

Example output: #свечи #форма #ручная_работа #воск #молд #гипс #смола #декор #подсвечник #силикон"""
    try:
        hashtags = _chat([{"role": "user", "content": prompt}], temperature=0.7, max_tokens=4096)
        return {"hashtags": hashtags}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI生成失败: {e}")


@app.post("/api/v1/shops/{shop_id}/ai/match-category")
def ai_match_category(shop_id: int, payload: MatchCategoryRequest, db: Session = Depends(get_db)) -> dict:
    """Chinese-to-Chinese fuzzy category matching. No AI, no translation.

    Extracts product type keywords from the Chinese title and searches
    the title_zh field in the local Ozon category cache.
    """
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")

    title = payload.title.strip()

    # ── 1. Check match history first ──
    keywords_for_hash = _extract_title_keywords(title)
    kw_list = keywords_for_hash.split()
    history_records = []
    for kw in kw_list[:8]:
        rows = db.scalars(select(CategoryMatchHistoryRecord).where(
            CategoryMatchHistoryRecord.shop_id == shop_id,
            CategoryMatchHistoryRecord.title_keywords.like(f"%{kw}%"),
        ).order_by(CategoryMatchHistoryRecord.hit_count.desc()).limit(5)).all()
        for row in rows:
            history_records.append(row)

    history_candidates = []
    if history_records:
        seen_hist = {}
        for row in history_records:
            key = (row.category_id, row.type_id)
            if key not in seen_hist:
                seen_hist[key] = {
                    "category_id": row.category_id,
                    "type_id": row.type_id,
                    "title": row.category_title_zh or "",
                    "title_zh": row.category_title_zh or "",
                    "score": 200 + row.hit_count * 20,
                    "matched": ["history"],
                    "source": "history",
                }
            else:
                seen_hist[key]["score"] += 30
        history_candidates = sorted(seen_hist.values(), key=lambda c: c["score"], reverse=True)[:5]

    # ── 2. Normal keyword matching ──
    # Common product suffixes in Chinese e-commerce
    suffixes = ["包", "鞋", "衣", "裤", "裙", "帽", "表", "灯", "杯", "壳", "架", "盒",
                "箱", "袋", "垫", "毯", "枕", "碗", "盘", "壶", "锅", "刀", "剪",
                "链", "绳", "带", "扣", "环", "钩", "管", "棒", "板", "贴", "膜",
                "器", "机", "线", "充", "耳", "玩具", "收纳", "整理", "装饰",
                "配件", "套装", "工具", "仪器",
                # Additional product-type suffixes
                "模具", "烛台", "香薰", "挂件", "贴纸", "手链", "项链", "耳环",
                "花瓶", "相框", "钟表", "音响", "支架", "底座", "夹子"]

    keywords = set()
    import re as _re

    # Extract compound words ending with product suffixes
    for suffix in suffixes:
        idx = title.rfind(suffix)
        if idx >= 0:
            start = max(0, idx - 4)
            keywords.add(title[start:idx + len(suffix)])
            keywords.add(suffix)
            start2 = max(0, idx - 2)
            keywords.add(title[start2:idx + len(suffix)])

    # Split by separators and take meaningful words
    parts = _re.split(r"[\s,，、/\\\[\]\(\)（）【】]+", title)
    for part in parts:
        part = part.strip()
        if 2 <= len(part) <= 8:
            keywords.add(part)

    keywords = {k for k in keywords if 1 <= len(k) <= 8}
    if not keywords:
        return {"candidates": [], "keywords": []}


    # ── Context-aware keyword penalties ──
    # When "模具" (mold) appears in the title, product-type words like "盒", "收纳"
    # describe what the mold MAKES, not the product itself. Deprioritize them.
    title_lower = title.lower()
    context_penalties = {}
    if "模具" in title:
        for dep in ["收纳盒", "收纳", "盒", "箱", "袋", "碗", "盘", "杯", "壶"]:
            if dep in keywords:
                context_penalties[dep] = -100  # Heavy penalty
    if "贴纸" in title or "贴膜" in title:
        for dep in ["手机", "电脑", "平板"]:
            if dep in keywords:
                context_penalties[dep] = -80
    # When "挂绳" or "手绳" is in title, "手机" is just the usage, not the product
    if "挂绳" in title or "手绳" in title or "腕带" in title:
        for dep in ["手机"]:
            if dep in keywords:
                context_penalties[dep] = -80

    # Boost keywords that appear multiple times in the title (strong product type signal)
    keyword_freq = {}
    for kw in keywords:
        keyword_freq[kw] = title.count(kw)

    # Search title_zh in category cache with smart scoring
    seen = {}
    for kw in sorted(keywords, key=len, reverse=True):
        rows = db.scalars(select(OzonCategoryCacheRecord).where(
            OzonCategoryCacheRecord.shop_id == shop_id,
            OzonCategoryCacheRecord.type_id != "",
            OzonCategoryCacheRecord.title_zh.like(f"%{kw}%"),
        ).limit(200)).all()
        for row in rows:
            key = (row.category_id, row.type_id)
            title_zh = row.title_zh or ""
            parts = title_zh.split(" / ")
            leaf = parts[-1].strip() if parts else title_zh
            parent = " / ".join(parts[:-1]).strip() if len(parts) > 1 else ""

            kw_len = len(kw)
            if kw in leaf:
                base = kw_len * 20
                leaf_bonus = max(0, 10 - len(leaf)) * 3
                start_bonus = 50 if leaf.startswith(kw) else 0
                short_bonus = 30 if len(leaf) <= 3 else (15 if len(leaf) <= 5 else 0)
                exact_bonus = (100 if len(kw) >= 2 else 30) if leaf == kw else 0
                type_bonus = 200 if leaf.startswith(kw + "/") else 0
                compound_penalty = -30 if (leaf.startswith(kw) and len(leaf) > len(kw) + 1
                                           and not leaf.startswith(kw + "/")) else 0
                # Context penalty: e.g. "收纳盒" when "模具" is in title
                ctx_pen = context_penalties.get(kw, 0)
                # Frequency boost: keyword appearing multiple times = strong signal
                freq_bonus = (keyword_freq.get(kw, 1) - 1) * 40
                score = base + leaf_bonus + start_bonus + short_bonus + exact_bonus + type_bonus + compound_penalty + ctx_pen + freq_bonus
            elif kw in parent:
                ctx_pen = context_penalties.get(kw, 0)
                score = kw_len * 5 + ctx_pen
            else:
                score = kw_len * 3

            if key not in seen:
                seen[key] = {
                    "category_id": row.category_id, "type_id": row.type_id,
                    "title": row.title, "title_zh": title_zh,
                    "score": score, "matched": [kw],
                }
            else:
                seen[key]["score"] += score
                seen[key]["matched"].append(kw)

    candidates = sorted(seen.values(), key=lambda c: c["score"], reverse=True)[:10]

    # Merge: history matches get top priority, then normal matches
    if history_candidates:
        existing_keys = {(c["category_id"], c["type_id"]) for c in candidates}
        for hc in history_candidates:
            if (hc["category_id"], hc["type_id"]) not in existing_keys:
                candidates.insert(0, hc)
        # Re-sort with history at top
        candidates = sorted(candidates, key=lambda c: (
            c.get("source") == "history",
            c["score"]
        ), reverse=True)[:10]

    return {"candidates": candidates, "keywords": sorted(keywords, key=len, reverse=True),
            "history_matched": len(history_candidates) > 0}

# Source product detail (for listing editor
# ---------------------------------------------------------------------------

@app.get("/api/v1/shops/{shop_id}/pipeline/source-products/{sp_id}")
def get_source_product_detail(shop_id: int, sp_id: int, db: Session = Depends(get_db)) -> dict:
    product = db.scalar(select(SourceProductRecord).where(
        SourceProductRecord.id == sp_id,
        SourceProductRecord.shop_id == shop_id,
    ))
    if product is None:
        raise HTTPException(status_code=404, detail="采集商品不存在")
    variants = list(db.scalars(select(SourceVariantRecord).where(
        SourceVariantRecord.source_product_id == sp_id,
    ).order_by(SourceVariantRecord.id)))
    media = list(db.scalars(select(SourceMediaRecord).where(
        SourceMediaRecord.source_product_id == sp_id,
    ).order_by(SourceMediaRecord.sort_order, SourceMediaRecord.id)))
    return {
        "id": product.id,
        "source_platform": product.source_platform,
        "source_product_id": product.source_product_id,
        "source_url": product.source_url,
        "title": product.title,
        "main_image_url": product.main_image_url,
        "category_hint": product.category_hint,
        "brand": product.brand,
        "material": product.material,
        "raw_json": product.raw_json,
        "packageInfo": (lambda r: r.get("packageInfo", {}))(json.loads(product.raw_json) if product.raw_json else {}),
        "variants": [
            {
                "id": v.id,
                "source_sku": v.source_sku,
                "spec_name": v.spec_name,
                "price_cny": float(v.price_cny) if v.price_cny else None,
                "stock": v.stock,
                "image_url": v.image_url,
                **(lambda r: {
                    "weightG": r.get("weightG", ""),
                    "lengthMm": r.get("lengthMm", ""),
                    "widthMm": r.get("widthMm", ""),
                    "heightMm": r.get("heightMm", ""),
                })(json.loads(v.raw_json) if v.raw_json else {}),
            }
            for v in variants
        ],
        "media": [
            {
                "id": m.id,
                "media_type": m.media_type,
                "url": m.url,
                "sort_order": m.sort_order,
                "is_primary": m.is_primary,
            }
            for m in media
        ],
    }


# ---------------------------------------------------------------------------
# Listing draft single get + update
# ---------------------------------------------------------------------------

@app.get("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}", response_model=ListingDraftRead)
def get_listing_draft(shop_id: int, draft_id: int, db: Session = Depends(get_db)):
    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.id == draft_id,
        ListingDraftRecord.shop_id == shop_id,
    ))
    if draft is None:
        raise HTTPException(status_code=404, detail="上架草稿不存在")
    return draft


class ListingDraftUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10000)
    category_id: str | None = Field(default=None, max_length=64)
    type_id: str | None = Field(default=None, max_length=64)
    primary_image_url: str | None = Field(default=None, max_length=2000)
    images: list[str] | None = Field(default=None, max_length=100)
    attributes: list[ListingAttributeValueCreate] | None = Field(default=None)
    variants: list[ListingVariantCreate] | None = Field(default=None)

ListingDraftUpdate.model_rebuild()


@app.put("/api/v1/shops/{shop_id}/listing-drafts/{draft_id}", response_model=ListingDraftRead)
def update_listing_draft(shop_id: int, draft_id: int, payload: ListingDraftUpdate, db: Session = Depends(get_db)):
    draft = db.scalar(select(ListingDraftRecord).where(
        ListingDraftRecord.id == draft_id,
        ListingDraftRecord.shop_id == shop_id,
    ))
    if draft is None:
        raise HTTPException(status_code=404, detail="上架草稿不存在")
    if payload.title is not None:
        draft.title = payload.title
    if payload.description is not None:
        draft.description = payload.description
    if payload.category_id is not None:
        draft.category_id = payload.category_id
    if payload.type_id is not None:
        draft.type_id = payload.type_id
    if payload.primary_image_url is not None:
        draft.primary_image_url = payload.primary_image_url
    if payload.images is not None:
        draft.images_json = json.dumps(payload.images, ensure_ascii=False)
    if payload.attributes is not None:
        db.query(ListingAttributeValueRecord).where(ListingAttributeValueRecord.draft_id == draft_id).delete()
        for attr in payload.attributes:
            draft.attribute_values.append(ListingAttributeValueRecord(
                attribute_id=attr.attribute_id,
                name=attr.name,
                value_id=attr.value_id,
                value_text=attr.value_text,
            ))
    if payload.variants is not None:
        db.query(ListingVariantRecord).where(ListingVariantRecord.draft_id == draft_id).delete()
        for var in payload.variants:
            draft.variants.append(ListingVariantRecord(**var.model_dump()))
    db.commit()
    db.refresh(draft)
    return draft









