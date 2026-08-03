from datetime import datetime
from decimal import Decimal

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr


class ShopBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    legal_entity: str | None = Field(default=None, max_length=160)
    currency: Literal["CNY"] = "CNY"
    timezone: str = Field(default="Asia/Shanghai", max_length=64)
    manager_name: str | None = Field(default=None, max_length=120)
    is_active: bool = True


class ShopCreate(ShopBase):
    pass


class ShopUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    legal_entity: str | None = Field(default=None, max_length=160)
    currency: Literal["CNY"] | None = None
    timezone: str | None = Field(default=None, max_length=64)
    manager_name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None


class ShopRead(ShopBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


class OzonCredentialUpsert(BaseModel):
    """Write-only Ozon Seller credential payload; secrets are never returned."""

    client_id: str = Field(min_length=1, max_length=160, pattern=r"^\d+$")
    api_key: SecretStr = Field(min_length=20, max_length=200)
    key_label: str | None = Field(default=None, max_length=160)


class OzonCredentialStatus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    shop_id: int
    provider: str
    client_id_reference: str | None
    key_identifier: str | None
    status: str
    expires_at: datetime | None


class ProductSyncRequest(BaseModel):
    limit: int = Field(default=100, ge=1, le=1000)
    last_id: str = Field(default="", max_length=512)


class FbsPostingSyncRequest(BaseModel):
    since: datetime
    to: datetime
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
    status: str = Field(default="", max_length=128)


class SyncRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    resource: str
    status: str
    cursor: str | None
    records_seen: int
    records_changed: int
    error_summary: str | None
    started_at: datetime
    finished_at: datetime | None


class AutoSyncRequest(BaseModel):
    view: Literal["dashboard", "orders", "products", "listing", "shops", "pricing", "sync"]


class AutoSyncDecisionRead(BaseModel):
    resource: str
    status: Literal["fresh", "started", "already_running", "failed_to_start"]


class ProductRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    ozon_product_id: str
    offer_id: str | None
    name: str
    updated_at: datetime


class FbsPostingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    posting_number: str
    normalized_status: str
    raw_ozon_status: str | None
    pack_by: datetime | None
    updated_at: datetime


class FbsPostingLineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    offer_id: str
    ozon_product_id: str | None
    ozon_sku: str | None
    name: str | None
    image_url: str | None
    quantity: int


class FbsPostingDetailRead(FbsPostingRead):
    lines: list[FbsPostingLineRead]


class ListingVariantCreate(BaseModel):
    seller_sku: str = Field(min_length=1, max_length=128)
    purchase_cost_cny: Decimal | None = Field(default=None, ge=0)
    weight_g: Decimal | None = Field(default=None, gt=0)
    length_mm: Decimal | None = Field(default=None, gt=0)
    width_mm: Decimal | None = Field(default=None, gt=0)
    height_mm: Decimal | None = Field(default=None, gt=0)


class ListingAttributeValueCreate(BaseModel):
    attribute_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=500)
    value_id: str | None = Field(default=None, max_length=64)
    value_text: str | None = Field(default=None, max_length=10000)


class ListingDraftCreate(BaseModel):
    offer_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10000)
    category_id: str | None = Field(default=None, max_length=64)
    type_id: str | None = Field(default=None, max_length=64)
    primary_image_url: str | None = Field(default=None, max_length=2000)
    attributes: list[ListingAttributeValueCreate] = Field(default_factory=list, max_length=200)
    variants: list[ListingVariantCreate] = Field(min_length=1, max_length=100)


class ListingVariantRead(ListingVariantCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    calculated_price_cny: Decimal | None
    min_price_cny: str | None
    old_price_cny: Decimal | None


class ListingAttributeValueRead(ListingAttributeValueCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ListingDraftRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    offer_id: str
    title: str
    description: str | None
    category_id: str | None
    type_id: str | None
    primary_image_url: str | None
    status: str
    validation_json: str | None
    created_at: datetime
    updated_at: datetime
    variants: list[ListingVariantRead]
    attribute_values: list[ListingAttributeValueRead]


class ListingValidationIssue(BaseModel):
    field: str
    message: str


class ListingValidationRead(BaseModel):
    draft_id: int
    status: str
    issues: list[ListingValidationIssue]
