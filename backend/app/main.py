from uuid import UUID

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from jwt import InvalidTokenError

from app.core.config import settings
from app.core.security import decode_access_token
from app.db.base import get_session_factory
from app.routers import auth, chats, messages, uploads, users
from app.services.chat_service import list_related_user_ids
from app.services.user_service import set_user_presence
from app.websocket import handle_ws_event, manager


def create_app() -> FastAPI:
    app = FastAPI(title="NexTalk API", version="1.0.0")
    app.state.get_ws_session_factory = get_session_factory

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router, prefix=settings.api_v1_prefix)
    app.include_router(users.router, prefix=settings.api_v1_prefix)
    app.include_router(chats.router, prefix=settings.api_v1_prefix)
    app.include_router(messages.router, prefix=settings.api_v1_prefix)
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
                async with app.state.get_ws_session_factory() as session:
                    await handle_ws_event(user_id=user_uuid, frame=frame, db=session)
        except WebSocketDisconnect:
            await manager.disconnect(websocket, user_uuid)

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()


async def _broadcast_presence(
    app: FastAPI, user_id: UUID, status: str, update_last_seen: bool = False
) -> None:
    async with app.state.get_ws_session_factory() as session:
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
