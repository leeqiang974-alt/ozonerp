"""add global dictionary query cache

Revision ID: d4a8c1f2b6e0
Revises: cf2d8b9a1e44
"""

from alembic import op
import sqlalchemy as sa

revision = "d4a8c1f2b6e0"
down_revision = "cf2d8b9a1e44"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ozon_global_dictionary_query_cache",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.String(length=64), nullable=False),
        sa.Column("type_id", sa.String(length=64), nullable=False),
        sa.Column("attribute_id", sa.String(length=64), nullable=False),
        sa.Column("query_key", sa.String(length=100), nullable=False),
        sa.Column("result_limit", sa.Integer(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("category_id", "type_id", "attribute_id", "query_key", "result_limit", name="uq_ozon_global_dictionary_query_cache"),
    )
    op.create_index("ix_ozon_global_dictionary_query_cache_category_id", "ozon_global_dictionary_query_cache", ["category_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ozon_global_dictionary_query_cache_category_id", table_name="ozon_global_dictionary_query_cache")
    op.drop_table("ozon_global_dictionary_query_cache")
