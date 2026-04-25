from uuid import UUID

import pytest

from app.services.message_service import create_message
from app.services.notification_service import create_message_notifications


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
async def test_notifications_api_and_chat_unread_counts(client, db_session):
    owner_token = await _token_for(client, "notifyowner", "notifyowner@example.com")
    peer_token = await _token_for(client, "notifypeer", "notifypeer@example.com")
    owner = await _me(client, owner_token)
    peer = await _me(client, peer_token)

    chat_response = await client.post(
        "/api/v1/chats/direct",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"user_id": peer["id"]},
    )
    chat_id = UUID(chat_response.json()["id"])

    first_message = await create_message(
        db_session,
        chat_id=chat_id,
        user_id=UUID(owner["id"]),
        content="hello peer",
    )
    await create_message_notifications(db_session, first_message)
    second_message = await create_message(
        db_session,
        chat_id=chat_id,
        user_id=UUID(owner["id"]),
        content="another hello peer",
    )
    notifications = await create_message_notifications(db_session, second_message)

    list_response = await client.get(
        "/api/v1/notifications",
        headers={"Authorization": f"Bearer {peer_token}"},
    )
    assert list_response.status_code == 200
    payload = list_response.json()
    assert len(payload) == 2
    assert payload[0]["type"] == "new_message"

    chats_response = await client.get(
        "/api/v1/chats",
        headers={"Authorization": f"Bearer {peer_token}"},
    )
    assert chats_response.status_code == 200
    assert chats_response.json()[0]["unread_count"] == 2

    patch_response = await client.patch(
        f"/api/v1/notifications/{notifications[0].id}",
        headers={"Authorization": f"Bearer {peer_token}"},
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["is_read"] is True

    read_all_response = await client.post(
        "/api/v1/notifications/read-all",
        headers={"Authorization": f"Bearer {peer_token}"},
    )
    assert read_all_response.status_code == 204

    empty_response = await client.get(
        "/api/v1/notifications",
        headers={"Authorization": f"Bearer {peer_token}"},
    )
    assert empty_response.status_code == 200
    assert empty_response.json() == []


@pytest.mark.asyncio
async def test_message_search_matches_chat_content(client, db_session):
    owner_token = await _token_for(client, "searchowner", "searchowner@example.com")
    peer_token = await _token_for(client, "searchpeer", "searchpeer@example.com")
    owner = await _me(client, owner_token)
    peer = await _me(client, peer_token)

    chat_response = await client.post(
        "/api/v1/chats/direct",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"user_id": peer["id"]},
    )
    chat_id = UUID(chat_response.json()["id"])

    await create_message(
        db_session,
        chat_id=chat_id,
        user_id=UUID(owner["id"]),
        content="Deployment checklist",
    )
    await create_message(
        db_session,
        chat_id=chat_id,
        user_id=UUID(peer["id"]),
        content="Backend deployment looks good",
    )
    await create_message(
        db_session,
        chat_id=chat_id,
        user_id=UUID(owner["id"]),
        content="Random unrelated note",
    )

    response = await client.get(
        f"/api/v1/chats/{chat_id}/messages/search?q=deploy",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 2
    assert all("deploy" in message["content"].lower() for message in results)
