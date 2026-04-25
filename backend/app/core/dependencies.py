from collections.abc import AsyncGenerator
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import unauthorized_exception
from app.core.security import decode_access_token
from app.db.base import get_db_session
from app.db.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_session():
        yield session


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    try:
        payload = decode_access_token(token)
    except InvalidTokenError as error:
        raise unauthorized_exception("Invalid access token") from error

    user_id = payload.get("user_id")
    if not user_id:
        raise unauthorized_exception("Invalid token payload")

    user = await db.get(User, UUID(str(user_id)))
    if user is None:
        raise unauthorized_exception("User not found")

    return user
