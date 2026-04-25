from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.core.exceptions import bad_request_exception
from app.db.models.user import User
from app.schemas.upload import DownloadPresignResponse, UploadPresignRequest, UploadPresignResponse
from app.services.chat_service import get_chat_for_member
from app.services.storage_service import (
    build_attachment_key,
    build_avatar_key,
    generate_presigned_download_url,
    generate_presigned_upload_url,
)
from app.services.upload_service import ensure_download_access

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("/presigned", response_model=UploadPresignResponse)
async def create_presigned_upload(
    payload: UploadPresignRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> UploadPresignResponse:
    if payload.scope == "attachment":
        if payload.chat_id is None:
            raise bad_request_exception("chat_id is required for attachment uploads")
        await get_chat_for_member(db, payload.chat_id, current_user.id)
        s3_key = build_attachment_key(payload.chat_id, payload.file_name)
    else:
        s3_key = build_avatar_key(current_user.id, payload.file_name)

    upload_url, expires_in = generate_presigned_upload_url(
        s3_key=s3_key,
        mime_type=payload.mime_type,
    )
    return UploadPresignResponse(upload_url=upload_url, s3_key=s3_key, expires_in=expires_in)


@router.get("/download/{s3_key:path}", response_model=DownloadPresignResponse)
async def create_presigned_download(
    s3_key: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> DownloadPresignResponse:
    await ensure_download_access(db, current_user.id, s3_key)
    download_url, expires_in = generate_presigned_download_url(s3_key=s3_key)
    return DownloadPresignResponse(
        download_url=download_url,
        s3_key=s3_key,
        expires_in=expires_in,
    )
