from uuid import UUID

import pytest

from app.services.call_service import accept_call, invite_call


async def _register_user(client, username: str, email: str, password: str = "securepass123"):
    return await client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "email": email,
            "password": password,
            "display_name": username.title(),
        },
    )


async def _login_user(client, email: str, password: str = "securepass123"):
    return await client.post("/api/v1/auth/login", json={"email": email, "password": password})


async def _token_for(client, username: str, email: str) -> str:
    await _register_user(client, username, email)
    login_response = await _login_user(client, email)
    assert login_response.status_code == 200
    return login_response.json()["access_token"]


async def _me(client, token: str) -> dict:
    response = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    return response.json()


@pytest.mark.asyncio
async def test_get_call_history_and_detail(client, db_session):
    owner_token = await _token_for(client, "callowner", "callowner@example.com")
    peer_token = await _token_for(client, "callpeer", "callpeer@example.com")
    owner = await _me(client, owner_token)
    peer = await _me(client, peer_token)

    chat_response = await client.post(
        "/api/v1/chats/direct",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"user_id": peer["id"]},
    )
    chat_id = UUID(chat_response.json()["id"])

    call = await invite_call(db_session, chat_id=chat_id, initiator_id=UUID(owner["id"]), call_type="audio")
    await accept_call(db_session, call_id=call.id, user_id=UUID(peer["id"]))

    history_response = await client.get(
        f"/api/v1/chats/{chat_id}/calls",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert history_response.status_code == 200
    history_payload = history_response.json()
    assert len(history_payload) == 1
    assert history_payload[0]["id"] == str(call.id)
    assert history_payload[0]["status"] == "active"
    assert {participant["user_id"] for participant in history_payload[0]["participants"]} == {
        owner["id"],
        peer["id"],
    }

    detail_response = await client.get(
        f"/api/v1/calls/{call.id}",
        headers={"Authorization": f"Bearer {peer_token}"},
    )
    assert detail_response.status_code == 200
    assert detail_response.json()["chat_id"] == str(chat_id)
    assert detail_response.json()["type"] == "audio"


@pytest.mark.asyncio
async def test_call_detail_requires_membership(client, db_session):
    owner_token = await _token_for(client, "callowner2", "callowner2@example.com")
    peer_token = await _token_for(client, "callpeer2", "callpeer2@example.com")
    outsider_token = await _token_for(client, "callout2", "callout2@example.com")
    owner = await _me(client, owner_token)
    peer = await _me(client, peer_token)

    chat_response = await client.post(
        "/api/v1/chats/direct",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"user_id": peer["id"]},
    )
    chat_id = UUID(chat_response.json()["id"])

    call = await invite_call(db_session, chat_id=chat_id, initiator_id=UUID(owner["id"]), call_type="video")

    response = await client.get(
        f"/api/v1/calls/{call.id}",
        headers={"Authorization": f"Bearer {outsider_token}"},
    )
    assert response.status_code == 404
