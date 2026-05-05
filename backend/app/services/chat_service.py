import secrets
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.exceptions import bad_request_exception, forbidden_exception, not_found_exception
from app.db.models.chat import Chat, ChatMember
from app.db.models.message import Message, MessageRead
from app.db.models.topic import Topic
from app.db.models.user import User
from app.services.storage_service import build_public_avatar_url


async def list_user_chats(session: AsyncSession, user_id: UUID) -> list[Chat]:
    stmt = (
        select(Chat)
        .join(ChatMember, Chat.id == ChatMember.chat_id)
        .where(ChatMember.user_id == user_id)
        .order_by(Chat.updated_at.desc())
    )
    chats = list((await session.execute(stmt)).scalars().all())
    for chat in chats:
        await hydrate_chat_summary(session, chat, user_id)
    return chats


async def list_related_user_ids(session: AsyncSession, user_id: UUID) -> list[UUID]:
    membership_alias = aliased(ChatMember)
    stmt = (
        select(ChatMember.user_id)
        .join(membership_alias, ChatMember.chat_id == membership_alias.chat_id)
        .where(and_(membership_alias.user_id == user_id, ChatMember.user_id != user_id))
        .distinct()
    )
    return list((await session.execute(stmt)).scalars().all())


async def list_chat_member_ids(session: AsyncSession, chat_id: UUID) -> list[UUID]:
    stmt = select(ChatMember.user_id).where(ChatMember.chat_id == chat_id)
    return list((await session.execute(stmt)).scalars().all())


async def list_chat_members(session: AsyncSession, chat_id: UUID, requester_id: UUID) -> list[ChatMember]:
    await get_chat_for_member(session, chat_id, requester_id)
    stmt = select(ChatMember).where(ChatMember.chat_id == chat_id)
    return list((await session.execute(stmt)).scalars().all())


async def get_chat_for_member(session: AsyncSession, chat_id: UUID, user_id: UUID) -> Chat:
    stmt = (
        select(Chat)
        .join(ChatMember, Chat.id == ChatMember.chat_id)
        .where(and_(Chat.id == chat_id, ChatMember.user_id == user_id))
    )
    chat = (await session.execute(stmt)).scalar_one_or_none()
    if chat is None:
        raise not_found_exception("Chat not found")
    await hydrate_chat_summary(session, chat, user_id)
    return chat


async def count_chat_unread_messages(session: AsyncSession, chat_id: UUID, user_id: UUID) -> int:
    stmt = (
        select(func.count(Message.id))
        .select_from(Message)
        .outerjoin(
            MessageRead,
            and_(MessageRead.message_id == Message.id, MessageRead.user_id == user_id),
        )
        .where(
            Message.chat_id == chat_id,
            Message.sender_id != user_id,
            Message.is_deleted.is_(False),
            MessageRead.message_id.is_(None),
        )
    )
    return int((await session.execute(stmt)).scalar_one())


async def hydrate_chat_summary(session: AsyncSession, chat: Chat, viewer_id: UUID) -> Chat:
    chat.unread_count = await count_chat_unread_messages(session, chat.id, viewer_id)
    chat.display_name = chat.name
    chat.display_avatar_url = build_public_avatar_url(chat.avatar_url)
    chat.peer_id = None
    chat.peer_username = None
    chat.peer_status = None

    if chat.type != "direct":
        return chat

    stmt = (
        select(User)
        .join(ChatMember, ChatMember.user_id == User.id)
        .where(and_(ChatMember.chat_id == chat.id, ChatMember.user_id != viewer_id))
    )
    peer = (await session.execute(stmt)).scalar_one_or_none()
    if peer is None:
        return chat

    chat.display_name = peer.display_name or peer.username
    chat.display_avatar_url = build_public_avatar_url(peer.avatar_url)
    chat.peer_id = peer.id
    chat.peer_username = peer.username
    chat.peer_status = peer.status
    return chat


async def create_or_get_direct_chat(session: AsyncSession, owner_id: UUID, peer_id: UUID) -> Chat:
    if owner_id == peer_id:
        raise bad_request_exception("Cannot create a direct chat with yourself")

    peer = await session.get(User, peer_id)
    if peer is None:
        raise not_found_exception("User not found")

    existing_stmt = (
        select(Chat)
        .join(ChatMember, Chat.id == ChatMember.chat_id)
        .where(
            Chat.type == "direct",
            or_(ChatMember.user_id == owner_id, ChatMember.user_id == peer_id),
        )
    )
    candidates = list((await session.execute(existing_stmt)).scalars().all())
    for chat in candidates:
        member_ids_stmt = select(ChatMember.user_id).where(ChatMember.chat_id == chat.id)
        member_ids = set((await session.execute(member_ids_stmt)).scalars().all())
        if member_ids == {owner_id, peer_id}:
            await hydrate_chat_summary(session, chat, owner_id)
            return chat

    chat = Chat(type="direct", created_by=owner_id)
    session.add(chat)
    await session.flush()
    session.add_all(
        [
            ChatMember(chat_id=chat.id, user_id=owner_id, role="owner"),
            ChatMember(chat_id=chat.id, user_id=peer_id, role="member"),
        ]
    )
    await session.commit()
    await session.refresh(chat)
    await hydrate_chat_summary(session, chat, owner_id)
    return chat


async def create_group_chat(
    session: AsyncSession,
    owner_id: UUID,
    name: str,
    member_ids: list[UUID],
    description: str | None = None,
    supergroup: bool = False,
) -> Chat:
    chat_type = "supergroup" if supergroup else "group"
    await _ensure_users_exist(session, {owner_id, *member_ids})
    chat = Chat(
        type=chat_type,
        name=name,
        description=description,
        created_by=owner_id,
        invite_link=secrets.token_urlsafe(16),
    )
    session.add(chat)
    await session.flush()

    uniq_member_ids = {owner_id, *member_ids}
    memberships = []
    for user_id in uniq_member_ids:
        role = "owner" if user_id == owner_id else "member"
        memberships.append(ChatMember(chat_id=chat.id, user_id=user_id, role=role))
    session.add_all(memberships)
    await session.commit()
    await session.refresh(chat)
    await hydrate_chat_summary(session, chat, owner_id)
    return chat


async def list_topics(session: AsyncSession, chat_id: UUID, user_id: UUID) -> list[Topic]:
    chat = await get_chat_for_member(session, chat_id, user_id)
    if chat.type != "supergroup":
        raise bad_request_exception("Topics are only supported for supergroups")

    stmt = select(Topic).where(Topic.chat_id == chat_id).order_by(Topic.created_at.asc())
    return list((await session.execute(stmt)).scalars().all())


async def create_topic(
    session: AsyncSession, chat_id: UUID, user_id: UUID, name: str, description: str | None
) -> Topic:
    chat = await get_chat_for_member(session, chat_id, user_id)
    if chat.type != "supergroup":
        raise bad_request_exception("Topics are only supported for supergroups")

    role = await _get_member_role(session, chat_id, user_id)
    if role not in {"owner", "admin"}:
        raise forbidden_exception("Only owner/admin can create topics")

    existing_topic_stmt = select(Topic).where(
        and_(Topic.chat_id == chat_id, func.lower(Topic.name) == name.lower())
    )
    existing_topic = (await session.execute(existing_topic_stmt)).scalar_one_or_none()
    if existing_topic is not None:
        raise bad_request_exception("Topic name already exists in this chat")

    topic = Topic(chat_id=chat_id, name=name, description=description, created_by=user_id)
    session.add(topic)
    await session.commit()
    await session.refresh(topic)
    return topic


async def update_topic(
    session: AsyncSession, chat_id: UUID, topic_id: UUID, user_id: UUID, payload: dict
) -> Topic:
    chat = await get_chat_for_member(session, chat_id, user_id)
    if chat.type != "supergroup":
        raise bad_request_exception("Topics are only supported for supergroups")

    role = await _get_member_role(session, chat_id, user_id)
    if role not in {"owner", "admin"}:
        raise forbidden_exception("Only owner/admin can update topics")

    topic = (
        await session.execute(
            select(Topic).where(and_(Topic.id == topic_id, Topic.chat_id == chat_id))
        )
    ).scalar_one_or_none()
    if topic is None:
        raise not_found_exception("Topic not found")

    for key, value in payload.items():
        setattr(topic, key, value)

    await session.commit()
    await session.refresh(topic)
    return topic


async def update_chat(session: AsyncSession, chat_id: UUID, user_id: UUID, payload: dict) -> Chat:
    chat = await get_chat_for_member(session, chat_id, user_id)
    if chat.type == "direct":
        raise bad_request_exception("Direct chats cannot be updated")

    role = await _get_member_role(session, chat_id, user_id)
    if role not in {"owner", "admin"}:
        raise forbidden_exception("Only owner/admin can update chats")

    for key, value in payload.items():
        setattr(chat, key, value)

    await session.commit()
    await session.refresh(chat)
    await hydrate_chat_summary(session, chat, user_id)
    return chat


async def delete_chat(session: AsyncSession, chat_id: UUID, user_id: UUID) -> None:
    chat = await get_chat_for_member(session, chat_id, user_id)
    if chat.type == "direct":
        raise bad_request_exception("Direct chats cannot be deleted")

    role = await _get_member_role(session, chat_id, user_id)
    if role != "owner":
        raise forbidden_exception("Only the owner can delete this chat")

    await session.delete(chat)
    await session.commit()


async def add_chat_member(
    session: AsyncSession, chat_id: UUID, actor_id: UUID, user_id: UUID
) -> ChatMember:
    chat = await get_chat_for_member(session, chat_id, actor_id)
    if chat.type == "direct":
        raise bad_request_exception("Direct chats do not support members")

    role = await _get_member_role(session, chat_id, actor_id)
    if role not in {"owner", "admin"}:
        raise forbidden_exception("Only owner/admin can add members")

    user = await session.get(User, user_id)
    if user is None:
        raise not_found_exception("User not found")

    existing_membership = (
        await session.execute(
            select(ChatMember).where(
                and_(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id)
            )
        )
    ).scalar_one_or_none()
    if existing_membership is not None:
        raise bad_request_exception("User is already a member of this chat")

    membership = ChatMember(chat_id=chat_id, user_id=user_id, role="member")
    session.add(membership)
    await session.commit()
    await session.refresh(membership)
    return membership


async def remove_chat_member(
    session: AsyncSession, chat_id: UUID, actor_id: UUID, user_id: UUID
) -> None:
    chat = await get_chat_for_member(session, chat_id, actor_id)
    if chat.type == "direct":
        raise bad_request_exception("Direct chats do not support members")

    role = await _get_member_role(session, chat_id, actor_id)
    if role not in {"owner", "admin"}:
        raise forbidden_exception("Only owner/admin can remove members")

    membership = (
        await session.execute(
            select(ChatMember).where(
                and_(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id)
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        raise not_found_exception("Member not found")
    if membership.role == "owner":
        raise bad_request_exception("Owner cannot be removed")

    await session.delete(membership)
    await session.commit()


async def change_member_role(
    session: AsyncSession, chat_id: UUID, actor_id: UUID, user_id: UUID, role: str
) -> ChatMember:
    chat = await get_chat_for_member(session, chat_id, actor_id)
    if chat.type == "direct":
        raise bad_request_exception("Direct chats do not support member roles")

    actor_role = await _get_member_role(session, chat_id, actor_id)
    if actor_role != "owner":
        raise forbidden_exception("Only the owner can change member roles")

    membership = (
        await session.execute(
            select(ChatMember).where(
                and_(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id)
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        raise not_found_exception("Member not found")

    membership.role = role
    await session.commit()
    await session.refresh(membership)
    return membership


async def leave_chat(session: AsyncSession, chat_id: UUID, user_id: UUID) -> None:
    chat = await get_chat_for_member(session, chat_id, user_id)
    if chat.type == "direct":
        raise bad_request_exception("Direct chats cannot be left")

    membership = (
        await session.execute(
            select(ChatMember).where(
                and_(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id)
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        raise not_found_exception("Member not found")

    was_owner = membership.role == "owner"
    await session.delete(membership)
    await session.flush()

    remaining_members = (
        (
            await session.execute(
                select(ChatMember)
                .where(ChatMember.chat_id == chat_id)
                .order_by(ChatMember.joined_at.asc())
            )
        )
        .scalars()
        .all()
    )
    if not remaining_members:
        await session.delete(chat)
        await session.commit()
        return

    if was_owner:
        remaining_members[0].role = "owner"

    await session.commit()


async def _ensure_users_exist(session: AsyncSession, user_ids: set[UUID]) -> None:
    stmt = select(User.id).where(User.id.in_(user_ids))
    existing_ids = set((await session.execute(stmt)).scalars().all())
    missing_ids = user_ids - existing_ids
    if missing_ids:
        raise not_found_exception("One or more users do not exist")


async def _get_member_role(session: AsyncSession, chat_id: UUID, user_id: UUID) -> str | None:
    role_stmt = select(ChatMember.role).where(
        and_(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id)
    )
    return (await session.execute(role_stmt)).scalar_one_or_none()
