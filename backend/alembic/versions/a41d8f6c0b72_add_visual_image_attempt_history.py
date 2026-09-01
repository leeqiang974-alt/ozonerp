"""add visual image attempt history

Revision ID: a41d8f6c0b72
Revises: 9a72c19f4e31
Create Date: 2026-08-17
"""

from alembic import op
from alembic import context
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "a41d8f6c0b72"
down_revision = "9a72c19f4e31"
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
    if "attempt_history_json" not in columns:
        op.add_column("visual_image_jobs", sa.Column("attempt_history_json", sa.Text(), nullable=False, server_default="[]"))
    if "current_run_id" not in columns:
        op.add_column("visual_image_jobs", sa.Column("current_run_id", sa.String(length=64), nullable=True))
    if "ix_visual_image_jobs_current_run_id" not in {index["name"] for index in inspect(bind).get_indexes("visual_image_jobs")}:
        op.create_index("ix_visual_image_jobs_current_run_id", "visual_image_jobs", ["current_run_id"])


def downgrade() -> None:
    op.drop_index("ix_visual_image_jobs_current_run_id", table_name="visual_image_jobs")
    op.drop_column("visual_image_jobs", "current_run_id")
    op.drop_column("visual_image_jobs", "attempt_history_json")
