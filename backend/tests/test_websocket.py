import asyncio
import os
import tempfile
from collections.abc import AsyncGenerator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from starlette.websockets import WebSocketDisconnect

from app.core.dependencies import get_db
from app.db.base import Base
from app.main import app
from app.websocket.manager import manager


async def _setup_engine(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@pytest.fixture()
def ws_client():
    _, db_path = tempfile.mkstemp(suffix=".db")
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        future=True,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    asyncio.run(_setup_engine(engine))

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            yield session

    original_ws_provider = app.state.get_ws_session_factory
    app.dependency_overrides[get_db] = override_get_db
    app.state.get_ws_session_factory = session_factory
    manager.reset()

    with TestClient(app) as client:
        yield client

    manager.reset()
    app.dependency_overrides.clear()
    app.state.get_ws_session_factory = original_ws_provider
    asyncio.run(engine.dispose())
    os.unlink(db_path)


def _register(client: TestClient, username: str, email: str) -> dict:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "email": email,
            "password": "securepass123",
            "display_name": username.title(),
        },
    )
    assert response.status_code == 201
    return response.json()


def _login(client: TestClient, email: str) -> dict:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "securepass123"},
    )
    assert response.status_code == 200
    return response.json()


def _me(client: TestClient, token: str) -> dict:
    response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    return response.json()


def _create_direct_chat(client: TestClient, token: str, peer_id: str) -> dict:
    response = client.post(
        "/api/v1/chats/direct",
        headers={"Authorization": f"Bearer {token}"},
        json={"user_id": peer_id},
    )
    assert response.status_code == 200
    return response.json()


def _receive_event(
    websocket,
    event_type: str,
    predicate=None,
    attempts: int = 5,
):
    for _ in range(attempts):
        event = websocket.receive_json()
        if event.get("type") != event_type:
            continue
        if predicate is None or predicate(event):
            return event
    raise AssertionError(f"Did not receive expected websocket event: {event_type}")


def test_ws_requires_valid_token(ws_client: TestClient):
    with pytest.raises(WebSocketDisconnect), ws_client.websocket_connect("/ws"):
        pass

    with (
        pytest.raises(WebSocketDisconnect),
        ws_client.websocket_connect("/ws?token=definitely-invalid"),
    ):
        pass


def test_ws_message_delivery_and_read_receipts(ws_client: TestClient):
    owner_token = _register(ws_client, "wsowner", "wsowner@example.com")["access_token"]
    peer_token = _register(ws_client, "wspeer", "wspeer@example.com")["access_token"]
    peer = _me(ws_client, peer_token)
    chat = _create_direct_chat(ws_client, owner_token, peer["id"])

    with (
        ws_client.websocket_connect(f"/ws?token={owner_token}") as owner_ws,
        ws_client.websocket_connect(f"/ws?token={peer_token}") as peer_ws,
    ):
        initial_presence = _receive_event(
            owner_ws,
            "user:presence",
            lambda event: event["payload"]["user_id"] == peer["id"]
            and event["payload"]["status"] == "online",
        )
        assert initial_presence["type"] == "user:presence"
        assert initial_presence["payload"]["user_id"] == peer["id"]
        assert initial_presence["payload"]["status"] == "online"

        owner_ws.send_json(
            {
                "type": "message:send",
                "request_id": "req-send-1",
                "payload": {
                    "chat_id": chat["id"],
                    "content": "hello over websocket",
                    "type": "text",
                    "temp_id": "temp-1",
                },
            }
        )

        owner_message = _receive_event(owner_ws, "message:received")
        peer_message = _receive_event(peer_ws, "message:received")

        assert owner_message["type"] == "message:received"
        assert peer_message["type"] == "message:received"
        assert peer_message["payload"]["content"] == "hello over websocket"
        assert peer_message["payload"]["temp_id"] == "temp-1"

        peer_ws.send_json(
            {
                "type": "message:read",
                "request_id": "req-read-1",
                "payload": {
                    "message_id": peer_message["payload"]["id"],
                    "chat_id": chat["id"],
                },
            }
        )
        read_event = _receive_event(owner_ws, "message:read_by")
        assert read_event["type"] == "message:read_by"
        assert read_event["payload"]["message_id"] == peer_message["payload"]["id"]
        assert read_event["payload"]["user_id"] == peer["id"]


def test_ws_attachment_message_delivery(ws_client: TestClient):
    owner_token = _register(ws_client, "wsattachowner", "wsattachowner@example.com")["access_token"]
    peer_token = _register(ws_client, "wsattachpeer", "wsattachpeer@example.com")["access_token"]
    peer = _me(ws_client, peer_token)
    chat = _create_direct_chat(ws_client, owner_token, peer["id"])

    with (
        ws_client.websocket_connect(f"/ws?token={owner_token}") as owner_ws,
        ws_client.websocket_connect(f"/ws?token={peer_token}") as peer_ws,
    ):
        _receive_event(
            owner_ws,
            "user:presence",
            lambda event: event["payload"]["user_id"] == peer["id"]
            and event["payload"]["status"] == "online",
        )

        owner_ws.send_json(
            {
                "type": "message:send",
                "request_id": "req-attach-1",
                "payload": {
                    "chat_id": chat["id"],
                    "content": None,
                    "type": "file",
                    "temp_id": "temp-attach-1",
                    "attachments": [
                        {
                            "s3_key": "attachments/demo/2026/04/ws_file.pdf",
                            "file_name": "ws_file.pdf",
                            "mime_type": "application/pdf",
                            "file_size": 1280,
                        }
                    ],
                },
            }
        )

        owner_message = _receive_event(owner_ws, "message:received")
        peer_message = _receive_event(peer_ws, "message:received")

        assert owner_message["payload"]["attachments"][0]["file_name"] == "ws_file.pdf"
        assert peer_message["payload"]["attachments"][0]["s3_key"].endswith("ws_file.pdf")
        assert peer_message["payload"]["temp_id"] == "temp-attach-1"


def test_ws_typing_indicator_and_presence(ws_client: TestClient):
    owner_token = _register(ws_client, "wspresowner", "wspresowner@example.com")["access_token"]
    peer_token = _register(ws_client, "wsprespeer", "wsprespeer@example.com")["access_token"]
    peer = _me(ws_client, peer_token)
    chat = _create_direct_chat(ws_client, owner_token, peer["id"])
    owner = _me(ws_client, owner_token)

    with (
        ws_client.websocket_connect(f"/ws?token={owner_token}") as owner_ws,
        ws_client.websocket_connect(f"/ws?token={peer_token}") as peer_ws,
    ):
        presence = _receive_event(
            owner_ws,
            "user:presence",
            lambda event: event["payload"]["user_id"] == peer["id"]
            and event["payload"]["status"] == "online",
        )
        assert presence["type"] == "user:presence"
        assert presence["payload"]["user_id"] == peer["id"]
        assert presence["payload"]["status"] == "online"

        owner_ws.send_json(
            {
                "type": "typing:start",
                "request_id": "req-typing-1",
                "payload": {"chat_id": chat["id"]},
            }
        )
        typing_start = _receive_event(peer_ws, "typing:indicator")
        assert typing_start["type"] == "typing:indicator"
        assert typing_start["payload"]["user_id"] == owner["id"]
        assert typing_start["payload"]["is_typing"] is True

        owner_ws.send_json(
            {
                "type": "typing:stop",
                "request_id": "req-typing-2",
                "payload": {"chat_id": chat["id"]},
            }
        )
        typing_stop = _receive_event(peer_ws, "typing:indicator")
        assert typing_stop["type"] == "typing:indicator"
        assert typing_stop["payload"]["is_typing"] is False


def test_ws_invalid_payload_and_unsupported_event_return_errors(ws_client: TestClient):
    owner_token = _register(ws_client, "wserr", "wserr@example.com")["access_token"]

    with ws_client.websocket_connect(f"/ws?token={owner_token}") as websocket:
        websocket.send_json(
            {
                "type": "message:send",
                "request_id": "req-invalid-1",
                "payload": {"content": "missing chat id"},
            }
        )
        invalid_error = websocket.receive_json()
        assert invalid_error["type"] == "error"
        assert invalid_error["payload"]["code"] == "invalid_payload"
        assert invalid_error["payload"]["request_id"] == "req-invalid-1"

        websocket.send_json(
            {
                "type": "unknown:event",
                "request_id": "req-invalid-2",
                "payload": {},
            }
        )
        unsupported_error = websocket.receive_json()
        assert unsupported_error["type"] == "error"
        assert unsupported_error["payload"]["code"] == "unsupported_event"
        assert unsupported_error["payload"]["request_id"] == "req-invalid-2"
