"""Persistence helpers for reusable listing form templates."""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from .erp_models import ListingTemplateRecord


def create_listing_template(
    db: Session,
    shop_id: int,
    name: str,
    category_id: str,
    type_id: str,
    attributes: list[dict],
    *,
    description: str | None = None,
) -> ListingTemplateRecord:
    template = ListingTemplateRecord(
        shop_id=shop_id,
        name=name.strip(),
        category_id=str(category_id),
        type_id=str(type_id),
        attributes_json=json.dumps(attributes, ensure_ascii=False),
        description=description,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


def apply_listing_template(template: ListingTemplateRecord) -> dict:
    try:
        attributes = json.loads(template.attributes_json or "[]")
    except json.JSONDecodeError:
        attributes = []
    return {
        "id": template.id,
        "name": template.name,
        "category_id": template.category_id,
        "type_id": template.type_id,
        "description": template.description,
        "attributes": attributes if isinstance(attributes, list) else [],
    }
