"""Phase 3 attachments.

Revision ID: 20260425_000003
Revises: 20260425_000002
Create Date: 2026-04-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260425_000003"
down_revision: str | None = "20260425_000002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("s3_key", sa.Text(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("thumbnail_s3_key", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("s3_key", name="uq_attachments_s3_key"),
    )
    op.create_index("idx_attachments_message", "attachments", ["message_id"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_attachments_message", table_name="attachments")
    op.drop_table("attachments")
