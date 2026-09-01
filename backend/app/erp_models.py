"""Persistent operational records for the Chinese CNY-only FBS ERP."""

import json
from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class ProductRecord(Base):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("shop_id", "ozon_product_id", name="uq_product_shop_ozon_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    ozon_product_id: Mapped[str] = mapped_column(String(64))
    offer_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    name: Mapped[str] = mapped_column(String(500))
    raw_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    skus: Mapped[list["SkuRecord"]] = relationship(back_populates="product", cascade="all, delete-orphan")


class SkuRecord(Base):
    __tablename__ = "skus"
    __table_args__ = (UniqueConstraint("shop_id", "seller_sku", name="uq_sku_shop_seller_sku"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    seller_sku: Mapped[str] = mapped_column(String(128))
    title: Mapped[str] = mapped_column(String(500))
    min_price_cny: Mapped[str | None] = mapped_column(String(32), nullable=True)
    product: Mapped[ProductRecord] = relationship(back_populates="skus")


class InventoryBalanceRecord(Base):
    __tablename__ = "inventory_balances"
    __table_args__ = (UniqueConstraint("warehouse_id", "sku_id", name="uq_inventory_warehouse_sku"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"), index=True)
    sku_id: Mapped[int] = mapped_column(ForeignKey("skus.id", ondelete="RESTRICT"), index=True)
    on_hand: Mapped[int] = mapped_column(Integer, default=0)
    reserved: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class FbsPostingRecord(Base):
    __tablename__ = "fbs_postings"
    __table_args__ = (UniqueConstraint("shop_id", "posting_number", name="uq_posting_shop_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=True)
    posting_number: Mapped[str] = mapped_column(String(128))
    normalized_status: Mapped[str] = mapped_column(String(40), index=True)
    raw_ozon_status: Mapped[str | None] = mapped_column(String(128), nullable=True)
    pack_by: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    raw_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    lines: Mapped[list["FbsPostingLineRecord"]] = relationship(back_populates="posting", cascade="all, delete-orphan")


class FbsPostingLineRecord(Base):
    __tablename__ = "fbs_posting_lines"
    __table_args__ = (UniqueConstraint("posting_id", "offer_id", name="uq_posting_line_offer"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    posting_id: Mapped[int] = mapped_column(ForeignKey("fbs_postings.id", ondelete="CASCADE"), index=True)
    offer_id: Mapped[str] = mapped_column(String(128))
    ozon_product_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ozon_sku: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    image_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    posting: Mapped[FbsPostingRecord] = relationship(back_populates="lines")


class SyncRun(Base):
    __tablename__ = "sync_runs"
    __table_args__ = (Index("ix_sync_run_shop_resource_started", "shop_id", "resource", "started_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    resource: Mapped[str] = mapped_column(String(40))  # products | fbs_postings
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    cursor: Mapped[str | None] = mapped_column(String(512), nullable=True)
    records_seen: Mapped[int] = mapped_column(Integer, default=0)
    records_changed: Mapped[int] = mapped_column(Integer, default=0)
    error_summary: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SyncState(Base):
    __tablename__ = "sync_states"
    __table_args__ = (
        UniqueConstraint("shop_id", "resource", name="uq_sync_state_shop_resource"),
        Index("ix_sync_state_freshness", "shop_id", "resource", "last_success_at"),
        Index("ix_sync_state_lease", "lease_expires_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    resource: Mapped[str] = mapped_column(String(40))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cursor: Mapped[str | None] = mapped_column(String(512), nullable=True)
    window_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_owner: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AuditEventRecord(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    actor_id: Mapped[str] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(80))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str] = mapped_column(String(128))
    details_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ListingDraftRecord(Base):
    __tablename__ = "listing_drafts"
    __table_args__ = (UniqueConstraint("shop_id", "offer_id", name="uq_listing_draft_shop_offer"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    offer_id: Mapped[str] = mapped_column(String(128))
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    type_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    primary_image_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    # Source/operational video link. This is not sent to Ozon import because
    # Ozon does not accept a third-party video URL in product import payloads.
    video_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    validation_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    images_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Editor-level watermark settings.  Kept with the draft so the submit path
    # can apply the exact same PNG/position/opacity/scale to every image.
    watermark_config_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    learning_attribute_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_product_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Ozon product IDs exceed a signed 32-bit integer.  PostgreSQL already
    # stores this as BIGINT; keep the ORM bind type aligned or a successful
    # stock readback cannot be persisted.
    ozon_product_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    moderation_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ozon_issues_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    quality_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    import_task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    stock_sync_status: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    stock_sync_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    stock_sync_attempts: Mapped[int] = mapped_column(Integer, default=0)
    stock_sync_next_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    stock_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    @property
    def ozon_issues(self) -> list[dict] | None:
        if self.ozon_issues_json:
            try:
                parsed = json.loads(self.ozon_issues_json)
                return parsed if isinstance(parsed, list) else None
            except Exception:
                return None
        return None

    @property
    def images(self) -> list[str] | None:
        if self.images_json:
            try:
                parsed = json.loads(self.images_json)
                return parsed if isinstance(parsed, list) else None
            except Exception:
                return None
        return None

    @property
    def watermark_config(self) -> dict | None:
        if self.watermark_config_json:
            try:
                parsed = json.loads(self.watermark_config_json)
                return parsed if isinstance(parsed, dict) else None
            except Exception:
                return None
        return None

    @property
    def learning_attribute_ids(self) -> list[str]:
        if self.learning_attribute_ids_json:
            try:
                parsed = json.loads(self.learning_attribute_ids_json)
                return [str(value) for value in parsed] if isinstance(parsed, list) else []
            except Exception:
                return []
        return []

    variants: Mapped[list["ListingVariantRecord"]] = relationship(back_populates="draft", cascade="all, delete-orphan")
    attribute_values: Mapped[list["ListingAttributeValueRecord"]] = relationship(back_populates="draft", cascade="all, delete-orphan")


class ListingVariantRecord(Base):
    __tablename__ = "listing_variants"
    __table_args__ = (UniqueConstraint("draft_id", "seller_sku", name="uq_listing_variant_draft_sku"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    draft_id: Mapped[int] = mapped_column(ForeignKey("listing_drafts.id", ondelete="CASCADE"), index=True)
    seller_sku: Mapped[str] = mapped_column(String(128))
    purchase_cost_cny: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    weight_g: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    length_mm: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    width_mm: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    height_mm: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    calculated_price_cny: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    min_price_cny: Mapped[str | None] = mapped_column(String(32), nullable=True)
    old_price_cny: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    stock: Mapped[int | None] = mapped_column(Integer, nullable=True)
    name_ru: Mapped[str | None] = mapped_column(String(500), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    image_urls_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    price_cny: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    variant_values_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    draft: Mapped[ListingDraftRecord] = relationship(back_populates="variants")

    @property
    def image_urls(self) -> list[str] | None:
        if self.image_urls_json is None:
            return None
        try:
            parsed = json.loads(self.image_urls_json)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []

    @image_urls.setter
    def image_urls(self, value: list[str] | None) -> None:
        self.image_urls_json = json.dumps(value, ensure_ascii=False) if value is not None else None


class ListingTemplateRecord(Base):
    """Reusable fixed form values for one shop and one Ozon category/type."""

    __tablename__ = "listing_templates"
    __table_args__ = (UniqueConstraint("shop_id", "name", name="uq_listing_template_shop_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    category_id: Mapped[str] = mapped_column(String(64))
    type_id: Mapped[str] = mapped_column(String(64))
    attributes_json: Mapped[str] = mapped_column(Text, default="[]")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PricingPolicyRecord(Base):
    """Singleton pricing parameters used by every new listing in this ERP."""

    __tablename__ = "pricing_policy"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    purchase_buffer_cny: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("5"))
    commission_rate: Mapped[Decimal] = mapped_column(Numeric(8, 5), default=Decimal("0.15"))
    misc_fee_rate: Mapped[Decimal] = mapped_column(Numeric(8, 5), default=Decimal("0.02"))
    fixed_misc_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("2"))
    target_profit_rate: Mapped[Decimal] = mapped_column(Numeric(8, 5), default=Decimal("0.30"))
    old_price_multiplier: Mapped[Decimal] = mapped_column(Numeric(8, 3), default=Decimal("2"))
    listing_price_floor_cny: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("26.99"))
    minimum_profit_rate: Mapped[Decimal] = mapped_column(Numeric(8, 5), default=Decimal("0.08"))
    minimum_profit_cny: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("3"))
    logistics_ratio_warn: Mapped[Decimal] = mapped_column(Numeric(8, 5), default=Decimal("0.35"))
    max_iterations: Mapped[int] = mapped_column(Integer, default=40)
    updated_by: Mapped[str] = mapped_column(String(128), default="operator")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ListingAttributeValueRecord(Base):
    __tablename__ = "listing_attribute_values"
    __table_args__ = (UniqueConstraint("draft_id", "attribute_id", name="uq_listing_attribute_draft_attribute"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    draft_id: Mapped[int] = mapped_column(ForeignKey("listing_drafts.id", ondelete="CASCADE"), index=True)
    attribute_id: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(500))
    value_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    draft: Mapped[ListingDraftRecord] = relationship(back_populates="attribute_values")


class OzonCategoryCacheRecord(Base):
    __tablename__ = "ozon_category_cache"
    __table_args__ = (UniqueConstraint("shop_id", "category_id", "type_id", name="uq_category_cache"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    category_id: Mapped[str] = mapped_column(String(64))
    type_id: Mapped[str] = mapped_column(String(64), default="")
    title: Mapped[str] = mapped_column(String(500))
    parent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title_zh: Mapped[str | None] = mapped_column(String(500), nullable=True)


class OzonAttributeCacheRecord(Base):
    __tablename__ = "ozon_attribute_cache"
    __table_args__ = (UniqueConstraint("shop_id", "category_id", "type_id", "attribute_id", name="uq_ozon_attribute_cache"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    category_id: Mapped[str] = mapped_column(String(64))
    type_id: Mapped[str] = mapped_column(String(64))
    attribute_id: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(500))
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    dictionary_id: Mapped[str] = mapped_column(String(64), default="")
    value_type: Mapped[str] = mapped_column(String(80), default="")
    complex_id: Mapped[str] = mapped_column(String(64), default="0")
    description: Mapped[str] = mapped_column(String(2000), default="")
    is_collection: Mapped[bool] = mapped_column(Boolean, default=False)
    is_aspect: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OzonAttributeDictionaryValueRecord(Base):
    __tablename__ = "ozon_attribute_dictionary_values"
    __table_args__ = (UniqueConstraint("shop_id", "category_id", "type_id", "attribute_id", "value_id", name="uq_ozon_attribute_dictionary_value"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    category_id: Mapped[str] = mapped_column(String(64))
    type_id: Mapped[str] = mapped_column(String(64))
    attribute_id: Mapped[str] = mapped_column(String(64))
    value_id: Mapped[str] = mapped_column(String(64))
    value: Mapped[str] = mapped_column(String(1000))
    info: Mapped[str | None] = mapped_column(Text, nullable=True)
    picture: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OzonAttributeDictionaryQueryCacheRecord(Base):
    __tablename__ = "ozon_attribute_dictionary_query_cache"
    __table_args__ = (UniqueConstraint("shop_id", "category_id", "type_id", "attribute_id", "query_key", "result_limit", name="uq_ozon_attribute_dictionary_query_cache"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    category_id: Mapped[str] = mapped_column(String(64))
    type_id: Mapped[str] = mapped_column(String(64))
    attribute_id: Mapped[str] = mapped_column(String(64))
    query_key: Mapped[str] = mapped_column(String(100))
    result_limit: Mapped[int] = mapped_column(Integer)
    result_json: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OzonGlobalCategoryCacheRecord(Base):
    __tablename__ = "ozon_global_category_cache"
    __table_args__ = (UniqueConstraint("category_id", "type_id", name="uq_global_category_cache"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[str] = mapped_column(String(64), index=True)
    type_id: Mapped[str] = mapped_column(String(64), default="")
    title: Mapped[str] = mapped_column(String(500))
    parent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title_zh: Mapped[str | None] = mapped_column(String(500), nullable=True)


class OzonGlobalAttributeCacheRecord(Base):
    __tablename__ = "ozon_global_attribute_cache"
    __table_args__ = (UniqueConstraint("category_id", "type_id", "attribute_id", name="uq_global_attribute_cache"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[str] = mapped_column(String(64), index=True)
    type_id: Mapped[str] = mapped_column(String(64))
    attribute_id: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(500))
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    dictionary_id: Mapped[str] = mapped_column(String(64), default="")
    value_type: Mapped[str] = mapped_column(String(80), default="")
    complex_id: Mapped[str] = mapped_column(String(64), default="0")
    description: Mapped[str] = mapped_column(String(2000), default="")
    is_collection: Mapped[bool] = mapped_column(Boolean, default=False)
    is_aspect: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OzonGlobalDictValueRecord(Base):
    __tablename__ = "ozon_global_dict_values"
    __table_args__ = (UniqueConstraint("category_id", "type_id", "attribute_id", "value_id", name="uq_global_dict_value"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[str] = mapped_column(String(64), index=True)
    type_id: Mapped[str] = mapped_column(String(64))
    attribute_id: Mapped[str] = mapped_column(String(64))
    value_id: Mapped[str] = mapped_column(String(64))
    value: Mapped[str] = mapped_column(String(1000))
    info: Mapped[str | None] = mapped_column(Text, nullable=True)
    picture: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

# ---------------------------------------------------------------------------
# 1688 -> Ozon automated listing pipeline (P0-P7)
# ---------------------------------------------------------------------------


class SourceProductRecord(Base):
    """Raw 1688 product snapshot ingested from the Chrome extension (P0/P1)."""

    __tablename__ = "source_products"
    __table_args__ = (UniqueConstraint("source_platform", "source_product_id", name="uq_source_product"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    source_platform: Mapped[str] = mapped_column(String(32), default="1688")
    source_product_id: Mapped[str] = mapped_column(String(64))
    source_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    source_shop_name: Mapped[str | None] = mapped_column(String(300), nullable=True, index=True)
    source_shop_key: Mapped[str | None] = mapped_column(String(180), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(500))
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    main_image_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    category_hint: Mapped[str | None] = mapped_column(String(500), nullable=True)
    brand: Mapped[str | None] = mapped_column(String(200), nullable=True)
    material: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ingestion_status: Mapped[str] = mapped_column(String(32), default="ingested", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    variants: Mapped[list["SourceVariantRecord"]] = relationship(back_populates="source_product", cascade="all, delete-orphan")
    media: Mapped[list["SourceMediaRecord"]] = relationship(back_populates="source_product", cascade="all, delete-orphan")


class SourceProductShopRecord(Base):
    """A shop opted into using a shared strong-identity source snapshot."""

    __tablename__ = "source_product_shops"
    __table_args__ = (UniqueConstraint("source_product_id", "shop_id", name="uq_source_product_shop"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_product_id: Mapped[int] = mapped_column(ForeignKey("source_products.id", ondelete="CASCADE"), index=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    # A deletion from one shop is a durable opt-out. The extension may capture
    # the same strong source identity again, but it must not recreate this link
    # unless an explicit restore flow is added later.
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="0", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SourceVariantRecord(Base):
    __tablename__ = "source_variants"
    __table_args__ = (UniqueConstraint("source_product_id", "source_sku", name="uq_source_variant"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_product_id: Mapped[int] = mapped_column(ForeignKey("source_products.id", ondelete="CASCADE"), index=True)
    source_sku: Mapped[str] = mapped_column(String(128))
    spec_name: Mapped[str] = mapped_column(String(500))
    price_cny: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    stock: Mapped[int] = mapped_column(Integer, default=0)
    image_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_product: Mapped[SourceProductRecord] = relationship(back_populates="variants")


class SourceMediaRecord(Base):
    __tablename__ = "source_media"
    __table_args__ = (UniqueConstraint("source_product_id", "url", name="uq_source_media"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_product_id: Mapped[int] = mapped_column(ForeignKey("source_products.id", ondelete="CASCADE"), index=True)
    media_type: Mapped[str] = mapped_column(String(16), default="image")
    url: Mapped[str] = mapped_column(String(2000))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    source_product: Mapped[SourceProductRecord] = relationship(back_populates="media")


class YunNewtonSupplementJobRecord(Base):
    """Auditable, link-scoped Yun Newton supplement job.

    This is a collection-only record.  A successful result may be reviewed and
    ingested into the shared 1688 source snapshot, but it never creates a
    listing draft or calls an Ozon write API.
    """

    __tablename__ = "yunniudun_supplement_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    source_url: Mapped[str] = mapped_column(String(2000), index=True)
    offer_id: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    request_message: Mapped[str] = mapped_column(Text)
    provider_task_id: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True, index=True)
    provider_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    next_index: Mapped[int] = mapped_column(Integer, default=0)
    raw_result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    normalized_capture_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    parse_issues_json: Mapped[str] = mapped_column(Text, default="[]")
    source_product_id: Mapped[int | None] = mapped_column(ForeignKey("source_products.id", ondelete="SET NULL"), nullable=True, index=True)
    error_message: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OzonErrorPatternRecord(Base):
    """Persisted Ozon feedback rules used by the submit-time auto-fixer."""

    __tablename__ = "ozon_error_patterns"
    __table_args__ = (UniqueConstraint("error_code", "error_field", name="uq_ozon_error_pattern"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    error_code: Mapped[str] = mapped_column(String(128), nullable=False)
    error_field: Mapped[str | None] = mapped_column(String(64), nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="other")
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="warning")
    auto_fixable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fix_action: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fix_rule_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_ru: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_zh: Mapped[str | None] = mapped_column(Text, nullable=True)
    human_action_zh: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OzonGlobalDictionaryQueryCacheRecord(Base):
    """Global cache for dictionary search responses, including empty results."""

    __tablename__ = "ozon_global_dictionary_query_cache"
    __table_args__ = (UniqueConstraint(
        "category_id", "type_id", "attribute_id", "query_key", "result_limit",
        name="uq_ozon_global_dictionary_query_cache",
    ),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[str] = mapped_column(String(64), index=True)
    type_id: Mapped[str] = mapped_column(String(64))
    attribute_id: Mapped[str] = mapped_column(String(64))
    query_key: Mapped[str] = mapped_column(String(100))
    result_limit: Mapped[int] = mapped_column(Integer)
    result_json: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PipelineProductRecord(Base):
    """Processing state linking a source product through P2-P7 stages."""

    __tablename__ = "pipeline_products"
    __table_args__ = (UniqueConstraint("shop_id", "source_product_id", name="uq_pipeline_product"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    source_product_id: Mapped[int] = mapped_column(ForeignKey("source_products.id", ondelete="CASCADE"), index=True)
    pipeline_stage: Mapped[str] = mapped_column(String(32), default="ingested", index=True)
    # P2: category matching
    matched_category_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    matched_type_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    category_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    category_candidates_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # P3: attribute mapping
    attribute_mapping_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    attribute_coverage: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    # P4: variant mapping
    variant_mapping_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # P5: content + pricing
    generated_title_ru: Mapped[str | None] = mapped_column(String(500), nullable=True)
    generated_description_ru: Mapped[str | None] = mapped_column(Text, nullable=True)
    generated_specs_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_verified: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    pricing_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # P6: quality
    quality_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    quality_issues_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # P7: publish
    listing_draft_id: Mapped[int | None] = mapped_column(ForeignKey("listing_drafts.id", ondelete="SET NULL"), nullable=True)
    publish_status: Mapped[str] = mapped_column(String(32), default="not_submitted", index=True)
    task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PipelineProgressRecord(Base):
    """Tracks P0-P7 stage completion for the dashboard."""

    __tablename__ = "pipeline_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    stage: Mapped[str] = mapped_column(String(8), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    tasks_json: Mapped[str] = mapped_column(Text, default="[]")
    progress_percent: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class CategoryMatchHistoryRecord(Base):
    """Remember which category was chosen for a given product title.
    Used to improve future auto-matching accuracy by learning from manual selections."""

    __tablename__ = "category_match_history"
    __table_args__ = (UniqueConstraint("shop_id", "title_hash", name="uq_category_match_history"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    title_keywords: Mapped[str] = mapped_column(String(500), default="")
    title_hash: Mapped[str] = mapped_column(String(64), index=True)
    category_id: Mapped[str] = mapped_column(String(64))
    type_id: Mapped[str] = mapped_column(String(64))
    category_title_zh: Mapped[str] = mapped_column(String(500), default="")
    source: Mapped[str] = mapped_column(String(20), default="manual")
    hit_count: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DecisionMemoryRecord(Base):
    """A trusted, reversible decision learned from explicit or Ozon-verified feedback."""

    __tablename__ = "decision_memories"
    __table_args__ = (
        UniqueConstraint(
            "shop_id", "decision_type", "product_fingerprint", "decision_key",
            name="uq_decision_memory_scope",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    decision_type: Mapped[str] = mapped_column(String(32), index=True)
    source_product_id: Mapped[int | None] = mapped_column(ForeignKey("source_products.id", ondelete="SET NULL"), nullable=True, index=True)
    product_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    domain: Mapped[str] = mapped_column(String(80), index=True)
    title: Mapped[str] = mapped_column(String(500))
    facts_json: Mapped[str] = mapped_column(Text, default="{}")
    decision_key: Mapped[str] = mapped_column(String(160))
    decision_value_json: Mapped[str] = mapped_column(Text)
    evidence_json: Mapped[str] = mapped_column(Text, default="{}")
    source: Mapped[str] = mapped_column(String(32), index=True)
    trust_score: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.7500"))
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    confirmation_count: Mapped[int] = mapped_column(Integer, default=1)
    ozon_success_count: Mapped[int] = mapped_column(Integer, default=0)
    rejection_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DecisionFeedbackRecord(Base):
    """Append-only evidence explaining why a memory changed trust or status."""

    __tablename__ = "decision_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    memory_id: Mapped[int | None] = mapped_column(ForeignKey("decision_memories.id", ondelete="SET NULL"), nullable=True, index=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    source_product_id: Mapped[int | None] = mapped_column(ForeignKey("source_products.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(32), index=True)
    before_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor: Mapped[str] = mapped_column(String(128), default="operator")
    details_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DecisionFeedbackReceiptRecord(Base):
    """Durable idempotency receipt for external feedback events."""

    __tablename__ = "decision_feedback_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_key: Mapped[str] = mapped_column(String(300), unique=True, index=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    source_product_id: Mapped[int | None] = mapped_column(ForeignKey("source_products.id", ondelete="SET NULL"), nullable=True)
    outcome: Mapped[str] = mapped_column(String(32))
    details_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AutomationTaskRecord(Base):
    """Persisted configuration for scheduled 1688 sourcing runs."""

    __tablename__ = "automation_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    keywords_json: Mapped[str] = mapped_column(Text, default="[]")
    excluded_keywords_json: Mapped[str] = mapped_column(Text, default="[]")
    filters_json: Mapped[str] = mapped_column(Text, default="{}")
    daily_target: Mapped[int] = mapped_column(Integer, default=100)
    schedule_time: Mapped[str] = mapped_column(String(5), default="09:00")
    status: Mapped[str] = mapped_column(String(24), default="paused", index=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AutomationRunRecord(Base):
    __tablename__ = "automation_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("automation_tasks.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    discovered_count: Mapped[int] = mapped_column(Integer, default=0)
    inspected_count: Mapped[int] = mapped_column(Integer, default=0)
    qualified_count: Mapped[int] = mapped_column(Integer, default=0)
    collected_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    current_stage: Mapped[str] = mapped_column(String(32), default="search")
    error_summary: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AutomationCandidateRecord(Base):
    __tablename__ = "automation_candidates"
    __table_args__ = (UniqueConstraint("run_id", "offer_id", name="uq_automation_candidate_run_offer"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("automation_runs.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("automation_tasks.id", ondelete="CASCADE"), index=True)
    offer_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(500))
    image_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    price_min: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    sales_90d: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="discovered", index=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    package_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    capture_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_record_id: Mapped[int | None] = mapped_column(ForeignKey("source_products.id", ondelete="SET NULL"), nullable=True)
    shop_id: Mapped[int | None] = mapped_column(ForeignKey("shops.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AutomationEventRecord(Base):
    __tablename__ = "automation_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int | None] = mapped_column(ForeignKey("automation_runs.id", ondelete="CASCADE"), nullable=True, index=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("automation_tasks.id", ondelete="CASCADE"), nullable=True, index=True)
    level: Mapped[str] = mapped_column(String(16), default="info")
    stage: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(String(1000))
    details_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AutomationApprovalBatchRecord(Base):
    __tablename__ = "automation_approval_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    candidate_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    approved_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class BulkListingBatchRecord(Base):
    """Persistent configuration and progress for one homogeneous product batch."""
    __tablename__ = "bulk_listing_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    source_shop_key: Mapped[str] = mapped_column(String(180), index=True)
    source_shop_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Historical batches could point at a sample draft. New generic batches
    # select an Ozon category/type and its attributes directly.
    sample_draft_id: Mapped[int | None] = mapped_column(ForeignKey("listing_drafts.id", ondelete="RESTRICT"), nullable=True, index=True)
    target_shop_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    distribution_mode: Mapped[str] = mapped_column(String(32), default="round_robin")
    rules_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    auto_continue_next_day: Mapped[bool] = mapped_column(Boolean, default=False)
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    prepared_count: Mapped[int] = mapped_column(Integer, default=0)
    needs_review_count: Mapped[int] = mapped_column(Integer, default=0)
    submitted_count: Mapped[int] = mapped_column(Integer, default=0)
    succeeded_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class BulkListingBatchItemRecord(Base):
    """One source product in a bulk listing batch; resumable and auditable."""
    __tablename__ = "bulk_listing_batch_items"
    __table_args__ = (UniqueConstraint("batch_id", "source_product_id", name="uq_bulk_listing_batch_source"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("bulk_listing_batches.id", ondelete="CASCADE"), index=True)
    source_product_id: Mapped[int] = mapped_column(ForeignKey("source_products.id", ondelete="RESTRICT"), index=True)
    candidate_id: Mapped[int | None] = mapped_column(ForeignKey("automation_candidates.id", ondelete="SET NULL"), nullable=True, index=True)
    assigned_shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    listing_draft_id: Mapped[int | None] = mapped_column(ForeignKey("listing_drafts.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    error_message: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    ozon_task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class BulkListingTemplateRecord(Base):
    """Reusable generic homogeneous-listing template, not product-type specific."""
    __tablename__ = "bulk_listing_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    category_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    type_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_shop_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    rules_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class VisualImageJobRecord(Base):
    """Auditable AI image-set draft for one collected product and shop."""
    __tablename__ = "visual_image_jobs"
    __table_args__ = (UniqueConstraint("shop_id", "source_product_id", name="uq_visual_image_job_product"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    source_product_id: Mapped[int] = mapped_column(ForeignKey("source_products.id", ondelete="CASCADE"), index=True)
    listing_draft_id: Mapped[int | None] = mapped_column(ForeignKey("listing_drafts.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    analysis_json: Mapped[str] = mapped_column(Text, default="{}")
    plan_json: Mapped[str] = mapped_column(Text, default="[]")
    generated_images_json: Mapped[str] = mapped_column(Text, default="[]")
    selected_images_json: Mapped[str] = mapped_column(Text, default="[]")
    reference_images_json: Mapped[str] = mapped_column(Text, default="[]")
    error_message: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    image_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    usage_json: Mapped[str] = mapped_column(Text, default="{}")
    # Append-only local evidence for every paid image run and provider call.
    # The job remains the product-level summary used by the editor UI.
    attempt_history_json: Mapped[str] = mapped_column(Text, default="[]")
    current_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    applied_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
