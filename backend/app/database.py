from sqlalchemy import create_engine, inspect, text
from sqlalchemy import event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

from .config import get_settings

settings = get_settings()
_is_sqlite = settings.database_url.startswith("sqlite")
connect_args = {"check_same_thread": False, "timeout": 60} if _is_sqlite else {}

# SQLite permits only one writer. Keeping request connections alive in a pool
# lets a crashed worker leave later requests waiting on a stale transaction.
# Open a connection per unit of work and let SQLite wait for an active writer.
engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    poolclass=NullPool if _is_sqlite else None,
    pool_pre_ping=not _is_sqlite,
)


if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _configure_sqlite_connection(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA busy_timeout = 60000")
            cursor.execute("PRAGMA foreign_keys = ON")
        finally:
            cursor.close()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_sqlite_operational_columns() -> None:
    """Apply the small additive migration needed by the local SQLite MVP database."""
    if not settings.database_url.startswith("sqlite"):
        return
    source_link_columns = {column["name"] for column in inspect(engine).get_columns("source_product_shops")}
    if "is_deleted" not in source_link_columns:
        with engine.begin() as connection:
                connection.execute(text("ALTER TABLE source_product_shops ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT 0"))
    # Ozon category, attribute, and dictionary data is platform-global.  Older
    # releases copied these rows into shop-scoped tables; migrate any rows that
    # are not already present so switching the readers to global tables does not
    # discard an existing local installation's cache.
    try:
        with engine.begin() as connection:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS ozon_global_dictionary_query_cache (
                    id INTEGER PRIMARY KEY,
                    category_id VARCHAR(64) NOT NULL,
                    type_id VARCHAR(64) NOT NULL,
                    attribute_id VARCHAR(64) NOT NULL,
                    query_key VARCHAR(100) NOT NULL,
                    result_limit INTEGER NOT NULL,
                    result_json TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_ozon_global_dictionary_query_cache
                        UNIQUE (category_id, type_id, attribute_id, query_key, result_limit)
                )
            """))
            connection.execute(text("""
                INSERT OR IGNORE INTO ozon_global_category_cache
                    (category_id, type_id, title, parent_id, title_zh)
                SELECT category_id, type_id, title, parent_id, title_zh
                FROM ozon_category_cache
            """))
            connection.execute(text("""
                INSERT OR IGNORE INTO ozon_global_attribute_cache
                    (category_id, type_id, attribute_id, name, required, dictionary_id,
                     value_type, complex_id, description, is_collection, is_aspect)
                SELECT category_id, type_id, attribute_id, name, required, dictionary_id,
                       value_type, complex_id, description, is_collection, is_aspect
                FROM ozon_attribute_cache
            """))
            connection.execute(text("""
                INSERT OR IGNORE INTO ozon_global_dict_values
                    (category_id, type_id, attribute_id, value_id, value, info, picture)
                SELECT category_id, type_id, attribute_id, value_id, value, info, picture
                FROM ozon_attribute_dictionary_values
            """))
    except Exception:
        # Fresh/partial test databases may not have the legacy tables yet.
        pass
    existing = {column["name"] for column in inspect(engine).get_columns("fbs_posting_lines")}
    with engine.begin() as connection:
        if "image_url" not in existing:
            connection.execute(text("ALTER TABLE fbs_posting_lines ADD COLUMN image_url VARCHAR(2000)"))
        if "ozon_sku" not in existing:
            connection.execute(text("ALTER TABLE fbs_posting_lines ADD COLUMN ozon_sku VARCHAR(64)"))
        if "image_synced_at" not in existing:
            connection.execute(text("ALTER TABLE fbs_posting_lines ADD COLUMN image_synced_at DATETIME"))
    listing_columns = {column["name"] for column in inspect(engine).get_columns("listing_drafts")}
    if "type_id" not in listing_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE listing_drafts ADD COLUMN type_id VARCHAR(64)"))
    cat_columns = {column["name"] for column in inspect(engine).get_columns("ozon_category_cache")}
    if "title_zh" not in cat_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE ozon_category_cache ADD COLUMN title_zh VARCHAR(500)"))
    # Add complex_id to ozon_attribute_cache for variant attribute identification
    try:
        attr_columns = {column["name"] for column in inspect(engine).get_columns("ozon_attribute_cache")}
        if "complex_id" not in attr_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE ozon_attribute_cache ADD COLUMN complex_id VARCHAR(64) DEFAULT '0'"))
        if "description" not in attr_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE ozon_attribute_cache ADD COLUMN description VARCHAR(2000) DEFAULT ''"))
        if "is_collection" not in attr_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE ozon_attribute_cache ADD COLUMN is_collection BOOLEAN DEFAULT 0"))
        if "is_aspect" not in attr_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE ozon_attribute_cache ADD COLUMN is_aspect BOOLEAN DEFAULT 0"))
    except Exception:
        pass
    # listing_drafts: images_json for full image gallery
    try:
        listing_cols = {column["name"] for column in inspect(engine).get_columns("listing_drafts")}
        if "images_json" not in listing_cols:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE listing_drafts ADD COLUMN images_json TEXT"))
        if "video_url" not in listing_cols:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE listing_drafts ADD COLUMN video_url VARCHAR(2000)"))
        if "watermark_config_json" not in listing_cols:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE listing_drafts ADD COLUMN watermark_config_json TEXT"))
        if "learning_attribute_ids_json" not in listing_cols:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE listing_drafts ADD COLUMN learning_attribute_ids_json TEXT"))
        stock_sync_columns = {
            "import_task_id": "VARCHAR(128)",
            "stock_sync_status": "VARCHAR(32)",
            "stock_sync_message": "VARCHAR(1000)",
            "stock_sync_attempts": "INTEGER DEFAULT 0",
            "stock_sync_next_at": "DATETIME",
            "stock_synced_at": "DATETIME",
        }
        for column_name, column_type in stock_sync_columns.items():
            if column_name not in listing_cols:
                with engine.begin() as connection:
                    connection.execute(text(f"ALTER TABLE listing_drafts ADD COLUMN {column_name} {column_type}"))
    except Exception:
        pass
    # Pipeline products: content_verified flag
    try:
        pipeline_columns = {column["name"] for column in inspect(engine).get_columns("pipeline_products")}
        if "content_verified" not in pipeline_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE pipeline_products ADD COLUMN content_verified BOOLEAN"))
    except Exception:
        pass  # table may not exist yet in fresh test databases
    # pricing_policy: persisted ERP-wide minimum listing price.
    try:
        pricing_columns = {column["name"] for column in inspect(engine).get_columns("pricing_policy")}
        if "listing_price_floor_cny" not in pricing_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE pricing_policy ADD COLUMN listing_price_floor_cny NUMERIC(12, 2) DEFAULT 26.99"))
    except Exception:
        pass  # table may not exist yet in fresh test databases
    # warehouses: warehouse_id for Ozon FBS warehouse ID
    try:
        wh_columns = {column["name"] for column in inspect(engine).get_columns("warehouses")}
        if "warehouse_id" not in wh_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE warehouses ADD COLUMN warehouse_id VARCHAR(64)"))
    except Exception:
        pass
    # Shared strong-identity source snapshots need an explicit per-shop inbox link.
    try:
        with engine.begin() as connection:
            connection.execute(text("""
                INSERT OR IGNORE INTO source_product_shops (source_product_id, shop_id, created_at)
                SELECT id, shop_id, created_at FROM source_products
            """))
    except Exception:
        pass  # table is created by metadata before this additive backfill
    # AI image jobs keep an append-only attempt ledger so a process restart
    # cannot silently erase whether a paid provider call may have been sent.
    try:
        visual_columns = {column["name"] for column in inspect(engine).get_columns("visual_image_jobs")}
        with engine.begin() as connection:
            if "attempt_history_json" not in visual_columns:
                connection.execute(text("ALTER TABLE visual_image_jobs ADD COLUMN attempt_history_json TEXT DEFAULT '[]'"))
            if "current_run_id" not in visual_columns:
                connection.execute(text("ALTER TABLE visual_image_jobs ADD COLUMN current_run_id VARCHAR(64)"))
    except Exception:
        pass  # fresh databases or deployments before the visual-image migration
    try:
        candidate_columns = {column["name"] for column in inspect(engine).get_columns("automation_candidates")}
        if "capture_json" not in candidate_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE automation_candidates ADD COLUMN capture_json TEXT"))
    except Exception:
        pass
    try:
        variant_columns = {column["name"] for column in inspect(engine).get_columns("listing_variants")}
        if "image_urls_json" not in variant_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE listing_variants ADD COLUMN image_urls_json TEXT"))
    except Exception:
        pass
    try:
        source_columns = {column["name"] for column in inspect(engine).get_columns("source_products")}
        with engine.begin() as connection:
            if "source_shop_name" not in source_columns:
                connection.execute(text("ALTER TABLE source_products ADD COLUMN source_shop_name VARCHAR(300)"))
            if "source_shop_key" not in source_columns:
                connection.execute(text("ALTER TABLE source_products ADD COLUMN source_shop_key VARCHAR(180)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_source_products_source_shop_name ON source_products (source_shop_name)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_source_products_source_shop_key ON source_products (source_shop_key)"))
    except Exception:
        pass
    try:
        with engine.begin() as connection:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS bulk_listing_templates (
                    id INTEGER NOT NULL PRIMARY KEY,
                    name VARCHAR(200) NOT NULL UNIQUE,
                    category_id VARCHAR(64),
                    type_id VARCHAR(64),
                    target_shop_ids_json TEXT DEFAULT '[]',
                    rules_json TEXT DEFAULT '{}',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
    except Exception:
        pass



