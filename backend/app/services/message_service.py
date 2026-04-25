from uuid import UUID

from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import bad_request_exception, forbidden_exception, not_found_exception
from app.db.models.attachment import Attachment
from app.db.models.chat import Chat, ChatMember
from app.db.models.message import Message, MessageRead
from app.db.models.topic import Topic
from app.schemas.message import AttachmentCreate, MessageReadOut


async def list_chat_messages(
    session: AsyncSession,
    chat_id: UUID,
    user_id: UUID,
    topic_id: UUID | None = None,
    limit: int = 50,
) -> list[Message]:
    membership = await session.execute(
        select(ChatMember).where(and_(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id))
    )
    if membership.scalar_one_or_none() is None:
        raise forbidden_exception("Not a member of this chat")

    stmt = select(Message).where(Message.chat_id == chat_id)
    if topic_id is not None:
        await _validate_topic_belongs_to_chat(session, chat_id, topic_id)
        stmt = stmt.where(Message.topic_id == topic_id)

    stmt = stmt.options(selectinload(Message.attachments)).order_by(desc(Message.created_at)).limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def search_chat_messages(
    session: AsyncSession,
    chat_id: UUID,
    user_id: UUID,
    query: str,
    topic_id: UUID | None = None,
    limit: int = 50,
) -> list[Message]:
    await _ensure_chat_membership(session, chat_id, user_id)

    stmt = select(Message).where(
        Message.chat_id == chat_id,
        Message.is_deleted.is_(False),
        Message.content.is_not(None),
        Message.content.ilike(f"%{query}%"),
    )
    if topic_id is not None:
        await _validate_topic_belongs_to_chat(session, chat_id, topic_id)
        stmt = stmt.where(Message.topic_id == topic_id)

    stmt = stmt.options(selectinload(Message.attachments)).order_by(desc(Message.created_at)).limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def create_message(
    session: AsyncSession,
    chat_id: UUID,
    user_id: UUID,
    content: str | None,
    message_type: str = "text",
    topic_id: UUID | None = None,
    reply_to_id: UUID | None = None,
    attachments: list[AttachmentCreate] | None = None,
) -> Message:
    await _ensure_chat_membership(session, chat_id, user_id)
    await _validate_message_context(session, chat_id, topic_id, reply_to_id)
    attachment_payloads = attachments or []

    if message_type == "text" and not content and not attachment_payloads:
        raise bad_request_exception("Text messages require content or attachments")

    message = Message(
        chat_id=chat_id,
        sender_id=user_id,
        content=content,
        type=message_type,
        topic_id=topic_id,
        reply_to_id=reply_to_id,
    )
    session.add(message)
    await session.flush()
    for attachment in attachment_payloads:
        session.add(
            Attachment(
                message_id=message.id,
                s3_key=attachment.s3_key,
                file_name=attachment.file_name,
                mime_type=attachment.mime_type,
                file_size=attachment.file_size,
            )
        )

    chat = await session.get(Chat, chat_id)
    if chat is not None:
        chat.updated_at = func.now()

    await session.commit()
    return await get_message_with_attachments(session, message.id)


async def edit_own_message(
    session: AsyncSession, message_id: UUID, user_id: UUID, content: str
) -> Message:
    message = await session.get(Message, message_id)
    if message is None:
        raise not_found_exception("Message not found")
    if message.sender_id != user_id:
        raise forbidden_exception("Can only edit your own message")

    message.content = content
    message.is_edited = True
    await session.commit()
    return await get_message_with_attachments(session, message.id)


async def soft_delete_own_message(
    session: AsyncSession, message_id: UUID, user_id: UUID
) -> Message:
    message = await session.get(Message, message_id)
    if message is None:
        raise not_found_exception("Message not found")
    if message.sender_id != user_id:
        raise forbidden_exception("Can only delete your own message")

    message.content = "Message deleted"
    message.is_deleted = True
    await session.commit()
    return await get_message_with_attachments(session, message.id)


async def mark_message_read(session: AsyncSession, message_id: UUID, user_id: UUID) -> MessageRead:
    message = await session.get(Message, message_id)
    if message is None:
        raise not_found_exception("Message not found")

    await _ensure_chat_membership(session, message.chat_id, user_id)

    existing = (
        await session.execute(
            select(MessageRead).where(
                and_(MessageRead.message_id == message_id, MessageRead.user_id == user_id)
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    receipt = MessageRead(message_id=message_id, user_id=user_id)
    session.add(receipt)
    await session.commit()
    await session.refresh(receipt)
    return receipt


async def _ensure_chat_membership(session: AsyncSession, chat_id: UUID, user_id: UUID) -> None:
    membership = await session.execute(
        select(ChatMember).where(and_(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id))
    )
    if membership.scalar_one_or_none() is None:
        raise forbidden_exception("Not a member of this chat")


async def get_message_with_attachments(session: AsyncSession, message_id: UUID) -> Message:
    stmt = select(Message).options(selectinload(Message.attachments)).where(Message.id == message_id)
    message = (await session.execute(stmt)).scalar_one_or_none()
    if message is None:
        raise not_found_exception("Message not found")
    return message


def serialize_message(message: Message, temp_id: str | None = None) -> dict:
    payload = MessageReadOut.model_validate(message).model_dump(mode="json")
    payload["temp_id"] = temp_id
    return payload


async def _validate_topic_belongs_to_chat(
    session: AsyncSession, chat_id: UUID, topic_id: UUID
) -> Topic:
    topic = (
        await session.execute(
            select(Topic).where(and_(Topic.id == topic_id, Topic.chat_id == chat_id))
        )
    ).scalar_one_or_none()
    if topic is None:
        raise bad_request_exception("Topic does not belong to this chat")
    return topic


async def _validate_message_context(
    session: AsyncSession, chat_id: UUID, topic_id: UUID | None, reply_to_id: UUID | None
) -> None:
    if topic_id is not None:
        await _validate_topic_belongs_to_chat(session, chat_id, topic_id)

    if reply_to_id is not None:
        reply_message = await session.get(Message, reply_to_id)
        if reply_message is None or reply_message.chat_id != chat_id:
            raise bad_request_exception("Reply target does not belong to this chat")
