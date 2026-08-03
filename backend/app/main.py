from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import Base, engine, ensure_sqlite_operational_columns, get_db
from . import erp_models  # noqa: F401 - registers persistent operational tables.
from .erp_models import AuditEventRecord, FbsPostingRecord, ListingDraftRecord, ListingVariantRecord, OzonCategoryCacheRecord, ProductRecord, SyncRun
from .models import ApiCredential, Shop
from .schemas import OzonCredentialStatus, OzonCredentialUpsert, ShopCreate, ShopRead, ShopUpdate
from .security import CredentialEncryptionUnavailable, encrypt_secret
from .sync_service import sync_category_cache, sync_fbs_postings, sync_fbs_product_images, sync_products
from .schemas import FbsPostingDetailRead, FbsPostingRead, FbsPostingSyncRequest, ListingDraftCreate, ListingDraftRead, ListingValidationRead, ProductRead, ProductSyncRequest, SyncRunRead
from .listing_service import validate_listing_draft
from .sync_service import _credentials
from .integrations.ozon_seller import OzonSellerClient
from .auto_sync import AutoSyncShopNotFound, request_auto_sync, run_auto_sync_resource
from .schemas import AutoSyncDecisionRead, AutoSyncRequest

Base.metadata.create_all(bind=engine)
ensure_sqlite_operational_columns()

app = FastAPI(title="Ozon ERP API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)


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
    draft = ListingDraftRecord(shop_id=shop_id, offer_id=payload.offer_id, title=payload.title, description=payload.description, category_id=payload.category_id, type_id=payload.type_id, primary_image_url=payload.primary_image_url)
    db.add(draft)
    for variant in payload.variants:
        draft.variants.append(ListingVariantRecord(**variant.model_dump()))
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
    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        response = client.get_category_attributes(category_id=category_id, type_id=type_id)
    attributes = response.get("result", [])
    if not isinstance(attributes, list):
        raise HTTPException(status_code=502, detail="Ozon 类目属性响应格式错误")
    return [{"id": str(item.get("id")), "name": str(item.get("name") or "未命名属性"), "required": bool(item.get("is_required")), "dictionary_id": str(item.get("dictionary_id") or ""), "type": str(item.get("type") or "")} for item in attributes if isinstance(item, dict) and item.get("id") is not None]
