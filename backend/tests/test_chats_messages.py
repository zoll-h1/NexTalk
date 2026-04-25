import pytest


async def _register_and_login(client, username: str, email: str) -> str:
    await client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "email": email,
            "password": "securepass123",
            "display_name": username.title(),
        },
    )
    login_response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "securepass123"},
    )
    return login_response.json()["access_token"]


@pytest.mark.asyncio
async def test_direct_chat_create_and_fetch_messages(client):
    owner_token = await _register_and_login(client, "owner", "owner@example.com")
    await _register_and_login(client, "peer", "peer@example.com")

    me_response = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {owner_token}"}
    )
    owner_id = me_response.json()["id"]

    # Get peer id by creating a second session token for peer then /auth/me.
    peer_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "peer@example.com", "password": "securepass123"},
    )
    peer_token = peer_login.json()["access_token"]
    peer_me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {peer_token}"})
    peer_id = peer_me.json()["id"]

    create_chat_response = await client.post(
        "/api/v1/chats/direct",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"user_id": peer_id},
    )
    assert create_chat_response.status_code == 200
    chat_id = create_chat_response.json()["id"]

    owner_chats = await client.get(
        "/api/v1/chats", headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert owner_chats.status_code == 200
    assert any(chat["id"] == chat_id for chat in owner_chats.json())

    # owner_id is intentionally read to verify token identity path is valid
    assert owner_id
    messages_response = await client.get(
        f"/api/v1/chats/{chat_id}/messages",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert messages_response.status_code == 200
    assert messages_response.json() == []
