import json
from contextlib import asynccontextmanager
from time import perf_counter
from uuid import UUID, uuid4

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from jwt import InvalidTokenError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import settings
from app.core.logging import dumps_log, get_logger, setup_logging
from app.core.rate_limit import rate_limiter
from app.core.security import decode_access_token
from app.db.base import get_session_factory
from app.routers import auth, calls, chats, messages, notifications, uploads, users
from app.services.chat_service import list_related_user_ids
from app.services.storage_service import get_s3_client
from app.services.user_service import set_user_presence
from app.websocket import handle_ws_event, manager

setup_logging(settings.log_level)
request_logger = get_logger("nextalk.request")

_AVATAR_POLICY = json.dumps({
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": {"AWS": ["*"]},
        "Action": ["s3:GetObject"],
        "Resource": [f"arn:aws:s3:::{settings.storage_bucket_name}/avatars/*"],
    }],
})


def _ensure_storage() -> None:
    """Create the S3 bucket if it doesn't exist and apply the public-read policy for avatars."""
    try:
        client = get_s3_client()
        try:
            client.head_bucket(Bucket=settings.storage_bucket_name)
        except Exception:
            client.create_bucket(Bucket=settings.storage_bucket_name)
        client.put_bucket_policy(Bucket=settings.storage_bucket_name, Policy=_AVATAR_POLICY)
    except Exception as exc:  # noqa: BLE001
        request_logger.warning("Storage init warning: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _ensure_storage()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="NexTalk API", version="1.0.0", lifespan=lifespan)
    app.state.get_ws_session_factory = get_session_factory

    app.add_middleware(GZipMiddleware, minimum_size=512)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def log_and_limit_requests(request: Request, call_next):
        request_id = request.headers.get("x-request-id", str(uuid4()))
        client_ip = _get_client_ip(request)

        if request.url.path == "/health" or request.url.path.startswith(settings.api_v1_prefix):
            is_allowed, retry_after = rate_limiter.check(
                client_ip, settings.rate_limit_requests, settings.rate_limit_window_seconds
            )
            if not is_allowed:
                response = JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded"},
                    headers={"Retry-After": str(retry_after), "X-Request-ID": request_id},
                )
                request_logger.warning(
                    dumps_log(
                        {
                            "client_ip": client_ip,
                            "method": request.method,
                            "path": request.url.path,
                            "request_id": request_id,
                            "status_code": response.status_code,
                        }
                    )
                )
                return response

        started_at = perf_counter()
        response = await call_next(request)
        duration_ms = round((perf_counter() - started_at) * 1000, 2)
        response.headers["X-Request-ID"] = request_id
        request_logger.info(
            dumps_log(
                {
                    "client_ip": client_ip,
                    "duration_ms": duration_ms,
                    "method": request.method,
                    "path": request.url.path,
                    "request_id": request_id,
                    "status_code": response.status_code,
                }
            )
        )
        return response

    app.include_router(auth.router, prefix=settings.api_v1_prefix)
    app.include_router(users.router, prefix=settings.api_v1_prefix)
    app.include_router(chats.router, prefix=settings.api_v1_prefix)
    app.include_router(messages.router, prefix=settings.api_v1_prefix)
    app.include_router(calls.router, prefix=settings.api_v1_prefix)
    app.include_router(notifications.router, prefix=settings.api_v1_prefix)
    app.include_router(uploads.router, prefix=settings.api_v1_prefix)

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        token = websocket.query_params.get("token")
        if not token:
            await websocket.close(code=4001, reason="Unauthorized")
            return
        try:
            payload = decode_access_token(token)
        except InvalidTokenError:
            await websocket.close(code=4001, reason="Unauthorized")
            return

        user_id = payload.get("user_id")
        if not user_id:
            await websocket.close(code=4001, reason="Unauthorized")
            return

        user_uuid = UUID(str(user_id))
        await manager.connect(websocket, user_uuid)
        try:
            await _broadcast_presence(app, user_uuid, "online")
            while True:
                frame = await websocket.receive_json()
                async with app.state.get_ws_session_factory()() as session:
                    await handle_ws_event(user_id=user_uuid, frame=frame, db=session)
        except WebSocketDisconnect:
            await manager.disconnect(websocket, user_uuid)
            await _broadcast_presence(app, user_uuid, "offline", update_last_seen=True)

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()


async def _broadcast_presence(
    app: FastAPI, user_id: UUID, status: str, update_last_seen: bool = False
) -> None:
    async with app.state.get_ws_session_factory()() as session:
        user = await set_user_presence(
            session, user_id=user_id, status=status, update_last_seen=update_last_seen
        )
        related_user_ids = await list_related_user_ids(session, user_id)

    event = {
        "type": "user:presence",
        "payload": {
            "user_id": str(user.id),
            "status": user.status,
            "last_seen": user.last_seen.isoformat() if user.last_seen else None,
        },
    }
    for related_user_id in related_user_ids:
        await manager.send_to_user(related_user_id, event)


def _get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client is not None:
        return request.client.host
    return "unknown"
