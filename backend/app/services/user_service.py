from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import not_found_exception
from app.db.models.user import User
from app.schemas.user import UserUpdateMe


async def get_user_by_id(session: AsyncSession, user_id: UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise not_found_exception("User not found")
    return user


async def update_current_user(session: AsyncSession, user: User, payload: UserUpdateMe) -> User:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)

    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def search_users(session: AsyncSession, query: str, limit: int = 20) -> list[User]:
    stmt = (
        select(User)
        .where(or_(User.username.ilike(f"%{query}%"), User.display_name.ilike(f"%{query}%")))
        .order_by(User.username.asc())
        .limit(limit)
    )
    return list((await session.execute(stmt)).scalars().all())


async def set_user_presence(
    session: AsyncSession, user_id: UUID, status: str, update_last_seen: bool = False
) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise not_found_exception("User not found")

    user.status = status
    if update_last_seen:
        user.last_seen = datetime.now(UTC)

    await session.commit()
    await session.refresh(user)
    return user
