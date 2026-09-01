"""Global Ozon listing-cache migration helpers.

The legacy tables include ``shop_id`` because early versions treated Ozon
metadata as shop-scoped.  Ozon category/attribute/dictionary metadata is
platform-wide, so application code must read only the global tables.  This
module performs an idempotent promotion of any legacy rows that may still be
present (including isolated test databases that do not run startup hooks).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .erp_models import (
    OzonAttributeCacheRecord,
    OzonAttributeDictionaryValueRecord,
    OzonCategoryCacheRecord,
    OzonGlobalAttributeCacheRecord,
    OzonGlobalCategoryCacheRecord,
    OzonGlobalDictValueRecord,
)


def promote_legacy_listing_caches(
    db: Session,
    *,
    category_id: str | None = None,
    type_id: str | None = None,
) -> None:
    """Merge legacy shop rows into the global cache without selecting a shop.

    Existing global values win.  The helper only flushes newly promoted rows;
    the caller owns the transaction and can commit together with its normal
    operation.
    """
    scope = (str(category_id) if category_id is not None else "*", str(type_id) if type_id is not None else "*")
    migrated_scopes = db.info.setdefault("legacy_listing_cache_scopes", set())
    if scope in migrated_scopes:
        return
    # Normal production databases are migrated at startup.  Avoid scanning the
    # 100k+ row legacy tables on every unscoped request once a global snapshot
    # already exists; scoped calls below still repair a newly encountered pair.
    if category_id is None and type_id is None and db.scalar(select(OzonGlobalCategoryCacheRecord.id).limit(1)) is not None:
        migrated_scopes.add(scope)
        return

    category_filter = []
    if category_id is not None:
        category_filter.append(OzonCategoryCacheRecord.category_id == str(category_id))
    if type_id is not None:
        category_filter.append(OzonCategoryCacheRecord.type_id == str(type_id))

    existing_category_stmt = select(OzonGlobalCategoryCacheRecord.category_id, OzonGlobalCategoryCacheRecord.type_id)
    if category_id is not None:
        existing_category_stmt = existing_category_stmt.where(OzonGlobalCategoryCacheRecord.category_id == str(category_id))
    if type_id is not None:
        existing_category_stmt = existing_category_stmt.where(OzonGlobalCategoryCacheRecord.type_id == str(type_id))
    existing_categories = {(str(cat), str(typ)) for cat, typ in db.execute(existing_category_stmt)}
    for row in db.scalars(select(OzonCategoryCacheRecord).where(*category_filter)):
        key = (str(row.category_id), str(row.type_id))
        if key in existing_categories:
            continue
        db.add(OzonGlobalCategoryCacheRecord(
            category_id=key[0], type_id=key[1], title=row.title,
            parent_id=row.parent_id, title_zh=row.title_zh,
        ))
        existing_categories.add(key)

    attr_filter = []
    if category_id is not None:
        attr_filter.append(OzonAttributeCacheRecord.category_id == str(category_id))
    if type_id is not None:
        attr_filter.append(OzonAttributeCacheRecord.type_id == str(type_id))
    existing_attribute_stmt = select(
        OzonGlobalAttributeCacheRecord.category_id,
        OzonGlobalAttributeCacheRecord.type_id,
        OzonGlobalAttributeCacheRecord.attribute_id,
    )
    if category_id is not None:
        existing_attribute_stmt = existing_attribute_stmt.where(OzonGlobalAttributeCacheRecord.category_id == str(category_id))
    if type_id is not None:
        existing_attribute_stmt = existing_attribute_stmt.where(OzonGlobalAttributeCacheRecord.type_id == str(type_id))
    existing_attributes = {(str(cat), str(typ), str(attr)) for cat, typ, attr in db.execute(existing_attribute_stmt)}
    for row in db.scalars(select(OzonAttributeCacheRecord).where(*attr_filter)):
        key = (str(row.category_id), str(row.type_id), str(row.attribute_id))
        if key in existing_attributes:
            continue
        db.add(OzonGlobalAttributeCacheRecord(
            category_id=key[0], type_id=key[1], attribute_id=key[2],
            name=row.name, required=row.required, dictionary_id=row.dictionary_id,
            value_type=row.value_type, complex_id=row.complex_id,
            description=row.description, is_collection=row.is_collection,
            is_aspect=row.is_aspect,
        ))
        existing_attributes.add(key)

    dict_filter = []
    if category_id is not None:
        dict_filter.append(OzonAttributeDictionaryValueRecord.category_id == str(category_id))
    if type_id is not None:
        dict_filter.append(OzonAttributeDictionaryValueRecord.type_id == str(type_id))
    existing_value_stmt = select(
        OzonGlobalDictValueRecord.category_id,
        OzonGlobalDictValueRecord.type_id,
        OzonGlobalDictValueRecord.attribute_id,
        OzonGlobalDictValueRecord.value_id,
    )
    if category_id is not None:
        existing_value_stmt = existing_value_stmt.where(OzonGlobalDictValueRecord.category_id == str(category_id))
    if type_id is not None:
        existing_value_stmt = existing_value_stmt.where(OzonGlobalDictValueRecord.type_id == str(type_id))
    existing_values = {(str(cat), str(typ), str(attr), str(value)) for cat, typ, attr, value in db.execute(existing_value_stmt)}
    for row in db.scalars(select(OzonAttributeDictionaryValueRecord).where(*dict_filter)):
        key = (str(row.category_id), str(row.type_id), str(row.attribute_id), str(row.value_id))
        if key in existing_values:
            continue
        db.add(OzonGlobalDictValueRecord(
            category_id=key[0], type_id=key[1], attribute_id=key[2], value_id=key[3],
            value=row.value, info=row.info, picture=row.picture,
        ))
        existing_values.add(key)
    migrated_scopes.add(scope)
