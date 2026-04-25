from uuid import UUID

from pydantic import BaseModel, Field


class UploadPresignRequest(BaseModel):
    scope: str = Field(pattern="^(attachment|avatar)$")
    file_name: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=255)
    file_size: int = Field(ge=1, le=50 * 1024 * 1024)
    chat_id: UUID | None = None


class UploadPresignResponse(BaseModel):
    upload_url: str
    s3_key: str
    expires_in: int


class DownloadPresignResponse(BaseModel):
    download_url: str
    s3_key: str
    expires_in: int
