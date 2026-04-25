from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ChatCreateDirect(BaseModel):
    user_id: UUID


class ChatCreateGroup(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    member_ids: list[UUID] = Field(default_factory=list)
    description: str | None = None


class ChatCreateSupergroup(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None


class ChatUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    avatar_url: str | None = None


class ChatMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    role: str
    joined_at: datetime


class ChatMemberAdd(BaseModel):
    user_id: UUID


class ChatMemberRoleUpdate(BaseModel):
    role: str = Field(pattern="^(owner|admin|member)$")


class ChatRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    type: str
    name: str | None
    display_name: str | None = None
    description: str | None
    avatar_url: str | None
    display_avatar_url: str | None = None
    invite_link: str | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    unread_count: int = 0
    peer_id: UUID | None = None
    peer_username: str | None = None
    peer_status: str | None = None


class TopicCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None


class TopicUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    is_archived: bool | None = None


class TopicRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    chat_id: UUID
    name: str
    description: str | None
    created_by: UUID
    created_at: datetime
    is_archived: bool
