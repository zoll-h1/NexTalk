from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import bad_request_exception, unauthorized_exception
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from app.db.models.refresh_token import RefreshToken
from app.db.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest


async def register_user(session: AsyncSession, payload: RegisterRequest) -> tuple[User, str, str]:
    existing_user_stmt = select(User).where(
        (User.email == payload.email) | (User.username == payload.username)
    )
    existing_user = (await session.execute(existing_user_stmt)).scalar_one_or_none()
    if existing_user:
        raise bad_request_exception("Email or username already exists")

    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
    )
    session.add(user)
    await session.flush()

    access_token = create_access_token(user_id=str(user.id), username=user.username)
    refresh_token = await _issue_refresh_token(session, user)
    await session.commit()
    await session.refresh(user)
    return user, access_token, refresh_token


async def login_user(session: AsyncSession, payload: LoginRequest) -> tuple[User, str, str]:
    user_stmt = select(User).where(User.email == payload.email)
    user = (await session.execute(user_stmt)).scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise unauthorized_exception("Invalid email or password")

    access_token = create_access_token(user_id=str(user.id), username=user.username)
    refresh_token = await _issue_refresh_token(session, user)
    await session.commit()
    return user, access_token, refresh_token


async def refresh_access_token(
    session: AsyncSession, raw_refresh_token: str
) -> tuple[User, str, str]:
    token_rows = await session.execute(
        select(RefreshToken)
        .where(RefreshToken.revoked.is_(False))
        .order_by(RefreshToken.created_at.desc())
    )
    tokens = token_rows.scalars().all()

    matched_token: RefreshToken | None = None
    for token in tokens:
        if verify_password(raw_refresh_token, token.token_hash):
            matched_token = token
            break

    if matched_token is None:
        raise unauthorized_exception("Invalid refresh token")

    expires_at = matched_token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)

    if expires_at <= datetime.now(UTC):
        raise unauthorized_exception("Refresh token expired")

    matched_token.revoked = True
    user = await session.get(User, matched_token.user_id)
    if user is None:
        raise unauthorized_exception("User not found")

    new_access_token = create_access_token(user_id=str(user.id), username=user.username)
    new_refresh_token = await _issue_refresh_token(session, user)
    await session.commit()
    return user, new_access_token, new_refresh_token


async def logout_user(session: AsyncSession, raw_refresh_token: str) -> None:
    token_rows = await session.execute(
        select(RefreshToken)
        .where(RefreshToken.revoked.is_(False))
        .order_by(RefreshToken.created_at.desc())
    )
    tokens = token_rows.scalars().all()
    for token in tokens:
        if verify_password(raw_refresh_token, token.token_hash):
            token.revoked = True
            await session.commit()
            return


async def _issue_refresh_token(session: AsyncSession, user: User) -> str:
    raw_token = create_refresh_token()
    token_row = RefreshToken(
        user_id=user.id,
        token_hash=hash_password(raw_token),
        expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days),
    )
    session.add(token_row)
    return raw_token
