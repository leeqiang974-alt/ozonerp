"""Persistent operational records for the Chinese CNY-only FBS ERP."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
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


class OzonCategoryCacheRecord(Base):
    __tablename__ = "ozon_category_cache"
    __table_args__ = (UniqueConstraint("shop_id", "category_id", "type_id", name="uq_category_cache"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"), index=True)
    category_id: Mapped[str] = mapped_column(String(64))
    type_id: Mapped[str] = mapped_column(String(64), default="")
    title: Mapped[str] = mapped_column(String(500))
    parent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
