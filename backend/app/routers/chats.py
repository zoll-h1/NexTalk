from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.chat import (
    ChatCreateDirect,
    ChatCreateGroup,
    ChatCreateSupergroup,
    ChatMemberAdd,
    ChatMemberRead,
    ChatMemberRoleUpdate,
    ChatRead,
    ChatUpdate,
    TopicCreate,
    TopicRead,
    TopicUpdate,
)
from app.services.chat_service import (
    add_chat_member,
    change_member_role,
    create_group_chat,
    create_or_get_direct_chat,
    create_topic,
    delete_chat,
    get_chat_for_member,
    leave_chat,
    list_chat_member_ids,
    list_chat_members,
    list_topics,
    list_user_chats,
    remove_chat_member,
    update_chat,
    update_topic,
)
from app.websocket import manager
from app.websocket import events

router = APIRouter(prefix="/chats", tags=["chats"])


class MuteRequest(BaseModel):
    duration_minutes: int | None = None


@router.get("", response_model=list[ChatRead])
async def get_chats(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[ChatRead]:
    chats = await list_user_chats(db, current_user.id)
    return [ChatRead.model_validate(chat) for chat in chats]


@router.post("/direct", response_model=ChatRead)
async def create_direct_chat(
    payload: ChatCreateDirect,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ChatRead:
    chat = await create_or_get_direct_chat(db, current_user.id, payload.user_id)
    return ChatRead.model_validate(chat)


@router.post("/group", response_model=ChatRead)
async def create_group(
    payload: ChatCreateGroup,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ChatRead:
    chat = await create_group_chat(
        db,
        current_user.id,
        payload.name,
        payload.member_ids,
        description=payload.description,
        supergroup=False,
        parent_id=payload.parent_id,
    )
    chat_data = ChatRead.model_validate(chat)
    member_ids = await list_chat_member_ids(db, chat.id)
    event = {"type": events.CHAT_NEW, "payload": chat_data.model_dump(mode="json")}
    for uid in member_ids:
        if uid != current_user.id:
            await manager.send_to_user(uid, event)
    return chat_data


@router.post("/supergroup", response_model=ChatRead)
async def create_supergroup(
    payload: ChatCreateSupergroup,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ChatRead:
    chat = await create_group_chat(
        db,
        current_user.id,
        payload.name,
        [],
        description=payload.description,
        supergroup=True,
        parent_id=payload.parent_id,
    )
    return ChatRead.model_validate(chat)


@router.get("/{chat_id}", response_model=ChatRead)
async def get_chat(
    chat_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ChatRead:
    chat = await get_chat_for_member(db, chat_id, current_user.id)
    return ChatRead.model_validate(chat)


@router.patch("/{chat_id}", response_model=ChatRead)
async def patch_chat(
    chat_id: UUID,
    payload: ChatUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ChatRead:
    chat = await update_chat(db, chat_id, current_user.id, payload.model_dump(exclude_unset=True))
    return ChatRead.model_validate(chat)


@router.delete("/{chat_id}", status_code=204)
async def remove_chat(
    chat_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    await delete_chat(db, chat_id, current_user.id)


@router.get("/{chat_id}/members", response_model=list[ChatMemberRead])
async def get_members(
    chat_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[ChatMemberRead]:
    members = await list_chat_members(db, chat_id, current_user.id)
    return [ChatMemberRead.model_validate(m) for m in members]


@router.post("/{chat_id}/members", response_model=ChatMemberRead, status_code=201)
async def add_member(
    chat_id: UUID,
    payload: ChatMemberAdd,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ChatMemberRead:
    membership = await add_chat_member(db, chat_id, current_user.id, payload.user_id)
    chat = await get_chat_for_member(db, chat_id, payload.user_id)
    chat_data = ChatRead.model_validate(chat)
    await manager.send_to_user(
        payload.user_id,
        {"type": events.CHAT_NEW, "payload": chat_data.model_dump(mode="json")},
    )
    return ChatMemberRead.model_validate(membership)


@router.post("/{chat_id}/members/me/mute", status_code=200)
async def mute_chat(
    chat_id: UUID,
    payload: MuteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    from app.db.models.chat import ChatMember

    muted_until = None
    if payload.duration_minutes is not None and payload.duration_minutes > 0:
        muted_until = datetime.now(timezone.utc) + timedelta(minutes=payload.duration_minutes)
    await db.execute(
        update(ChatMember)
        .where(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id)
        .values(muted_until=muted_until)
    )
    await db.commit()
    return {"muted_until": muted_until.isoformat() if muted_until else None}


@router.delete("/{chat_id}/members/{user_id}", status_code=204)
async def remove_member(
    chat_id: UUID,
    user_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    await remove_chat_member(db, chat_id, current_user.id, user_id)


@router.patch("/{chat_id}/members/{user_id}", response_model=ChatMemberRead)
async def patch_member_role(
    chat_id: UUID,
    user_id: UUID,
    payload: ChatMemberRoleUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ChatMemberRead:
    membership = await change_member_role(db, chat_id, current_user.id, user_id, payload.role)
    return ChatMemberRead.model_validate(membership)


@router.post("/{chat_id}/leave", status_code=204)
async def leave_current_chat(
    chat_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    await leave_chat(db, chat_id, current_user.id)


@router.get("/{chat_id}/topics", response_model=list[TopicRead])
async def get_topics(
    chat_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[TopicRead]:
    topics = await list_topics(db, chat_id, current_user.id)
    return [TopicRead.model_validate(topic) for topic in topics]


@router.post("/{chat_id}/topics", response_model=TopicRead)
async def add_topic(
    chat_id: UUID,
    payload: TopicCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TopicRead:
    topic = await create_topic(db, chat_id, current_user.id, payload.name, payload.description)
    return TopicRead.model_validate(topic)


@router.patch("/{chat_id}/topics/{topic_id}", response_model=TopicRead)
async def patch_topic(
    chat_id: UUID,
    topic_id: UUID,
    payload: TopicUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TopicRead:
    topic = await update_topic(
        db, chat_id, topic_id, current_user.id, payload.model_dump(exclude_unset=True)
    )
    return TopicRead.model_validate(topic)


@router.delete("/{chat_id}/topics/{topic_id}", response_model=TopicRead)
async def archive_topic(
    chat_id: UUID,
    topic_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TopicRead:
    topic = await update_topic(db, chat_id, topic_id, current_user.id, {"is_archived": True})
    return TopicRead.model_validate(topic)


@router.post("/{chat_id}/read", status_code=204)
async def mark_chat_read(
    chat_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    """Mark all unread messages in this chat as read for the current user."""
    from app.services.message_service import mark_all_chat_messages_read
    from app.services.chat_service import get_chat_for_member
    await get_chat_for_member(db, chat_id, current_user.id)
    await mark_all_chat_messages_read(db, chat_id, current_user.id)
