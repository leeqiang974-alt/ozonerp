from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Shop(Base):
    __tablename__ = "shops"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    legal_entity: Mapped[str | None] = mapped_column(String(160), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="CNY")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Shanghai")
    manager_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    warehouses: Mapped[list["Warehouse"]] = relationship(back_populates="shop", cascade="all, delete-orphan")
    credentials: Mapped[list["ApiCredential"]] = relationship(back_populates="shop", cascade="all, delete-orphan")


class Warehouse(Base):
    __tablename__ = "warehouses"
    __table_args__ = (UniqueConstraint("shop_id", "name", name="uq_warehouse_shop_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    pickup_point: Mapped[str | None] = mapped_column(String(160), nullable=True)
    cutoff_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    workdays: Mapped[str | None] = mapped_column(String(64), nullable=True)
    carrier: Mapped[str | None] = mapped_column(String(120), nullable=True)
    shop: Mapped[Shop] = relationship(back_populates="warehouses")


class ApiCredential(Base):
    """Credential metadata only. Never expose or persist plaintext API secrets here."""

    __tablename__ = "api_credentials"
    __table_args__ = (UniqueConstraint("shop_id", "provider", name="uq_credential_shop_provider"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(40), default="ozon")
    client_id_reference: Mapped[str | None] = mapped_column(String(160), nullable=True)
    encrypted_secret_placeholder: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_identifier: Mapped[str | None] = mapped_column(String(160), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="not_configured")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    shop: Mapped[Shop] = relationship(back_populates="credentials")
