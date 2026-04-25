from collections import defaultdict
from uuid import UUID

from fastapi import WebSocket
from starlette.websockets import WebSocketState


class ConnectionManager:
    """
    Stores active WS connections per user.
    Redis pub-sub hook points are included for Phase 2+ scaling.
    """

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._chat_members: dict[str, set[str]] = defaultdict(set)

    async def connect(self, websocket: WebSocket, user_id: UUID) -> None:
        await websocket.accept()
        self._connections[str(user_id)].add(websocket)

    async def disconnect(self, websocket: WebSocket, user_id: UUID) -> None:
        user_key = str(user_id)
        if user_key in self._connections:
            self._connections[user_key].discard(websocket)
            if not self._connections[user_key]:
                self._connections.pop(user_key, None)

    async def bind_chat_membership(self, chat_id: UUID, user_id: UUID) -> None:
        self._chat_members[str(chat_id)].add(str(user_id))

    async def send_to_user(self, user_id: UUID, event: dict) -> None:
        sockets = self._connections.get(str(user_id), set())
        for ws in list(sockets):
            await self._safe_send(ws, event, UUID(str(user_id)))

    async def broadcast_to_chat(
        self, chat_id: UUID, event: dict, exclude: UUID | None = None
    ) -> None:
        member_ids = self._chat_members.get(str(chat_id), set())
        for member_id in member_ids:
            if exclude and member_id == str(exclude):
                continue
            for ws in list(self._connections.get(member_id, set())):
                await self._safe_send(ws, event, UUID(member_id))

    async def subscribe_to_redis(self) -> None:
        # Placeholder for multi-worker fanout in later phases.
        return

    def reset(self) -> None:
        self._connections.clear()
        self._chat_members.clear()

    async def _safe_send(self, websocket: WebSocket, event: dict, user_id: UUID) -> None:
        if websocket.client_state != WebSocketState.CONNECTED:
            await self.disconnect(websocket, user_id)
            return
        try:
            await websocket.send_json(event)
        except Exception:
            await self.disconnect(websocket, user_id)


manager = ConnectionManager()
