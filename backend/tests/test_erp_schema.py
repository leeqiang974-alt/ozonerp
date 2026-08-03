from sqlalchemy import create_engine, inspect

from app.database import Base
from app import erp_models  # noqa: F401 - registers operational tables
from app.models import Shop  # noqa: F401 - registers shop tables


def test_operational_tables_are_created() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    tables = set(inspect(engine).get_table_names())
    assert {"products", "skus", "inventory_balances", "fbs_postings", "fbs_posting_lines", "sync_runs", "audit_events", "listing_drafts", "listing_variants", "ozon_category_cache"} <= tables
