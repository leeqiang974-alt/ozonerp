"""Repair and complete the operational schema.

The first production iterations used ``Base.metadata.create_all`` while the
Alembic history only contained the small MVP tables.  That left fresh
PostgreSQL databases unable to upgrade (later revisions referenced tables that
were never in the history) and left existing databases with a mixture of
partial tables and columns.  This revision is deliberately additive: it
creates every ORM table that is missing and adds missing columns/indexes to
tables created by the old history.  Existing rows are never deleted.

The operation is written against SQLAlchemy metadata so new tables cannot drift
from the application model.  ``checkfirst``/introspection makes it safe for a
database that already contains part of the schema, including databases that
were initialized with ``create_all`` before Alembic was introduced.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from alembic import op
from alembic import context
from sqlalchemy import inspect

from app.database import Base
from app import erp_models  # noqa: F401 - register all operational models
from app import models  # noqa: F401 - register shop/warehouse models


revision = "e5f6a7b8c9d0"
down_revision = "d4a8c1f2b6e0"
branch_labels = None
depends_on = None


def _literal_server_default(value: Any, bind: sa.Connection) -> sa.TextClause | None:
    """Return a portable server default for a Python-side scalar default.

    Old tables may already contain rows.  A non-null column therefore needs a
    temporary SQL default while it is added.  The ORM's Python default remains
    authoritative for future inserts; keeping the SQL default is harmless and
    avoids a table rewrite/backfill race during deployment.
    """

    if value is None or callable(value):
        return None
    if isinstance(value, bool):
        return sa.text("TRUE" if value else "FALSE")
    if isinstance(value, (int, float)):
        return sa.text(str(value))
    # Decimal and other scalar numeric values stringify safely.  Strings are
    # quoted explicitly because server_default receives SQL, not a bind value.
    if isinstance(value, str):
        escaped = value.replace("'", "''")
        return sa.text(f"'{escaped}'")
    return sa.text(str(value))


def _column_for_add(column: sa.Column[Any], bind: sa.Connection) -> sa.Column[Any]:
    """Clone a metadata column and make old-row additions safe."""

    # ``Column.copy()`` does not retain a server default when the returned
    # column is detached from its table, which made offline SQL render a
    # ``NOT NULL`` column with no default.  Construct a fresh detached Column
    # explicitly instead.
    server_default = column.server_default
    if not column.nullable and server_default is None and column.default is not None:
        server_default = _literal_server_default(column.default.arg, bind)
    return sa.Column(
        column.name,
        column.type,
        nullable=column.nullable,
        server_default=server_default,
        index=bool(column.index),
    )


def _ensure_columns(bind: sa.Connection) -> None:
    inspector = inspect(bind)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue
        existing = {column["name"] for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name not in existing:
                op.add_column(table.name, _column_for_add(column, bind))
        # Refresh after ALTER TABLE because later checks must see the new
        # columns.  This also avoids stale inspector caches on PostgreSQL.
        inspector = inspect(bind)


def _ensure_indexes(bind: sa.Connection) -> None:
    """Create metadata indexes that old ``create_all``/MVP schemas lack."""

    inspector = inspect(bind)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue
        existing = {index["name"] for index in inspector.get_indexes(table.name)}
        for index in table.indexes:
            if index.name and index.name not in existing:
                index.create(bind=bind, checkfirst=True)
        inspector = inspect(bind)


_MVP_TABLES = {
    "shops", "api_credentials", "audit_events", "listing_drafts",
    "ozon_category_cache", "products", "sync_runs", "sync_states",
    "warehouses", "fbs_postings", "listing_variants", "skus",
    "fbs_posting_lines", "inventory_balances", "ozon_attribute_cache",
    "ozon_attribute_dictionary_values", "ozon_attribute_dictionary_query_cache",
    "listing_attribute_values", "ozon_global_dictionary_query_cache",
}

_MVP_MISSING_COLUMNS = {
    "listing_drafts": (
        "video_url", "images_json", "watermark_config_json",
        "learning_attribute_ids_json", "source_product_id", "ozon_product_id",
        "moderation_status", "ozon_issues_json", "quality_rating", "import_task_id",
        "stock_sync_status", "stock_sync_message", "stock_sync_attempts",
        "stock_sync_next_at", "stock_synced_at",
    ),
    "listing_variants": (
        "barcode", "stock", "name_ru", "image_url", "price_cny",
        "variant_values_json",
    ),
    "warehouses": ("warehouse_id",),
    "ozon_category_cache": ("title_zh",),
    "ozon_attribute_cache": ("complex_id", "description", "is_collection", "is_aspect"),
}


def _offline_repair(bind: sa.Connection) -> None:
    """Render a valid fresh-database SQL plan without an Inspector.

    Alembic's ``--sql`` mode uses a mock connection that cannot answer
    ``has_table``/``get_columns``.  The historical MVP tables are known and
    are already created by revisions 534/6e/cf/d4; emit only the tables and
    columns that the repair revision owns.
    """

    for table in Base.metadata.sorted_tables:
        if table.name not in _MVP_TABLES:
            table.create(bind=bind, checkfirst=False)
    for table_name, column_names in _MVP_MISSING_COLUMNS.items():
        table = Base.metadata.tables[table_name]
        for column_name in column_names:
            op.add_column(table_name, _column_for_add(table.c[column_name], bind))
    # The old MVP declared this price as NUMERIC while the application stores
    # it as a formatted string.  Emit the PostgreSQL conversion for fresh
    # production SQL; SQLite's online path performs the batch alteration.
    if bind.dialect.name == "postgresql":
        op.alter_column(
            "skus", "min_price_cny", existing_type=sa.Numeric(14, 2),
            type_=sa.String(32), postgresql_using="min_price_cny::text",
        )


def _ensure_legacy_type_compatibility(bind: sa.Connection) -> None:
    """Align the one MVP column whose ORM contract changed type.

    The initial migration declared ``skus.min_price_cny`` as NUMERIC while the
    application has always treated it as an Ozon price string (it may contain
    formatting or a range).  Convert existing numeric values to text without
    dropping the column or its rows.
    """

    inspector = inspect(bind)
    if not inspector.has_table("skus"):
        return
    column = next((item for item in inspector.get_columns("skus") if item["name"] == "min_price_cny"), None)
    if column is None or not isinstance(column.get("type"), sa.Numeric):
        return
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("skus", recreate="always") as batch:
            batch.alter_column(
                "min_price_cny",
                existing_type=sa.Numeric(14, 2),
                type_=sa.String(32),
            )
    elif bind.dialect.name == "postgresql":
        op.alter_column(
            "skus",
            "min_price_cny",
            existing_type=sa.Numeric(14, 2),
            type_=sa.String(32),
            postgresql_using="min_price_cny::text",
        )
    else:
        op.alter_column(
            "skus",
            "min_price_cny",
            existing_type=sa.Numeric(14, 2),
            type_=sa.String(32),
        )


def upgrade() -> None:
    bind = op.get_bind()

    if context.is_offline_mode():
        _offline_repair(bind)
        return

    # ``sorted_tables`` orders foreign-key parents before children.  A table
    # can still be present from an older partial migration, in which case
    # ``checkfirst`` leaves it untouched and the additive passes below repair
    # its columns/indexes.
    for table in Base.metadata.sorted_tables:
        table.create(bind=bind, checkfirst=True)

    _ensure_columns(bind)
    _ensure_legacy_type_compatibility(bind)
    _ensure_indexes(bind)


def downgrade() -> None:
    # This revision only repairs/extends existing operational data.  A
    # destructive downgrade would either delete user data or recreate the
    # migration hole this revision fixes, so it is intentionally irreversible.
    raise RuntimeError("e5f6a7b8c9d0 is an additive schema repair and cannot be downgraded safely")
