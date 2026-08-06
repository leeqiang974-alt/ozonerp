from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import get_settings

settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=not settings.database_url.startswith("sqlite"))
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
    # Pipeline products: content_verified flag
    try:
        pipeline_columns = {column["name"] for column in inspect(engine).get_columns("pipeline_products")}
        if "content_verified" not in pipeline_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE pipeline_products ADD COLUMN content_verified BOOLEAN"))
    except Exception:
        pass  # table may not exist yet in fresh test databases



