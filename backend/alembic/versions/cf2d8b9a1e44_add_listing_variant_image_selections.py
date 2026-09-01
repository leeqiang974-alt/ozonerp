"""add independent image selections for listing variants

Revision ID: cf2d8b9a1e44
Revises: c8d4a1f7e2b0
"""

from alembic import op
import sqlalchemy as sa


revision = "cf2d8b9a1e44"
down_revision = "c8d4a1f7e2b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("listing_variants", sa.Column("image_urls_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("listing_variants", "image_urls_json")
