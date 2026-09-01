"""Read-through cache for Ozon listing attributes and dictionary values.

Ozon 类目、属性、字典值是平台全局数据，不以店铺区分。
全局表 (ozon_global_*) 作为读取主源，店铺表保留用于兼容和同步追踪。
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .erp_models import (
    OzonGlobalAttributeCacheRecord,
    OzonGlobalDictionaryQueryCacheRecord,
    OzonGlobalDictValueRecord,
)
from .integrations.ozon_seller import OzonSellerClient
from .sync_service import _credentials
from .listing_cache_service import promote_legacy_listing_caches

CACHE_FOR = timedelta(hours=24)


def get_category_attributes(db: Session, shop_id: int, category_id: str, type_id: str) -> list[dict]:
    """读取全局类目属性缓存；店铺只提供 API 凭据，不参与缓存隔离。"""
    promote_legacy_listing_caches(db, category_id=category_id, type_id=type_id)
    # 1. 先查全局缓存
    global_rows = list(db.scalars(select(OzonGlobalAttributeCacheRecord).where(
        OzonGlobalAttributeCacheRecord.category_id == category_id,
        OzonGlobalAttributeCacheRecord.type_id == type_id,
    ).order_by(OzonGlobalAttributeCacheRecord.required.desc(), OzonGlobalAttributeCacheRecord.name)))
    if global_rows and _is_fresh(max(row.updated_at for row in global_rows)):
        return [_global_attribute_dict(row) for row in global_rows]

    # 2. 从 Ozon API 拉取
    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        response = client.get_category_attributes(category_id=int(category_id), type_id=int(type_id), language="ZH_HANS")
    items = response.get("result", [])
    if not isinstance(items, list):
        raise ValueError("Ozon 类目属性响应格式错误")

    # 3. 写入全局表（upsert 风格：先删后插）。shop_id 仅用于 API 凭据。
    db.query(OzonGlobalAttributeCacheRecord).filter(
        OzonGlobalAttributeCacheRecord.category_id == category_id,
        OzonGlobalAttributeCacheRecord.type_id == type_id,
    ).delete()
    for item in items:
        if isinstance(item, dict) and item.get("id") is not None:
            attr_id = str(item["id"])
            name = str(item.get("name") or "未命名属性")
            required = bool(item.get("is_required"))
            dictionary_id = str(item.get("dictionary_id") or "")
            value_type = str(item.get("type") or "")
            complex_id = str(item.get("attribute_complex_id") or item.get("complex_id") or "0")
            description = str(item.get("description") or "")[:2000]
            is_collection = bool(item.get("is_collection"))
            is_aspect = bool(item.get("is_aspect"))

            db.add(OzonGlobalAttributeCacheRecord(
                category_id=category_id, type_id=type_id, attribute_id=attr_id,
                name=name, required=required, dictionary_id=dictionary_id,
                value_type=value_type, complex_id=complex_id,
                description=description, is_collection=is_collection, is_aspect=is_aspect,
            ))
    db.commit()

    # 5. 从全局表读取返回
    rows = list(db.scalars(select(OzonGlobalAttributeCacheRecord).where(
        OzonGlobalAttributeCacheRecord.category_id == category_id,
        OzonGlobalAttributeCacheRecord.type_id == type_id,
    ).order_by(OzonGlobalAttributeCacheRecord.required.desc(), OzonGlobalAttributeCacheRecord.name)))
    return [_global_attribute_dict(row) for row in rows]


def search_category_attribute_values(db: Session, shop_id: int, category_id: str, type_id: str, attribute_id: str, query: str, limit: int = 50) -> list[dict]:
    """搜索字典值——优先查全局字典表，查询缓存和字典值都同步写入全局表。"""
    promote_legacy_listing_caches(db, category_id=category_id, type_id=type_id)
    query = query.strip()
    limit = min(max(limit, 1), 100)
    query_key = query[:100].casefold() if query else "__all__"

    query_cache = db.scalar(select(OzonGlobalDictionaryQueryCacheRecord).where(
        OzonGlobalDictionaryQueryCacheRecord.category_id == category_id,
        OzonGlobalDictionaryQueryCacheRecord.type_id == type_id,
        OzonGlobalDictionaryQueryCacheRecord.attribute_id == attribute_id,
        OzonGlobalDictionaryQueryCacheRecord.query_key == query_key,
        OzonGlobalDictionaryQueryCacheRecord.result_limit == limit,
    ))

    # 1. 先查全局字典值表；没有命中时再使用全局查询缓存（包括空结果）。
    if query:
        global_matches = list(db.scalars(select(OzonGlobalDictValueRecord).where(
            OzonGlobalDictValueRecord.category_id == category_id,
            OzonGlobalDictValueRecord.type_id == type_id,
            OzonGlobalDictValueRecord.attribute_id == attribute_id,
            OzonGlobalDictValueRecord.value.like("%" + query + "%"),
        ).limit(limit)))
        if global_matches:
            return [_global_dict_value_dict(row) for row in global_matches]
    else:
        # 空查询：返回全局字典值表前 limit 条
        global_matches = list(db.scalars(select(OzonGlobalDictValueRecord).where(
            OzonGlobalDictValueRecord.category_id == category_id,
            OzonGlobalDictValueRecord.type_id == type_id,
            OzonGlobalDictValueRecord.attribute_id == attribute_id,
        ).limit(limit)))
        if global_matches:
            return [_global_dict_value_dict(row) for row in global_matches]
    if query_cache is not None and _is_fresh(query_cache.updated_at):
        try:
            cached_result = json.loads(query_cache.result_json or "[]")
            if isinstance(cached_result, list):
                return cached_result
        except (TypeError, json.JSONDecodeError):
            pass

    # 2. 全局没有，从 Ozon API 拉取
    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        if not query:
            response = client.get_category_attribute_values(
                category_id=int(category_id), type_id=int(type_id),
                attribute_id=int(attribute_id), limit=limit)
        else:
            try:
                response = client.search_category_attribute_values(
                    category_id=int(category_id), type_id=int(type_id),
                    attribute_id=int(attribute_id), value=query, limit=limit)
            except Exception:
                response = client.get_category_attribute_values(
                    category_id=int(category_id), type_id=int(type_id),
                    attribute_id=int(attribute_id), limit=limit)
                raw_values = response.get("result", [])
                response = {**response, "result": [
                    item for item in raw_values
                    if query.casefold() in str(item.get("value") or "").casefold()
                ]}
    output = response.get("result", [])
    if not isinstance(output, list):
        raise ValueError("Ozon 属性字典搜索响应格式错误")

    # 3. 写入全局字典值表
    for item in output:
        if not isinstance(item, dict) or item.get("id") is None:
            continue
        value_id = str(item["id"])
        val = str(item.get("value") or "")
        info = str(item.get("info") or "")
        picture = str(item.get("picture") or "")

        # 全局表 upsert
        global_row = db.scalar(select(OzonGlobalDictValueRecord).where(
            OzonGlobalDictValueRecord.category_id == category_id,
            OzonGlobalDictValueRecord.type_id == type_id,
            OzonGlobalDictValueRecord.attribute_id == attribute_id,
            OzonGlobalDictValueRecord.value_id == value_id,
        ))
        if global_row is None:
            db.add(OzonGlobalDictValueRecord(
                category_id=category_id, type_id=type_id, attribute_id=attribute_id,
                value_id=value_id, value=val, info=info, picture=picture,
            ))
        else:
            global_row.value = val
            global_row.info = info
            global_row.picture = picture

    result = [_raw_dictionary_value_dict(item) for item in output if isinstance(item, dict) and item.get("id") is not None]
    if query_cache is None:
        query_cache = OzonGlobalDictionaryQueryCacheRecord(
            category_id=category_id, type_id=type_id, attribute_id=attribute_id,
            query_key=query_key, result_limit=limit, result_json="[]",
        )
        db.add(query_cache)
    query_cache.result_json = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    db.commit()
    return result


def get_cached_category_attribute_values(
    db: Session, category_id: str, type_id: str, *, limit_per_attribute: int = 100,
) -> dict[str, list[dict]]:
    """Return locally cached dictionary options for a category/type pair.

    This endpoint is deliberately read-only and never calls Ozon.  A category
    can have very large dictionaries, so the editor receives a bounded local
    sample and falls back to the normal search endpoint only when a requested
    value is not already cached.
    """
    promote_legacy_listing_caches(db, category_id=category_id, type_id=type_id)
    rows = db.execute(
        select(OzonGlobalDictValueRecord).where(
            OzonGlobalDictValueRecord.category_id == str(category_id),
            OzonGlobalDictValueRecord.type_id == str(type_id),
        ).order_by(
            OzonGlobalDictValueRecord.attribute_id,
            OzonGlobalDictValueRecord.value,
        )
    ).scalars().all()
    values: dict[str, list[dict]] = {}
    cap = min(max(int(limit_per_attribute), 1), 200)
    for row in rows:
        bucket = values.setdefault(str(row.attribute_id), [])
        if len(bucket) < cap:
            bucket.append(_global_dict_value_dict(row))
    return values


def _is_fresh(value: datetime) -> bool:
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return datetime.now(timezone.utc) - aware < CACHE_FOR


def _global_attribute_dict(row: OzonGlobalAttributeCacheRecord) -> dict:
    return {"id": row.attribute_id, "name": row.name, "required": row.required,
            "dictionary_id": row.dictionary_id, "type": row.value_type,
            "complex_id": row.complex_id, "description": row.description,
            "is_collection": row.is_collection, "is_aspect": row.is_aspect}


def _global_dict_value_dict(row: OzonGlobalDictValueRecord) -> dict:
    return {"id": row.value_id, "value": row.value, "info": row.info or "", "picture": row.picture or ""}


def _raw_dictionary_value_dict(item: dict) -> dict:
    return {"id": str(item["id"]), "value": str(item.get("value") or ""),
            "info": str(item.get("info") or ""), "picture": str(item.get("picture") or "")}
