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
