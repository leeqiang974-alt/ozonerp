from sqlalchemy import create_engine, inspect

from app.database import Base
from app import erp_models  # noqa: F401 - registers operational tables
from app.models import Shop  # noqa: F401 - registers shop tables


def test_operational_tables_are_created() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    tables = set(inspect(engine).get_table_names())
    assert {"products", "skus", "inventory_balances", "fbs_postings", "fbs_posting_lines", "sync_runs", "sync_states", "audit_events", "listing_drafts", "listing_variants", "ozon_category_cache"} <= tables


def test_sync_state_has_one_row_per_shop_resource() -> None:
    table = Base.metadata.tables["sync_states"]
    unique_columns = {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if constraint.__class__.__name__ == "UniqueConstraint"
    }
    assert ("shop_id", "resource") in unique_columns
