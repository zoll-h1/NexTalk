"""add only_admins_can_write to chats and muted_until to chat_members

Revision ID: 20260520_000006
Revises: 20260425_000005
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260520_000006"
down_revision: str | None = "20260425_000005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chats",
        sa.Column("only_admins_can_write", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("chats", "only_admins_can_write")
