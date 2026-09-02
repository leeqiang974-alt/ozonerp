"""add per-style visual image job groups

Revision ID: b82f1c6d5a19
Revises: e5f6a7b8c9d0
Create Date: 2026-09-02
"""

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "b82f1c6d5a19"
down_revision = "d913a86e51f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if context.is_offline_mode():
        return
    bind = op.get_bind()
    inspector = inspect(bind)
    if not inspector.has_table("visual_image_jobs"):
        return
    columns = {column["name"] for column in inspector.get_columns("visual_image_jobs")}
    if "creative_group_key" not in columns:
        op.add_column(
            "visual_image_jobs",
            sa.Column("creative_group_key", sa.String(length=500), nullable=False, server_default="__product__"),
        )
    uniques = {item.get("name") for item in inspector.get_unique_constraints("visual_image_jobs")}
    if "uq_visual_image_job_product" in uniques:
        with op.batch_alter_table("visual_image_jobs") as batch:
            batch.drop_constraint("uq_visual_image_job_product", type_="unique")
    uniques = {item.get("name") for item in inspect(bind).get_unique_constraints("visual_image_jobs")}
    if "uq_visual_image_job_product_group" not in uniques:
        with op.batch_alter_table("visual_image_jobs") as batch:
            batch.create_unique_constraint("uq_visual_image_job_product_group", ["shop_id", "source_product_id", "creative_group_key"])
    indexes = {item["name"] for item in inspect(bind).get_indexes("visual_image_jobs")}
    if "ix_visual_image_jobs_creative_group_key" not in indexes:
        op.create_index("ix_visual_image_jobs_creative_group_key", "visual_image_jobs", ["creative_group_key"])


def downgrade() -> None:
    with op.batch_alter_table("visual_image_jobs") as batch:
        batch.drop_constraint("uq_visual_image_job_product_group", type_="unique")
        batch.create_unique_constraint("uq_visual_image_job_product", ["shop_id", "source_product_id"])
    op.drop_index("ix_visual_image_jobs_creative_group_key", table_name="visual_image_jobs")
    op.drop_column("visual_image_jobs", "creative_group_key")
