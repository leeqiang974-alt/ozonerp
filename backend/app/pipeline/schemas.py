"""Pydantic schemas for the pipeline API."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class SourceVariantInput(BaseModel):
    source_sku: str = Field(min_length=1, max_length=128)
    spec_name: str = Field(min_length=1, max_length=500)
    price_cny: Decimal | None = Field(default=None, ge=0)
    stock: int = Field(default=0, ge=0)
    image_url: str | None = Field(default=None, max_length=2000)


class SourceMediaInput(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    media_type: str = Field(default="image", max_length=16)
    sort_order: int = Field(default=0)
    is_primary: bool = Field(default=False)


class SourceProductIngest(BaseModel):
    source_platform: str = Field(default="1688", max_length=32)
    source_product_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=500)
    source_url: str | None = Field(default=None, max_length=2000)
    main_image_url: str | None = Field(default=None, max_length=2000)
    category_hint: str | None = Field(default=None, max_length=500)
    brand: str | None = Field(default=None, max_length=200)
    material: str | None = Field(default=None, max_length=200)
    variants: list[SourceVariantInput] = Field(default_factory=list)
    media: list[SourceMediaInput] = Field(default_factory=list)


class SourceProductRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    shop_id: int
    source_platform: str
    source_product_id: str
    source_url: str | None
    title: str
    main_image_url: str | None
    category_hint: str | None
    brand: str | None
    material: str | None
    ingestion_status: str
    created_at: datetime
    updated_at: datetime


class CategoryLockRequest(BaseModel):
    category_id: str = Field(min_length=1, max_length=64)
    type_id: str = Field(min_length=1, max_length=64)


class ApproveRequest(BaseModel):
    approver_id: str = Field(min_length=1, max_length=128)


class PipelineProgressTask(BaseModel):
    text: str
    done: bool


class PipelineProgressStage(BaseModel):
    stage: str
    title: str
    status: str
    progress_percent: int
    tasks: list[PipelineProgressTask]
    done_count: int
    total_tasks: int


class PipelineProgressReport(BaseModel):
    overall_percent: int
    completed_count: int
    active_count: int
    pending_count: int
    total_stages: int
    stages: list[PipelineProgressStage]
    source_product_count: int
    pipeline_product_count: int
