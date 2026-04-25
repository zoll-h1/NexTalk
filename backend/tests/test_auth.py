import pytest


@pytest.mark.asyncio
async def test_register_login_refresh_and_me(client):
    register_payload = {
        "username": "alice",
        "email": "alice@example.com",
        "password": "securepass123",
        "display_name": "Alice",
    }
    register_response = await client.post("/api/v1/auth/register", json=register_payload)
    assert register_response.status_code == 201
    register_data = register_response.json()
    assert register_data["access_token"]
    assert register_data["user"]["username"] == "alice"

    login_response = await client.post(
        "/api/v1/auth/login",
        json={"email": "alice@example.com", "password": "securepass123"},
    )
    assert login_response.status_code == 200
    access_token = login_response.json()["access_token"]

    me_response = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {access_token}"}
    )
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "alice@example.com"

    refresh_response = await client.post("/api/v1/auth/refresh")
    assert refresh_response.status_code == 200
    assert refresh_response.json()["access_token"]


@pytest.mark.asyncio
async def test_logout_clears_refresh_token(client):
    await client.post(
        "/api/v1/auth/register",
        json={
            "username": "bob",
            "email": "bob@example.com",
            "password": "securepass123",
            "display_name": "Bob",
        },
    )

    logout_response = await client.post("/api/v1/auth/logout")
    assert logout_response.status_code == 204
