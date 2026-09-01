"""add visual image attempt history

Revision ID: a41d8f6c0b72
Revises: 9a72c19f4e31
Create Date: 2026-08-17
"""

from alembic import op
import sqlalchemy as sa


revision = "a41d8f6c0b72"
down_revision = "9a72c19f4e31"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("visual_image_jobs", sa.Column("attempt_history_json", sa.Text(), nullable=False, server_default="[]"))
    op.add_column("visual_image_jobs", sa.Column("current_run_id", sa.String(length=64), nullable=True))
    op.create_index("ix_visual_image_jobs_current_run_id", "visual_image_jobs", ["current_run_id"])


def downgrade() -> None:
    op.drop_index("ix_visual_image_jobs_current_run_id", table_name="visual_image_jobs")
    op.drop_column("visual_image_jobs", "current_run_id")
    op.drop_column("visual_image_jobs", "attempt_history_json")
