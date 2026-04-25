from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import forbidden_exception, not_found_exception
from app.db.models.attachment import Attachment
from app.db.models.chat import ChatMember
from app.db.models.message import Message


async def ensure_download_access(session: AsyncSession, user_id: UUID, s3_key: str) -> None:
    if s3_key.startswith("avatars/"):
        return

    stmt = (
        select(Attachment.id)
        .join(Message, Attachment.message_id == Message.id)
        .join(ChatMember, ChatMember.chat_id == Message.chat_id)
        .where(and_(Attachment.s3_key == s3_key, ChatMember.user_id == user_id))
    )
    attachment_id = (await session.execute(stmt)).scalar_one_or_none()
    if attachment_id is not None:
        return

    exists_stmt = select(Attachment.id).where(Attachment.s3_key == s3_key)
    if (await session.execute(exists_stmt)).scalar_one_or_none() is None:
        raise not_found_exception("Attachment not found")

    raise forbidden_exception("Not allowed to access this attachment")
