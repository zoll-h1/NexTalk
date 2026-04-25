"""Initial users and refresh tokens tables.

Revision ID: 20260425_000001
Revises:
Create Date: 2026-04-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260425_000001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("username", sa.String(length=32), nullable=False, unique=True),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("display_name", sa.String(length=64), nullable=False),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="offline"),
        sa.Column("custom_status", sa.String(length=128), nullable=True),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "refresh_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("idx_refresh_tokens_user", "refresh_tokens", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_refresh_tokens_user", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_table("users")
