import re
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import PurePosixPath
from uuid import UUID, uuid4

import boto3
from botocore.config import Config

from app.core.config import settings

_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def normalize_file_name(file_name: str) -> str:
    normalized = _FILENAME_SAFE_RE.sub("_", PurePosixPath(file_name).name).strip("._")
    return normalized or "file"


@lru_cache
def get_s3_client():
    return boto3.client(
        "s3",
        region_name=settings.storage_region,
        endpoint_url=settings.storage_endpoint_url,
        aws_access_key_id=settings.storage_access_key,
        aws_secret_access_key=settings.storage_secret_key,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def build_attachment_key(chat_id: UUID, file_name: str, now: datetime | None = None) -> str:
    timestamp = now or datetime.now(UTC)
    safe_name = normalize_file_name(file_name)
    return (
        f"attachments/{chat_id}/{timestamp.year:04d}/{timestamp.month:02d}/"
        f"{uuid4()}_{safe_name}"
    )


def build_avatar_key(user_id: UUID, file_name: str) -> str:
    safe_name = normalize_file_name(file_name)
    return f"avatars/{user_id}/{uuid4()}_{safe_name}"


def generate_presigned_upload_url(
    *,
    s3_key: str,
    mime_type: str,
    expires_in: int | None = None,
) -> tuple[str, int]:
    ttl = expires_in or settings.storage_presign_expire_seconds
    url = get_s3_client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.storage_bucket_name,
            "Key": s3_key,
            "ContentType": mime_type,
        },
        ExpiresIn=ttl,
    )
    return url, ttl


def generate_presigned_download_url(
    *, s3_key: str, expires_in: int | None = None
) -> tuple[str, int]:
    ttl = expires_in or settings.storage_presign_expire_seconds
    url = get_s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.storage_bucket_name, "Key": s3_key},
        ExpiresIn=ttl,
    )
    return url, ttl
