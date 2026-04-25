from uuid import UUID

import pytest

from app.schemas.message import AttachmentCreate
from app.services.message_service import create_message


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
async def test_create_attachment_upload_url_for_chat_member(client, monkeypatch):
    owner_token = await _token_for(client, "uploadowner", "uploadowner@example.com")
    peer_token = await _token_for(client, "uploadpeer", "uploadpeer@example.com")
    peer = await _me(client, peer_token)

    chat_response = await client.post(
        "/api/v1/chats/direct",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"user_id": peer["id"]},
    )
    chat_id = chat_response.json()["id"]

    monkeypatch.setattr(
        "app.routers.uploads.generate_presigned_upload_url",
        lambda *, s3_key, mime_type: ("https://upload.example.test/put", 900),
    )

    response = await client.post(
        "/api/v1/uploads/presigned",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "scope": "attachment",
            "chat_id": chat_id,
            "file_name": "photo.png",
            "mime_type": "image/png",
            "file_size": 2048,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["upload_url"] == "https://upload.example.test/put"
    assert payload["expires_in"] == 900
    assert payload["s3_key"].startswith(f"attachments/{chat_id}/")
    assert payload["s3_key"].endswith("_photo.png")


@pytest.mark.asyncio
async def test_download_url_requires_chat_membership(client, db_session, monkeypatch):
    owner_token = await _token_for(client, "downloadowner", "downloadowner@example.com")
    peer_token = await _token_for(client, "downloadpeer", "downloadpeer@example.com")
    outsider_token = await _token_for(client, "downloadout", "downloadout@example.com")
    peer = await _me(client, peer_token)
    owner = await _me(client, owner_token)

    chat_response = await client.post(
        "/api/v1/chats/direct",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"user_id": peer["id"]},
    )
    chat_id = UUID(chat_response.json()["id"])
    attachment = AttachmentCreate(
        s3_key="attachments/demo/2026/04/test_file.pdf",
        file_name="file.pdf",
        mime_type="application/pdf",
        file_size=5120,
    )
    message = await create_message(
        db_session,
        chat_id=chat_id,
        user_id=UUID(owner["id"]),
        content=None,
        message_type="file",
        attachments=[attachment],
    )

    monkeypatch.setattr(
        "app.routers.uploads.generate_presigned_download_url",
        lambda *, s3_key: (f"https://download.example.test/{s3_key}", 900),
    )

    allowed_response = await client.get(
        f"/api/v1/uploads/download/{message.attachments[0].s3_key}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert allowed_response.status_code == 200
    assert allowed_response.json()["download_url"].endswith(message.attachments[0].s3_key)

    denied_response = await client.get(
        f"/api/v1/uploads/download/{message.attachments[0].s3_key}",
        headers={"Authorization": f"Bearer {outsider_token}"},
    )
    assert denied_response.status_code == 403
    assert denied_response.json()["detail"] == "Not allowed to access this attachment"


@pytest.mark.asyncio
async def test_list_messages_includes_attachment_metadata(client, db_session):
    owner_token = await _token_for(client, "historyowner", "historyowner@example.com")
    peer_token = await _token_for(client, "historypeer", "historypeer@example.com")
    peer = await _me(client, peer_token)
    owner = await _me(client, owner_token)

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
        content="Attachment message",
        attachments=[
            AttachmentCreate(
                s3_key="attachments/demo/2026/04/test_image.png",
                file_name="test_image.png",
                mime_type="image/png",
                file_size=4096,
            )
        ],
    )

    response = await client.get(
        f"/api/v1/chats/{chat_id}/messages",
        headers={"Authorization": f"Bearer {peer_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["attachments"][0]["file_name"] == "test_image.png"
    assert payload[0]["attachments"][0]["mime_type"] == "image/png"
