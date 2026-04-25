"""Phase 2 chats, topics, and messages.

Revision ID: 20260425_000002
Revises: 20260425_000001
Create Date: 2026-04-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260425_000002"
down_revision: str | None = "20260425_000001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chats",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("invite_link", sa.String(length=64), nullable=True, unique=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "chat_members",
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False, server_default="member"),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("muted_until", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("chat_id", "user_id", name="pk_chat_members"),
    )

    op.create_table(
        "topics",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("chat_id", "name", name="uq_topics_chat_name"),
    )
    op.create_index("idx_topics_chat", "topics", ["chat_id"], unique=False)

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("topic_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("sender_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("type", sa.String(length=16), nullable=False, server_default="text"),
        sa.Column("reply_to_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_edited", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["reply_to_id"], ["messages.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_messages_chat", "messages", ["chat_id", "created_at"], unique=False)
    op.create_index("idx_messages_topic", "messages", ["topic_id", "created_at"], unique=False)
    op.create_index("idx_messages_sender", "messages", ["sender_id"], unique=False)

    op.create_table(
        "message_reads",
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("message_id", "user_id", name="pk_message_reads"),
    )


def downgrade() -> None:
    op.drop_table("message_reads")
    op.drop_index("idx_messages_sender", table_name="messages")
    op.drop_index("idx_messages_topic", table_name="messages")
    op.drop_index("idx_messages_chat", table_name="messages")
    op.drop_table("messages")
    op.drop_index("idx_topics_chat", table_name="topics")
    op.drop_table("topics")
    op.drop_table("chat_members")
    op.drop_table("chats")
