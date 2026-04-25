from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.message import MessageEdit, MessageReadOut
from app.services.message_service import (
    edit_own_message,
    list_chat_messages,
    search_chat_messages,
    soft_delete_own_message,
)

router = APIRouter(tags=["messages"])


@router.get("/chats/{chat_id}/messages", response_model=list[MessageReadOut])
async def get_chat_messages(
    chat_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(default=50, ge=1, le=100),
) -> list[MessageReadOut]:
    messages = await list_chat_messages(db, chat_id, current_user.id, limit=limit)
    return [MessageReadOut.model_validate(message) for message in messages]


@router.get("/chats/{chat_id}/topics/{topic_id}/messages", response_model=list[MessageReadOut])
async def get_topic_messages(
    chat_id: UUID,
    topic_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(default=50, ge=1, le=100),
) -> list[MessageReadOut]:
    messages = await list_chat_messages(
        db, chat_id, current_user.id, topic_id=topic_id, limit=limit
    )
    return [MessageReadOut.model_validate(message) for message in messages]


@router.get("/chats/{chat_id}/messages/search", response_model=list[MessageReadOut])
async def search_messages(
    chat_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    q: Annotated[str, Query(min_length=1)],
    topic_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[MessageReadOut]:
    messages = await search_chat_messages(
        db, chat_id=chat_id, user_id=current_user.id, query=q, topic_id=topic_id, limit=limit
    )
    return [MessageReadOut.model_validate(message) for message in messages]


@router.patch("/messages/{message_id}", response_model=MessageReadOut)
async def edit_message(
    message_id: UUID,
    payload: MessageEdit,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> MessageReadOut:
    message = await edit_own_message(db, message_id, current_user.id, payload.content)
    return MessageReadOut.model_validate(message)


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    await soft_delete_own_message(db, message_id, current_user.id)
