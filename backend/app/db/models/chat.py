import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, PrimaryKeyConstraint, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    invite_link: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    members = relationship("ChatMember", back_populates="chat", cascade="all, delete-orphan")
    topics = relationship("Topic", back_populates="chat", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="chat", cascade="all, delete-orphan")


class ChatMember(Base):
    __tablename__ = "chat_members"
    __table_args__ = (PrimaryKeyConstraint("chat_id", "user_id", name="pk_chat_members"),)

    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), default="member", nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    muted_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    chat = relationship("Chat", back_populates="members")
