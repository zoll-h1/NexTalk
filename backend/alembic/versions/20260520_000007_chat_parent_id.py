"""add parent_id to chats

Revision ID: 20260520_000007
Revises: 20260520_000006
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260520_000007"
down_revision: str | None = "20260520_000006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chats", sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_chats_parent_id",
        "chats",
        "chats",
        ["parent_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_chats_parent_id", "chats", type_="foreignkey")
    op.drop_column("chats", "parent_id")
