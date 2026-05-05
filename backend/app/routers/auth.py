from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.auth import AccessTokenResponse, AuthResponse, LoginRequest, RegisterRequest
from app.schemas.user import UserRead
from app.services.auth_service import login_user, logout_user, refresh_access_token, register_user
from app.services.storage_service import build_public_avatar_url

router = APIRouter(prefix="/auth", tags=["auth"])


def _user_read(user: User) -> UserRead:
    data = UserRead.model_validate(user)
    data.display_avatar_url = build_public_avatar_url(user.avatar_url)
    return data


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthResponse:
    user, access_token, refresh_token = await register_user(db, payload)
    _set_refresh_cookie(response, refresh_token)
    return AuthResponse(access_token=access_token, user=_user_read(user))


@router.post("/login", response_model=AuthResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthResponse:
    user, access_token, refresh_token = await login_user(db, payload)
    _set_refresh_cookie(response, refresh_token)
    return AuthResponse(access_token=access_token, user=_user_read(user))


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    refresh_token: Annotated[str | None, Cookie()] = None,
) -> AccessTokenResponse:
    if not refresh_token:
        from app.core.exceptions import unauthorized_exception

        raise unauthorized_exception("Missing refresh token")
    _, access_token, new_refresh_token = await refresh_access_token(db, refresh_token)
    _set_refresh_cookie(response, new_refresh_token)
    return AccessTokenResponse(access_token=access_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    refresh_token: Annotated[str | None, Cookie()] = None,
) -> Response:
    if refresh_token:
        await logout_user(db, refresh_token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie("refresh_token")
    return response


@router.get("/me", response_model=UserRead)
async def me(current_user: Annotated[User, Depends(get_current_user)]) -> UserRead:
    return _user_read(current_user)
