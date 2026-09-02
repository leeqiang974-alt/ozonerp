"""add immutable ozon market analytics snapshots

Revision ID: d913a86e51f0
Revises: e5f6a7b8c9d0
"""
from alembic import context, op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "d913a86e51f0"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None

def upgrade():
    if context.is_offline_mode() or inspect(op.get_bind()).has_table("ozon_market_snapshots"):
        return
    op.create_table(
        "ozon_market_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shop_id", sa.Integer(), sa.ForeignKey("shops.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("source_page", sa.String(64), nullable=False),
        sa.Column("period_days", sa.Integer(), nullable=True),
        sa.Column("category_filter", sa.String(500), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("source_url", sa.String(2000), nullable=False),
        sa.Column("capture_method", sa.String(32), nullable=False),
        sa.Column("raw_json", sa.Text(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ozon_market_snapshots_shop_id", "ozon_market_snapshots", ["shop_id"])
    op.create_index("ix_ozon_market_snapshots_source_page", "ozon_market_snapshots", ["source_page"])

def downgrade():
    op.drop_index("ix_ozon_market_snapshots_source_page", table_name="ozon_market_snapshots")
    op.drop_index("ix_ozon_market_snapshots_shop_id", table_name="ozon_market_snapshots")
    op.drop_table("ozon_market_snapshots")
