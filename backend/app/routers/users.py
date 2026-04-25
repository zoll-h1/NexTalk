from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.user import UserRead, UserUpdateMe
from app.services.user_service import get_user_by_id, search_users, update_current_user

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/search", response_model=list[UserRead])
async def search_for_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    q: str = Query(min_length=1),
) -> list[UserRead]:
    users = await search_users(db, q)
    return [UserRead.model_validate(user) for user in users]


@router.get("/{user_id}", response_model=UserRead)
async def get_user(
    user_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> UserRead:
    user = await get_user_by_id(db, user_id)
    return UserRead.model_validate(user)


@router.patch("/me", response_model=UserRead)
async def update_me(
    payload: UserUpdateMe,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserRead:
    user = await update_current_user(db, current_user, payload)
    return UserRead.model_validate(user)
