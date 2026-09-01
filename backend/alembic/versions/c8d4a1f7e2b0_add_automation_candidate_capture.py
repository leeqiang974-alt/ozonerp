"""store official snapshots for store-neutral nightly sourcing candidates

Revision ID: c8d4a1f7e2b0
Revises: a41d8f6c0b72
"""

from alembic import op
from alembic import context
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "c8d4a1f7e2b0"
down_revision = "a41d8f6c0b72"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if context.is_offline_mode():
        return
    bind = op.get_bind()
    inspector = inspect(bind)
    if not inspector.has_table("automation_candidates"):
        return
    if "capture_json" not in {column["name"] for column in inspector.get_columns("automation_candidates")}:
        op.add_column("automation_candidates", sa.Column("capture_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("automation_candidates", "capture_json")
