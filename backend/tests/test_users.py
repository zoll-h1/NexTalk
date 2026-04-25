import pytest


@pytest.mark.asyncio
async def test_update_me_profile(client):
    await client.post(
        "/api/v1/auth/register",
        json={
            "username": "charlie",
            "email": "charlie@example.com",
            "password": "securepass123",
            "display_name": "Charlie",
        },
    )

    login_response = await client.post(
        "/api/v1/auth/login",
        json={"email": "charlie@example.com", "password": "securepass123"},
    )
    token = login_response.json()["access_token"]

    update_response = await client.patch(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "display_name": "Charlie Updated",
            "avatar_url": "avatars/demo/avatar.png",
            "bio": "Backend dev",
            "status": "away",
            "custom_status": "coding",
        },
    )
    assert update_response.status_code == 200
    body = update_response.json()
    assert body["display_name"] == "Charlie Updated"
    assert body["avatar_url"] == "avatars/demo/avatar.png"
    assert body["status"] == "away"
