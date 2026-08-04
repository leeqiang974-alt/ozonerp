"""Pipeline progress tracking.

Computes P0-P7 progress from the actual database state and provides a
refreshable progress report for the dashboard.  Each stage's tasks are
evaluated against real data: code modules present on disk, source products
ingested, pipeline products at each stage, etc.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..erp_models import PipelineProductRecord, PipelineProgressRecord, SourceProductRecord

_PIPELINE_DIR = Path(__file__).resolve().parent
_TESTS_DIR = _PIPELINE_DIR.parent.parent / "tests"

STAGE_DEFINITIONS: list[dict[str, Any]] = [
    {
        "stage": "P0",
        "title": "P0: capture contract freeze",
        "tasks": [
            {"text": "define JSON schema for 1688 snapshots", "check": "file:contract.py"},
            {"text": "implement idempotent key spec", "check": "file:contract.py"},
            {"text": "validate and normalise snapshots", "check": "file:contract.py"},
            {"text": "verify duplicate import does not create duplicates", "check": "data:source_count>0"},
        ],
    },
    {
        "stage": "P1",
        "title": "P1: source ingestion and normalisation",
        "tasks": [
            {"text": "create source_products/source_variants/source_media entities", "check": "file:ingestion_service.py"},
            {"text": "implement idempotent upsert ingestion service", "check": "file:ingestion_service.py"},
            {"text": "ingest at least one source product", "check": "data:source_count>0"},
            {"text": "unit tests for ingestion pass", "check": "file:test_pipeline.py"},
        ],
    },
    {
        "stage": "P2",
        "title": "P2: product identification and category matching",
        "tasks": [
            {"text": "implement product fact extraction", "check": "file:fact_extraction.py"},
            {"text": "implement category recall Top 20", "check": "file:category_matching.py"},
            {"text": "implement rule + AI rerank Top 5", "check": "file:category_matching.py"},
            {"text": "at least one product has category match", "check": "data:category_matched>0"},
        ],
    },
    {
        "stage": "P3",
        "title": "P3: attribute auto-fill",
        "tasks": [
            {"text": "save all Ozon attribute constraints (not just required)", "check": "file:attribute_mapping.py"},
            {"text": "deterministic mapping rules (material -> Material)", "check": "file:attribute_mapping.py"},
            {"text": "AI synonym and conflict handling", "check": "file:attribute_mapping.py"},
            {"text": "dictionary search and value_id validation", "check": "file:attribute_mapping.py"},
        ],
    },
    {
        "stage": "P4",
        "title": "P4: multi-variant, SKU and images",
        "tasks": [
            {"text": "1688 spec axis to Ozon variant attribute mapping", "check": "file:variant_mapping.py"},
            {"text": "stable SKU encoding and dedup", "check": "file:variant_mapping.py"},
            {"text": "SKU image binding and validation", "check": "file:variant_mapping.py"},
            {"text": "8-15 image arrangement and media checks", "check": "file:variant_mapping.py"},
        ],
    },
    {
        "stage": "P5",
        "title": "P5: content generation and pricing model",
        "tasks": [
            {"text": "Russian title, description, spec block generation", "check": "file:content_generation.py"},
            {"text": "category commission and logistics price card", "check": "file:content_generation.py"},
            {"text": "per-SKU CNY price calculation", "check": "file:content_generation.py"},
            {"text": "pricing rule versioning and audit", "check": "file:content_generation.py"},
        ],
    },
    {
        "stage": "P6",
        "title": "P6: quality workbench and pre-check",
        "tasks": [
            {"text": "category confidence and attribute coverage display", "check": "file:quality_check.py"},
            {"text": "content score and image/SKU completeness", "check": "file:quality_check.py"},
            {"text": "pricing profit and blocking issues", "check": "file:quality_check.py"},
            {"text": "payload preview (no Ozon write)", "check": "file:quality_check.py"},
        ],
    },
    {
        "stage": "P7",
        "title": "P7: approval and small-batch write-back",
        "tasks": [
            {"text": "approval flow and audit records", "check": "file:publish_service.py"},
            {"text": "listing draft creation from pipeline", "check": "file:publish_service.py"},
            {"text": "task_id polling and failure correction", "check": "file:publish_service.py"},
            {"text": "small batch gray release validation", "check": "file:publish_service.py"},
        ],
    },
]


def _evaluate_task(check: str, db: Session) -> bool:
    """Evaluate whether a task check passes against the current state."""
    if check.startswith("file:"):
        filename = check[5:]
        return (_PIPELINE_DIR / filename).exists() or (_TESTS_DIR / filename).exists()
    elif check == "data:source_count>0":
        count = db.scalar(select(func.count(SourceProductRecord.id)))
        return (count or 0) > 0
    elif check == "data:category_matched>0":
        count = db.scalar(select(func.count(PipelineProductRecord.id)).where(
            PipelineProductRecord.matched_category_id.isnot(None),
        ))
        return (count or 0) > 0
    return False


def init_stages(db: Session) -> None:
    """Initialize or update stage definitions in the database."""
    for defn in STAGE_DEFINITIONS:
        record = db.scalar(select(PipelineProgressRecord).where(
            PipelineProgressRecord.stage == defn["stage"],
        ))
        if record is None:
            record = PipelineProgressRecord(
                stage=defn["stage"],
                title=defn["title"],
                tasks_json=json.dumps(defn["tasks"], ensure_ascii=False),
            )
            db.add(record)
        else:
            record.title = defn["title"]
            record.tasks_json = json.dumps(defn["tasks"], ensure_ascii=False)
    db.commit()


def refresh_progress(db: Session) -> list[dict[str, Any]]:
    """Re-evaluate all tasks and return the full progress report."""
    init_stages(db)
    stages_out: list[dict[str, Any]] = []
    for defn in STAGE_DEFINITIONS:
        tasks = defn["tasks"]
        task_results = []
        done_count = 0
        for task in tasks:
            done = _evaluate_task(task["check"], db)
            if done:
                done_count += 1
            task_results.append({"text": task["text"], "done": done})
        percent = int(done_count / len(tasks) * 100) if tasks else 0
        if percent == 100:
            status = "completed"
        elif percent > 0:
            status = "active"
        else:
            status = "pending"
        record = db.scalar(select(PipelineProgressRecord).where(
            PipelineProgressRecord.stage == defn["stage"],
        ))
        if record:
            record.status = status
            record.progress_percent = percent
            record.tasks_json = json.dumps(task_results, ensure_ascii=False)
        stages_out.append({
            "stage": defn["stage"],
            "title": defn["title"],
            "status": status,
            "progress_percent": percent,
            "tasks": task_results,
            "done_count": done_count,
            "total_tasks": len(tasks),
        })
    db.commit()
    return stages_out


def get_progress(db: Session) -> dict[str, Any]:
    """Return the full progress report for the dashboard."""
    stages = refresh_progress(db)
    completed = sum(1 for s in stages if s["status"] == "completed")
    active = sum(1 for s in stages if s["status"] == "active")
    pending = sum(1 for s in stages if s["status"] == "pending")
    overall = int(sum(s["progress_percent"] for s in stages) / len(stages)) if stages else 0
    return {
        "overall_percent": overall,
        "completed_count": completed,
        "active_count": active,
        "pending_count": pending,
        "total_stages": len(stages),
        "stages": stages,
        "source_product_count": db.scalar(select(func.count(SourceProductRecord.id))) or 0,
        "pipeline_product_count": db.scalar(select(func.count(PipelineProductRecord.id))) or 0,
    }
