"""Persistent operational records for the Chinese CNY-only FBS ERP."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
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
    min_price_cny: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
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
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    validation_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
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
    draft: Mapped[ListingDraftRecord] = relationship(back_populates="variants")


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



