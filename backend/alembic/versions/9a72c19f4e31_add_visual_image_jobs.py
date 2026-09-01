"""add visual image jobs"""
from alembic import op
from alembic import context
import sqlalchemy as sa
from sqlalchemy import inspect
revision="9a72c19f4e31"; down_revision="6e31c4c72bd0"; branch_labels=None; depends_on=None
def upgrade():
    # In offline SQL generation there is no database to inspect.  The repair
    # revision at the end of the chain emits this table from the frozen ORM
    # metadata, so avoid generating a CREATE that references its prerequisite
    # table before that revision runs.
    if context.is_offline_mode():
        return
    # ``source_products`` was introduced by the application schema before
    # this migration was added, but older installations may have been
    # stamped/applied without that table.  The complete-schema repair
    # migration that follows will create both tables in dependency order.
    # Do not make an upgrade from a partially migrated database fail here.
    bind = op.get_bind()
    if not inspect(bind).has_table("source_products"):
        return
    if inspect(bind).has_table("visual_image_jobs"):
        return
    op.create_table("visual_image_jobs",sa.Column("id",sa.Integer(),primary_key=True),sa.Column("shop_id",sa.Integer(),sa.ForeignKey("shops.id",ondelete="RESTRICT"),nullable=False),sa.Column("source_product_id",sa.Integer(),sa.ForeignKey("source_products.id",ondelete="CASCADE"),nullable=False),sa.Column("listing_draft_id",sa.Integer(),sa.ForeignKey("listing_drafts.id",ondelete="SET NULL")),sa.Column("status",sa.String(32),nullable=False,server_default="pending"),sa.Column("analysis_json",sa.Text(),nullable=False,server_default="{}"),sa.Column("plan_json",sa.Text(),nullable=False,server_default="[]"),sa.Column("generated_images_json",sa.Text(),nullable=False,server_default="[]"),sa.Column("selected_images_json",sa.Text(),nullable=False,server_default="[]"),sa.Column("reference_images_json",sa.Text(),nullable=False,server_default="[]"),sa.Column("error_message",sa.String(2000)),sa.Column("llm_model",sa.String(100)),sa.Column("image_model",sa.String(100)),sa.Column("usage_json",sa.Text(),nullable=False,server_default="{}"),sa.Column("applied_by",sa.String(128)),sa.Column("applied_at",sa.DateTime(timezone=True)),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.func.now()),sa.Column("updated_at",sa.DateTime(timezone=True),server_default=sa.func.now()),sa.UniqueConstraint("shop_id","source_product_id",name="uq_visual_image_job_product"))
    for name,cols in (("shop_id",["shop_id"]),("source_product_id",["source_product_id"]),("listing_draft_id",["listing_draft_id"]),("status",["status"])):op.create_index(f"ix_visual_image_jobs_{name}","visual_image_jobs",cols)
def downgrade():op.drop_table("visual_image_jobs")
