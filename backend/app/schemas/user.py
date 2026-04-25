from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserBase(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=64)


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserUpdateMe(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    avatar_url: str | None = Field(default=None, max_length=2048)
    bio: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, pattern="^(online|offline|away|do_not_disturb)$")
    custom_status: str | None = Field(default=None, max_length=128)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    email: EmailStr
    display_name: str
    avatar_url: str | None
    bio: str | None
    status: str
    custom_status: str | None
    is_verified: bool
    created_at: datetime
    updated_at: datetime
    last_seen: datetime | None
