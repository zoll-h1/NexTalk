from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.call import CallRead
from app.services.call_service import get_call_for_member, list_chat_calls

router = APIRouter(tags=["calls"])


@router.get("/calls/{call_id}", response_model=CallRead)
async def get_call(
    call_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> CallRead:
    call = await get_call_for_member(db, call_id, current_user.id)
    return CallRead.model_validate(call)


@router.get("/chats/{chat_id}/calls", response_model=list[CallRead])
async def get_chat_call_history(
    chat_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[CallRead]:
    calls = await list_chat_calls(db, chat_id, current_user.id)
    return [CallRead.model_validate(call) for call in calls]
