from typing import Literal
from pydantic import BaseModel, Field
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from .database import get_db
from .erp_models import ListingDraftRecord, VisualImageJobRecord
from .visual_image_service import apply_set, queue_set, run_queued_set, serialize

router=APIRouter(prefix="/api/v1",tags=["AI产品图片"])
class GenerateRequest(BaseModel):
    source_product_id:int=Field(gt=0); listing_draft_id:int|None=Field(default=None,gt=0)
    creative_group_key:str=Field(default="__product__", min_length=1, max_length=500)
    slots:list[Literal["hero","dimensions","details","steps","lifestyle","scene_home","scene_entry","scene_gift"]]|None=None
class ApplyRequest(BaseModel):
    listing_draft_id:int=Field(gt=0); selected_urls:list[str]=Field(min_length=1,max_length=15); variant_skus:list[str]=Field(min_length=1,max_length=500); confirm_replace:bool=False

@router.post("/shops/{shop_id}/ai-images/generate", status_code=status.HTTP_202_ACCEPTED)
def generate(shop_id:int,payload:GenerateRequest,background_tasks:BackgroundTasks,db:Session=Depends(get_db)):
    try:
        requested_slots = list(dict.fromkeys(payload.slots or [])) or None
        job, should_start = queue_set(db,shop_id,payload.source_product_id,payload.listing_draft_id,requested_slots,payload.creative_group_key)
        if should_start:
            background_tasks.add_task(run_queued_set,shop_id,payload.source_product_id,payload.listing_draft_id,requested_slots,payload.creative_group_key)
        return serialize(job)
    except ValueError as exc:raise HTTPException(422,str(exc)) from exc
    except Exception as exc:raise HTTPException(502,str(exc)) from exc

@router.get("/shops/{shop_id}/ai-images/source-products/{source_product_id}")
def get_job(shop_id:int,source_product_id:int,creative_group_key:str="__product__",db:Session=Depends(get_db)):
    return serialize(db.scalar(select(VisualImageJobRecord).where(VisualImageJobRecord.shop_id==shop_id,VisualImageJobRecord.source_product_id==source_product_id,VisualImageJobRecord.creative_group_key==creative_group_key)))

@router.post("/shops/{shop_id}/ai-images/jobs/{job_id}/apply")
def apply(shop_id:int,job_id:int,payload:ApplyRequest,db:Session=Depends(get_db)):
    if not payload.confirm_replace:raise HTTPException(409,"必须明确确认替换SKU首图和详情图库")
    job=db.scalar(select(VisualImageJobRecord).where(VisualImageJobRecord.id==job_id,VisualImageJobRecord.shop_id==shop_id)); draft=db.scalar(select(ListingDraftRecord).where(ListingDraftRecord.id==payload.listing_draft_id,ListingDraftRecord.shop_id==shop_id))
    if not job or not draft:raise HTTPException(404,"AI套图任务或草稿不存在")
    if job.source_product_id!=draft.source_product_id:raise HTTPException(409,"AI套图与草稿商品不匹配")
    # A partially failed run may still contain usable generated slots.  Let the
    # operator apply those images; the UI shows the provider error alongside the
    # partial result and the audit record preserves the failed run.
    if job.status not in {"ready", "failed", "interrupted", "applied"} or not job.generated_images_json or job.generated_images_json == "[]":
        raise HTTPException(409,"AI套图没有可使用的已生成图片")
    try:return serialize(apply_set(db,job,draft,payload.selected_urls,"erp-local-operator",payload.variant_skus))
    except ValueError as exc:raise HTTPException(422,str(exc)) from exc
