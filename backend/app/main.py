from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import Base, engine, ensure_sqlite_operational_columns, get_db, settings
from . import erp_models  # noqa: F401 - registers persistent operational tables.
from .erp_models import AuditEventRecord, FbsPostingRecord, ListingAttributeValueRecord, ListingDraftRecord, ListingVariantRecord, OzonAttributeCacheRecord, OzonAttributeDictionaryQueryCacheRecord, OzonAttributeDictionaryValueRecord, OzonCategoryCacheRecord, ProductRecord, SyncRun, SyncState
from .models import ApiCredential, Shop
from .schemas import OzonCredentialStatus, OzonCredentialUpsert, ShopCreate, ShopRead, ShopUpdate
from .security import CredentialEncryptionUnavailable, encrypt_secret
from .sync_service import sync_category_cache, sync_fbs_postings, sync_fbs_product_images, sync_products
from .schemas import FbsPostingDetailRead, FbsPostingRead, FbsPostingSyncRequest, ListingDraftCreate, ListingDraftRead, ListingValidationRead, ProductRead, ProductSyncRequest, SyncRunRead
from .listing_service import validate_listing_draft
from .auto_sync import AutoSyncShopNotFound, request_auto_sync, run_auto_sync_resource
from .schemas import AutoSyncDecisionRead, AutoSyncRequest
from .listing_metadata_service import get_category_attributes, search_category_attribute_values
from .pipeline.routes import router as pipeline_router, ext_router as pipeline_ext_router
from .ai_service import translate_text, suggest_attribute_value, generate_description, generate_rich_content, match_category_with_ai
from .pipeline.fact_extraction import ProductFacts, extract_facts
from .pipeline.category_matching import recall_categories, rerank_categories
from .erp_models import SourceProductRecord, SourceVariantRecord, SourceMediaRecord
from .erp_models import SourceProductRecord, SourceVariantRecord, SourceMediaRecord

if settings.database_url.startswith("sqlite"):
    Base.metadata.create_all(bind=engine)
    ensure_sqlite_operational_columns()

app = FastAPI(title="Ozon ERP API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],
    allow_origin_regex=r"^chrome-extension://[a-f0-9]{32}$",
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
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
    draft = ListingDraftRecord(shop_id=shop_id, offer_id=payload.offer_id, title=payload.title, description=payload.description, category_id=payload.category_id, type_id=payload.type_id, primary_image_url=payload.primary_image_url)
    attribute_records = []
    for attribute in payload.attributes:
        template = templates.get(attribute.attribute_id)
        if template is None:
            raise HTTPException(status_code=422, detail=f"属性 {attribute.attribute_id} 不属于当前店铺所选类目")
        value_text = attribute.value_text
        if template.dictionary_id:
            cached_value = db.scalar(select(OzonAttributeDictionaryValueRecord).where(OzonAttributeDictionaryValueRecord.shop_id == shop_id, OzonAttributeDictionaryValueRecord.category_id == payload.category_id, OzonAttributeDictionaryValueRecord.type_id == payload.type_id, OzonAttributeDictionaryValueRecord.attribute_id == attribute.attribute_id, OzonAttributeDictionaryValueRecord.value_id == attribute.value_id))
            if cached_value is None or (value_text and cached_value.value != value_text):
                raise HTTPException(status_code=422, detail=f"属性“{template.name}”必须选择当前 Ozon 字典返回值")
            value_text = cached_value.value
        attribute_records.append(ListingAttributeValueRecord(attribute_id=attribute.attribute_id, name=template.name, value_id=attribute.value_id, value_text=value_text))
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


@app.post("/api/v1/shops/{shop_id}/metadata/categories")
def sync_categories(shop_id: int, db: Session = Depends(get_db)) -> dict[str, int]:
    run = sync_category_cache(db, shop_id)
    if run.status != "succeeded":
        raise HTTPException(status_code=502, detail=run.error_summary or "Ozon 类目同步失败")
    return {"records": run.records_changed}


@app.get("/api/v1/shops/{shop_id}/metadata/categories")
def list_categories(shop_id: int, query: str | None = None, db: Session = Depends(get_db)) -> list[dict[str, str]]:
    statement = select(OzonCategoryCacheRecord).where(OzonCategoryCacheRecord.shop_id == shop_id, OzonCategoryCacheRecord.type_id != "")
    if query:
        statement = statement.where(OzonCategoryCacheRecord.title.ilike(f"%{query[:100]}%"))
    rows = db.scalars(statement.order_by(OzonCategoryCacheRecord.title).limit(1000))
    return [{"category_id": row.category_id, "type_id": row.type_id, "title": row.title} for row in rows]


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


@app.post("/api/v1/shops/{shop_id}/ai/match-category")
def ai_match_category(shop_id: int, payload: MatchCategoryRequest, db: Session = Depends(get_db)) -> dict:
    """Chinese-to-Chinese fuzzy category matching. No AI, no translation.

    Extracts product type keywords from the Chinese title and searches
    the title_zh field in the local Ozon category cache.
    """
    if db.get(Shop, shop_id) is None:
        raise HTTPException(status_code=404, detail="店铺不存在")

    title = payload.title.strip()

    # Common product suffixes in Chinese e-commerce
    suffixes = ["包", "鞋", "衣", "裤", "裙", "帽", "表", "灯", "杯", "壳", "架", "盒",
                "箱", "袋", "垫", "毯", "枕", "碗", "盘", "壶", "锅", "刀", "剪",
                "链", "绳", "带", "扣", "环", "钩", "管", "棒", "板", "贴", "膜",
                "器", "机", "线", "充", "耳", "玩具", "收纳", "整理", "装饰",
                "配件", "套装", "工具", "仪器"]

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
            # Split by " / " (space-slash-space) to separate parent / leaf
            # This handles cases like "配饰 / 包/袋" where "包/袋" is the leaf
            parts = title_zh.split(" / ")
            leaf = parts[-1].strip() if parts else title_zh
            parent = " / ".join(parts[:-1]).strip() if len(parts) > 1 else ""

            # Scoring: leaf match > parent match
            kw_len = len(kw)
            if kw in leaf:
                base = kw_len * 20
                # Shorter leaf = more general category
                leaf_bonus = max(0, 10 - len(leaf)) * 3
                # Keyword at start of leaf = strong signal
                start_bonus = 50 if leaf.startswith(kw) else 0
                # Very short leaf (1-3 chars) = very general category
                short_bonus = 30 if len(leaf) <= 3 else (15 if len(leaf) <= 5 else 0)
                # Exact match (leaf IS the keyword) - only for 2+ char keywords
                exact_bonus = (100 if len(kw) >= 2 else 30) if leaf == kw else 0
                # Leaf is "keyword/something" (e.g. "包/袋") = category IS this product type
                type_bonus = 200 if leaf.startswith(kw + "/") else 0
                # Penalty for compound words where keyword is just a prefix
                # e.g. "包架" (bag rack) is not "包" (bag) itself
                compound_penalty = -30 if (leaf.startswith(kw) and len(leaf) > len(kw) + 1
                                           and not leaf.startswith(kw + "/")) else 0
                score = base + leaf_bonus + start_bonus + short_bonus + exact_bonus + type_bonus + compound_penalty
            elif kw in parent:
                score = kw_len * 5
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
    return {"candidates": candidates, "keywords": sorted(keywords, key=len, reverse=True)}

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
        "variants": [
            {
                "id": v.id,
                "source_sku": v.source_sku,
                "spec_name": v.spec_name,
                "price_cny": float(v.price_cny) if v.price_cny else None,
                "stock": v.stock,
                "image_url": v.image_url,
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
    attributes: list[ListingAttributeValueCreate] | None = Field(default=None)
    variants: list[ListingVariantCreate] | None = Field(default=None)


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






