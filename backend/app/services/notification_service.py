import re
from uuid import UUID

from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import not_found_exception
from app.db.models.chat import ChatMember
from app.db.models.message import Message
from app.db.models.notification import Notification
from app.db.models.user import User

_MENTION_RE = re.compile(r"@([A-Za-z0-9_]{3,32})")


async def list_unread_notifications(session: AsyncSession, user_id: UUID) -> list[Notification]:
    stmt = (
        select(Notification)
        .where(and_(Notification.user_id == user_id, Notification.is_read.is_(False)))
        .order_by(desc(Notification.created_at))
    )
    return list((await session.execute(stmt)).scalars().all())


async def mark_notification_read(
    session: AsyncSession, notification_id: UUID, user_id: UUID
) -> Notification:
    stmt = select(Notification).where(
        and_(Notification.id == notification_id, Notification.user_id == user_id)
    )
    notification = (await session.execute(stmt)).scalar_one_or_none()
    if notification is None:
        raise not_found_exception("Notification not found")
    notification.is_read = True
    await session.commit()
    await session.refresh(notification)
    return notification


async def mark_all_notifications_read(session: AsyncSession, user_id: UUID) -> None:
    notifications = await list_unread_notifications(session, user_id)
    for notification in notifications:
        notification.is_read = True
    await session.commit()


async def create_message_notifications(
    session: AsyncSession, message: Message
) -> list[Notification]:
    member_rows = (
        await session.execute(
            select(User.id, User.username)
            .join(ChatMember, ChatMember.user_id == User.id)
            .where(
                and_(ChatMember.chat_id == message.chat_id, ChatMember.user_id != message.sender_id)
            )
        )
    ).all()
    mentioned_usernames = set(_MENTION_RE.findall(message.content or ""))

    notifications: list[Notification] = []
    for user_id, username in member_rows:
        notification_type = "mention" if username in mentioned_usernames else "new_message"
        notification = Notification(
            user_id=user_id,
            type=notification_type,
            payload={
                "chat_id": str(message.chat_id),
                "message_id": str(message.id),
                "sender_id": str(message.sender_id),
                "preview": (message.content or "")[:120],
            },
        )
        session.add(notification)
        notifications.append(notification)

    if notifications:
        await session.commit()
        for notification in notifications:
            await session.refresh(notification)
    return notifications


async def create_missed_call_notification(
    session: AsyncSession, *, call_id: UUID, chat_id: UUID, initiator_id: UUID, user_id: UUID
) -> Notification:
    notification = Notification(
        user_id=user_id,
        type="call_missed",
        payload={
            "call_id": str(call_id),
            "chat_id": str(chat_id),
            "initiator_id": str(initiator_id),
        },
    )
    session.add(notification)
    await session.commit()
    await session.refresh(notification)
    return notification


def serialize_notification(notification: Notification) -> dict:
    return {
        "id": str(notification.id),
        "user_id": str(notification.user_id),
        "type": notification.type,
        "payload": notification.payload,
        "is_read": notification.is_read,
        "created_at": notification.created_at.isoformat(),
    }
