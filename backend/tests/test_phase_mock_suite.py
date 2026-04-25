from uuid import UUID

import pytest
from sqlalchemy import select

from app.db.models.chat import Chat, ChatMember
from app.db.models.message import Message
from app.db.models.refresh_token import RefreshToken
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


async def _group_chat(
    client, token: str, name: str, member_ids: list[str], description: str = "Test group"
) -> dict:
    response = await client.post(
        "/api/v1/chats/group",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": name, "member_ids": member_ids, "description": description},
    )
    assert response.status_code == 200
    return response.json()


async def _supergroup_chat(
    client, token: str, name: str, description: str = "Test supergroup"
) -> dict:
    response = await client.post(
        "/api/v1/chats/supergroup",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": name, "description": description},
    )
    assert response.status_code == 200
    return response.json()


@pytest.mark.asyncio
async def test_register_rejects_duplicate_username_or_email(client):
    first = await _register_user(client, "dupe", "dupe@example.com")
    assert first.status_code == 201

    duplicate = await _register_user(client, "dupe", "dupe@example.com")
    assert duplicate.status_code == 400
    assert duplicate.json()["detail"] == "Email or username already exists"


@pytest.mark.asyncio
async def test_login_rejects_invalid_credentials(client):
    await _register_user(client, "wrongpass", "wrongpass@example.com")

    response = await _login_user(client, "wrongpass@example.com", password="nottherightpassword")
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


@pytest.mark.asyncio
async def test_refresh_requires_cookie(client):
    response = await client.post("/api/v1/auth/refresh")
    assert response.status_code == 401
    assert response.json()["detail"] == "Missing refresh token"


@pytest.mark.asyncio
async def test_refresh_rotates_cookie_and_invalidates_old_token(client, db_session):
    register_response = await _register_user(client, "rotate", "rotate@example.com")
    assert register_response.status_code == 201
    old_refresh = client.cookies.get("refresh_token")
    assert old_refresh

    refresh_response = await client.post("/api/v1/auth/refresh")
    assert refresh_response.status_code == 200
    new_refresh = client.cookies.get("refresh_token")
    assert new_refresh
    assert new_refresh != old_refresh

    old_token_response = await client.post(
        "/api/v1/auth/refresh",
        headers={"Cookie": f"refresh_token={old_refresh}"},
    )
    assert old_token_response.status_code == 401

    token_rows = (await db_session.execute(select(RefreshToken))).scalars().all()
    assert len(token_rows) == 2
    assert any(token.revoked for token in token_rows)


@pytest.mark.asyncio
async def test_get_user_profile_by_id(client):
    viewer_token = await _token_for(client, "viewer", "viewer@example.com")
    target_token = await _token_for(client, "target", "target@example.com")
    target = await _me(client, target_token)

    response = await client.get(
        f"/api/v1/users/{target['id']}",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert response.status_code == 200
    assert response.json()["username"] == "target"


@pytest.mark.asyncio
async def test_user_search_matches_username_and_display_name(client):
    token = await _token_for(client, "searcher", "searcher@example.com")
    await client.post(
        "/api/v1/auth/register",
        json={
            "username": "designhero",
            "email": "designhero@example.com",
            "password": "securepass123",
            "display_name": "Product Wizard",
        },
    )

    username_response = await client.get(
        "/api/v1/users/search?q=design",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert username_response.status_code == 200
    assert any(user["username"] == "designhero" for user in username_response.json())

    display_name_response = await client.get(
        "/api/v1/users/search?q=Wizard",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert display_name_response.status_code == 200
    assert any(user["display_name"] == "Product Wizard" for user in display_name_response.json())


@pytest.mark.asyncio
async def test_direct_chat_with_self_is_rejected(client):
    token = await _token_for(client, "solo", "solo@example.com")
    me = await _me(client, token)

    response = await client.post(
        "/api/v1/chats/direct",
        headers={"Authorization": f"Bearer {token}"},
        json={"user_id": me["id"]},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Cannot create a direct chat with yourself"


@pytest.mark.asyncio
async def test_direct_chat_is_reused_for_same_pair(client):
    owner_token = await _token_for(client, "directowner", "directowner@example.com")
    peer_token = await _token_for(client, "directpeer", "directpeer@example.com")
    peer = await _me(client, peer_token)

    first_response = await client.post(
        "/api/v1/chats/direct",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"user_id": peer["id"]},
    )
    second_response = await client.post(
        "/api/v1/chats/direct",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"user_id": peer["id"]},
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first_response.json()["id"] == second_response.json()["id"]


@pytest.mark.asyncio
async def test_group_creation_persists_description_and_members(client, db_session):
    owner_token = await _token_for(client, "groupowner", "groupowner@example.com")
    alice_token = await _token_for(client, "alicegroup", "alicegroup@example.com")
    bob_token = await _token_for(client, "bobgroup", "bobgroup@example.com")
    owner = await _me(client, owner_token)
    alice = await _me(client, alice_token)
    bob = await _me(client, bob_token)

    group = await _group_chat(
        client,
        owner_token,
        "Backend Group",
        [alice["id"], bob["id"]],
        description="Phase 2 planning",
    )

    assert group["description"] == "Phase 2 planning"
    memberships = (
        (
            await db_session.execute(
                select(ChatMember).where(ChatMember.chat_id == UUID(group["id"]))
            )
        )
        .scalars()
        .all()
    )
    assert {str(member.user_id) for member in memberships} == {owner["id"], alice["id"], bob["id"]}


@pytest.mark.asyncio
async def test_owner_can_add_member_and_promote_existing_member(client, db_session):
    owner_token = await _token_for(client, "owneradd", "owneradd@example.com")
    member_token = await _token_for(client, "memberadd", "memberadd@example.com")
    extra_token = await _token_for(client, "extraadd", "extraadd@example.com")
    member = await _me(client, member_token)
    extra = await _me(client, extra_token)

    group = await _group_chat(client, owner_token, "Admins", [member["id"]])

    add_response = await client.post(
        f"/api/v1/chats/{group['id']}/members",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"user_id": extra["id"]},
    )
    assert add_response.status_code == 201
    assert add_response.json()["user_id"] == extra["id"]

    promote_response = await client.patch(
        f"/api/v1/chats/{group['id']}/members/{member['id']}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"role": "admin"},
    )
    assert promote_response.status_code == 200
    assert promote_response.json()["role"] == "admin"

    promoted = (
        await db_session.execute(
            select(ChatMember).where(
                ChatMember.chat_id == UUID(group["id"]),
                ChatMember.user_id == UUID(member["id"]),
            )
        )
    ).scalar_one()
    assert promoted.role == "admin"


@pytest.mark.asyncio
async def test_non_admin_cannot_add_group_member(client):
    owner_token = await _token_for(client, "ownerna", "ownerna@example.com")
    member_token = await _token_for(client, "memberna", "memberna@example.com")
    extra_token = await _token_for(client, "extrana", "extrana@example.com")
    member = await _me(client, member_token)
    extra = await _me(client, extra_token)

    group = await _group_chat(client, owner_token, "Restricted", [member["id"]])
    response = await client.post(
        f"/api/v1/chats/{group['id']}/members",
        headers={"Authorization": f"Bearer {member_token}"},
        json={"user_id": extra["id"]},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Only owner/admin can add members"


@pytest.mark.asyncio
async def test_member_can_leave_group(client, db_session):
    owner_token = await _token_for(client, "ownerleave", "ownerleave@example.com")
    member_token = await _token_for(client, "memberleave", "memberleave@example.com")
    member = await _me(client, member_token)

    group = await _group_chat(client, owner_token, "Leave Group", [member["id"]])
    response = await client.post(
        f"/api/v1/chats/{group['id']}/leave",
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert response.status_code == 204

    membership = (
        await db_session.execute(
            select(ChatMember).where(
                ChatMember.chat_id == UUID(group["id"]),
                ChatMember.user_id == UUID(member["id"]),
            )
        )
    ).scalar_one_or_none()
    assert membership is None


@pytest.mark.asyncio
async def test_owner_can_delete_group(client, db_session):
    owner_token = await _token_for(client, "ownerdelete", "ownerdelete@example.com")
    member_token = await _token_for(client, "memberdelete", "memberdelete@example.com")
    member = await _me(client, member_token)

    group = await _group_chat(client, owner_token, "Disposable", [member["id"]])
    response = await client.delete(
        f"/api/v1/chats/{group['id']}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert response.status_code == 204

    deleted_chat = await db_session.get(Chat, UUID(group["id"]))
    assert deleted_chat is None


@pytest.mark.asyncio
async def test_supergroup_topic_lifecycle(client):
    owner_token = await _token_for(client, "topicowner", "topicowner@example.com")
    supergroup = await _supergroup_chat(client, owner_token, "Topics Hub")

    create_response = await client.post(
        f"/api/v1/chats/{supergroup['id']}/topics",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"name": "General", "description": "Main thread"},
    )
    assert create_response.status_code == 200
    topic = create_response.json()

    list_response = await client.get(
        f"/api/v1/chats/{supergroup['id']}/topics",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1

    update_response = await client.patch(
        f"/api/v1/chats/{supergroup['id']}/topics/{topic['id']}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"name": "Announcements", "description": "Read first"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Announcements"

    archive_response = await client.delete(
        f"/api/v1/chats/{supergroup['id']}/topics/{topic['id']}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert archive_response.status_code == 200
    assert archive_response.json()["is_archived"] is True


@pytest.mark.asyncio
async def test_group_topic_creation_is_rejected(client):
    owner_token = await _token_for(client, "plainowner", "plainowner@example.com")
    group = await _group_chat(client, owner_token, "No Topics", [])

    response = await client.post(
        f"/api/v1/chats/{group['id']}/topics",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"name": "Should fail"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Topics are only supported for supergroups"


@pytest.mark.asyncio
async def test_topic_messages_filter_and_edit_delete_flow(client, db_session):
    owner_token = await _token_for(client, "messageowner", "messageowner@example.com")
    owner = await _me(client, owner_token)
    supergroup = await _supergroup_chat(client, owner_token, "Messages Hub")

    topic_response = await client.post(
        f"/api/v1/chats/{supergroup['id']}/topics",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"name": "Engineering"},
    )
    topic = topic_response.json()

    plain_message = await create_message(
        db_session,
        chat_id=UUID(supergroup["id"]),
        user_id=UUID(owner["id"]),
        content="Root message",
    )
    topic_message = await create_message(
        db_session,
        chat_id=UUID(supergroup["id"]),
        user_id=UUID(owner["id"]),
        content="Topic message",
        topic_id=UUID(topic["id"]),
        reply_to_id=plain_message.id,
    )

    topic_messages_response = await client.get(
        f"/api/v1/chats/{supergroup['id']}/topics/{topic['id']}/messages",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert topic_messages_response.status_code == 200
    payload = topic_messages_response.json()
    assert len(payload) == 1
    assert payload[0]["id"] == str(topic_message.id)

    edit_response = await client.patch(
        f"/api/v1/messages/{topic_message.id}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"content": "Updated topic message"},
    )
    assert edit_response.status_code == 200
    assert edit_response.json()["is_edited"] is True

    delete_response = await client.delete(
        f"/api/v1/messages/{topic_message.id}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert delete_response.status_code == 204

    deleted_message = await db_session.get(Message, topic_message.id)
    assert deleted_message is not None
    assert deleted_message.is_deleted is True
    assert deleted_message.content == "Message deleted"
