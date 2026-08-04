"""Read-through cache for Ozon listing attributes and dictionary values."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .erp_models import OzonAttributeCacheRecord, OzonAttributeDictionaryQueryCacheRecord, OzonAttributeDictionaryValueRecord
from .integrations.ozon_seller import OzonSellerClient
from .sync_service import _credentials

CACHE_FOR = timedelta(hours=24)


def get_category_attributes(db: Session, shop_id: int, category_id: str, type_id: str) -> list[dict]:
    rows = list(db.scalars(select(OzonAttributeCacheRecord).where(
        OzonAttributeCacheRecord.shop_id == shop_id,
        OzonAttributeCacheRecord.category_id == category_id,
        OzonAttributeCacheRecord.type_id == type_id,
    ).order_by(OzonAttributeCacheRecord.required.desc(), OzonAttributeCacheRecord.name)))
    if rows and _is_fresh(max(row.updated_at for row in rows)):
        return [_attribute_dict(row) for row in rows]

    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        response = client.get_category_attributes(category_id=int(category_id), type_id=int(type_id), language="ZH_HANS")
    items = response.get("result", [])
    if not isinstance(items, list):
        raise ValueError("Ozon 类目属性响应格式错误")
    db.query(OzonAttributeCacheRecord).filter(
        OzonAttributeCacheRecord.shop_id == shop_id,
        OzonAttributeCacheRecord.category_id == category_id,
        OzonAttributeCacheRecord.type_id == type_id,
    ).delete()
    for item in items:
        if isinstance(item, dict) and item.get("id") is not None:
            db.add(OzonAttributeCacheRecord(
                shop_id=shop_id,
                category_id=category_id,
                type_id=type_id,
                attribute_id=str(item["id"]),
                name=str(item.get("name") or "未命名属性"),
                required=bool(item.get("is_required")),
                dictionary_id=str(item.get("dictionary_id") or ""),
                value_type=str(item.get("type") or ""),
            ))
    db.commit()
    rows = list(db.scalars(select(OzonAttributeCacheRecord).where(
        OzonAttributeCacheRecord.shop_id == shop_id,
        OzonAttributeCacheRecord.category_id == category_id,
        OzonAttributeCacheRecord.type_id == type_id,
    ).order_by(OzonAttributeCacheRecord.required.desc(), OzonAttributeCacheRecord.name)))
    return [_attribute_dict(row) for row in rows]


def search_category_attribute_values(db: Session, shop_id: int, category_id: str, type_id: str, attribute_id: str, query: str, limit: int = 50) -> list[dict]:
    query = query.strip()
    if len(query) < 2:
        return []
    limit = min(max(limit, 1), 100)
    query_key = query[:100].casefold()
    cached_query = db.scalar(select(OzonAttributeDictionaryQueryCacheRecord).where(
        OzonAttributeDictionaryQueryCacheRecord.shop_id == shop_id,
        OzonAttributeDictionaryQueryCacheRecord.category_id == category_id,
        OzonAttributeDictionaryQueryCacheRecord.type_id == type_id,
        OzonAttributeDictionaryQueryCacheRecord.attribute_id == attribute_id,
        OzonAttributeDictionaryQueryCacheRecord.query_key == query_key,
        OzonAttributeDictionaryQueryCacheRecord.result_limit == limit,
    ))
    if cached_query is not None and _is_fresh(cached_query.updated_at):
        cached_result = json.loads(cached_query.result_json)
        if isinstance(cached_result, list):
            return cached_result

    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        response = client.search_category_attribute_values(category_id=int(category_id), type_id=int(type_id), attribute_id=int(attribute_id), value=query, limit=limit)
    output = response.get("result", [])
    if not isinstance(output, list):
        raise ValueError("Ozon 属性字典搜索响应格式错误")
    for item in output:
        if not isinstance(item, dict) or item.get("id") is None:
            continue
        value_id = str(item["id"])
        row = db.scalar(select(OzonAttributeDictionaryValueRecord).where(
            OzonAttributeDictionaryValueRecord.shop_id == shop_id,
            OzonAttributeDictionaryValueRecord.category_id == category_id,
            OzonAttributeDictionaryValueRecord.type_id == type_id,
            OzonAttributeDictionaryValueRecord.attribute_id == attribute_id,
            OzonAttributeDictionaryValueRecord.value_id == value_id,
        ))
        if row is None:
            row = OzonAttributeDictionaryValueRecord(shop_id=shop_id, category_id=category_id, type_id=type_id, attribute_id=attribute_id, value_id=value_id, value="")
            db.add(row)
        row.value = str(item.get("value") or "")
        row.info = str(item.get("info") or "")
        row.picture = str(item.get("picture") or "")
    result = [_raw_dictionary_value_dict(item) for item in output if isinstance(item, dict) and item.get("id") is not None]
    if cached_query is None:
        cached_query = OzonAttributeDictionaryQueryCacheRecord(shop_id=shop_id, category_id=category_id, type_id=type_id, attribute_id=attribute_id, query_key=query_key, result_limit=limit, result_json="[]")
        db.add(cached_query)
    cached_query.result_json = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    db.commit()
    return result


def _is_fresh(value: datetime) -> bool:
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return datetime.now(timezone.utc) - aware < CACHE_FOR


def _attribute_dict(row: OzonAttributeCacheRecord) -> dict:
    return {"id": row.attribute_id, "name": row.name, "required": row.required, "dictionary_id": row.dictionary_id, "type": row.value_type}


def _raw_dictionary_value_dict(item: dict) -> dict:
    return {"id": str(item["id"]), "value": str(item.get("value") or ""), "info": str(item.get("info") or ""), "picture": str(item.get("picture") or "")}
