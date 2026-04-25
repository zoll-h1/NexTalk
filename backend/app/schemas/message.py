from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AttachmentCreate(BaseModel):
    s3_key: str = Field(min_length=1, max_length=1024)
    file_name: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=255)
    file_size: int = Field(ge=1, le=50 * 1024 * 1024)


class AttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    message_id: UUID
    s3_key: str
    file_name: str
    mime_type: str
    file_size: int
    thumbnail_s3_key: str | None
    created_at: datetime


class MessageCreate(BaseModel):
    chat_id: UUID
    topic_id: UUID | None = None
    content: str | None = None
    type: str = Field(default="text", pattern="^(text|image|video|audio|file|call_log|system)$")
    reply_to_id: UUID | None = None
    temp_id: str | None = None
    attachments: list[AttachmentCreate] = Field(default_factory=list, max_length=10)


class MessageEdit(BaseModel):
    content: str = Field(min_length=1)


class MessageReadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    chat_id: UUID
    topic_id: UUID | None
    sender_id: UUID
    content: str | None
    type: str
    reply_to_id: UUID | None
    is_edited: bool
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    attachments: list[AttachmentRead] = Field(default_factory=list)


class MessageReadReceipt(BaseModel):
    message_id: UUID
    user_id: UUID
    read_at: datetime
