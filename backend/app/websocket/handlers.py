from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.message import Message
from app.schemas.call import CallAccept, CallEnd, CallIceCandidate, CallInvite, CallReject
from app.schemas.message import MessageCreate
from app.services.call_service import (
    accept_call,
    end_call,
    get_other_call_member_ids,
    invite_call,
    reject_call,
    serialize_call,
)
from app.services.chat_service import (
    count_chat_unread_messages,
    get_chat_for_member,
    list_chat_member_ids,
)
from app.services.message_service import (
    create_message,
    edit_own_message,
    mark_message_read,
    serialize_message,
    soft_delete_own_message,
)
from app.services.notification_service import (
    create_message_notifications,
    create_missed_call_notification,
    serialize_notification,
)
from app.websocket import events
from app.websocket.manager import manager


async def handle_ws_event(user_id: UUID, frame: dict, db: AsyncSession) -> None:
    request_id = frame.get("request_id")

    try:
        event_type = frame.get("type")
        payload = frame.get("payload", {})

        if event_type == events.MESSAGE_SEND:
            data = MessageCreate.model_validate(payload)
            await get_chat_for_member(db, data.chat_id, user_id)
            await _bind_all_chat_members(db, data.chat_id)
            message = await create_message(
                db,
                chat_id=data.chat_id,
                user_id=user_id,
                content=data.content,
                message_type=data.type,
                topic_id=data.topic_id,
                reply_to_id=data.reply_to_id,
                attachments=data.attachments,
            )
            await manager.broadcast_to_chat(
                data.chat_id,
                {
                    "type": events.MESSAGE_RECEIVED,
                    "payload": serialize_message(message, temp_id=data.temp_id),
                    "request_id": request_id,
                },
            )
            notifications = await create_message_notifications(db, message)
            for notification in notifications:
                await manager.send_to_user(
                    notification.user_id,
                    {
                        "type": events.NOTIFICATION_NEW,
                        "payload": serialize_notification(notification),
                        "request_id": request_id,
                    },
                )
                unread_count = await count_chat_unread_messages(db, message.chat_id, notification.user_id)
                await manager.send_to_user(
                    notification.user_id,
                    {
                        "type": events.CHAT_UNREAD,
                        "payload": {
                            "chat_id": str(message.chat_id),
                            "unread_count": unread_count,
                        },
                        "request_id": request_id,
                    },
                )
            return

        if event_type == events.MESSAGE_EDIT:
            message_id = UUID(payload["message_id"])
            content = payload["content"]
            message = await edit_own_message(db, message_id, user_id, content)
            await _bind_all_chat_members(db, message.chat_id)
            await manager.broadcast_to_chat(
                message.chat_id,
                {
                    "type": events.MESSAGE_UPDATED,
                    "payload": {
                        "message_id": str(message.id),
                        "content": message.content,
                        "is_edited": True,
                    },
                    "request_id": request_id,
                },
            )
            return

        if event_type == events.MESSAGE_DELETE:
            message_id = UUID(payload["message_id"])
            message = await soft_delete_own_message(db, message_id, user_id)
            await _bind_all_chat_members(db, message.chat_id)
            await manager.broadcast_to_chat(
                message.chat_id,
                {
                    "type": events.MESSAGE_DELETED,
                    "payload": {"message_id": str(message.id)},
                    "request_id": request_id,
                },
            )
            return

        if event_type == events.MESSAGE_READ:
            message_id = UUID(payload["message_id"])
            receipt = await mark_message_read(db, message_id, user_id)
            message = await db.get(Message, message_id)
            if message is None:
                await _send_error(
                    user_id, "request_failed", "Message not found", request_id=request_id
                )
                return

            await _bind_all_chat_members(db, message.chat_id)
            await manager.broadcast_to_chat(
                message.chat_id,
                {
                    "type": events.MESSAGE_READ_BY,
                    "payload": {
                        "message_id": str(receipt.message_id),
                        "user_id": str(receipt.user_id),
                        "read_at": receipt.read_at.isoformat(),
                    },
                    "request_id": request_id,
                },
                exclude=user_id,
            )
            unread_count = await count_chat_unread_messages(db, message.chat_id, user_id)
            await manager.send_to_user(
                user_id,
                {
                    "type": events.CHAT_UNREAD,
                    "payload": {
                        "chat_id": str(message.chat_id),
                        "unread_count": unread_count,
                    },
                    "request_id": request_id,
                },
            )
            return

        if event_type in {events.TYPING_START, events.TYPING_STOP}:
            chat_id = UUID(payload["chat_id"])
            await get_chat_for_member(db, chat_id, user_id)
            await _bind_all_chat_members(db, chat_id)
            await manager.broadcast_to_chat(
                chat_id,
                {
                    "type": events.TYPING_INDICATOR,
                    "payload": {
                        "chat_id": str(chat_id),
                        "topic_id": payload.get("topic_id"),
                        "user_id": str(user_id),
                        "is_typing": event_type == events.TYPING_START,
                    },
                    "request_id": request_id,
                },
                exclude=user_id,
            )
            return

        if event_type == events.CALL_INVITE:
            data = CallInvite.model_validate(payload)
            call = await invite_call(
                db, chat_id=data.chat_id, initiator_id=user_id, call_type=data.call_type
            )
            await _bind_all_chat_members(db, data.chat_id)
            for member_id in await get_other_call_member_ids(db, call.id, user_id):
                await manager.send_to_user(
                    member_id,
                    {
                        "type": events.CALL_INCOMING,
                        "payload": {
                            **serialize_call(call),
                            "sdp_offer": data.sdp_offer,
                        },
                        "request_id": request_id,
                    },
                )
            return

        if event_type == events.CALL_ACCEPT:
            data = CallAccept.model_validate(payload)
            call = await accept_call(db, call_id=data.call_id, user_id=user_id)
            await _bind_all_chat_members(db, call.chat_id)
            await manager.send_to_user(
                call.initiator_id,
                {
                    "type": events.CALL_ACCEPTED,
                    "payload": {
                        **serialize_call(call),
                        "accepted_by": str(user_id),
                        "sdp_answer": data.sdp_answer,
                    },
                    "request_id": request_id,
                },
            )
            return

        if event_type == events.CALL_REJECT:
            data = CallReject.model_validate(payload)
            call = await reject_call(db, call_id=data.call_id, user_id=user_id)
            await _bind_all_chat_members(db, call.chat_id)
            await manager.send_to_user(
                call.initiator_id,
                {
                    "type": events.CALL_REJECTED,
                    "payload": {
                        **serialize_call(call),
                        "rejected_by": str(user_id),
                    },
                    "request_id": request_id,
                },
            )
            return

        if event_type == events.CALL_ICE_CANDIDATE:
            data = CallIceCandidate.model_validate(payload)
            for member_id in await get_other_call_member_ids(db, data.call_id, user_id):
                await manager.send_to_user(
                    member_id,
                    {
                        "type": events.CALL_ICE_CANDIDATE,
                        "payload": {
                            "call_id": str(data.call_id),
                            "user_id": str(user_id),
                            "candidate": data.candidate,
                        },
                        "request_id": request_id,
                    },
                )
            return

        if event_type == events.CALL_END:
            data = CallEnd.model_validate(payload)
            call = await end_call(db, call_id=data.call_id, user_id=user_id)
            await _bind_all_chat_members(db, call.chat_id)
            missed_message = None
            if call.status == "missed":
                missed_message = await create_message(
                    db,
                    chat_id=call.chat_id,
                    user_id=call.initiator_id,
                    content="Missed call",
                    message_type="system",
                )
                for member_id in await get_other_call_member_ids(db, call.id, call.initiator_id):
                    notification = await create_missed_call_notification(
                        db,
                        call_id=call.id,
                        chat_id=call.chat_id,
                        initiator_id=call.initiator_id,
                        user_id=member_id,
                    )
                    await manager.send_to_user(
                        member_id,
                        {
                            "type": events.NOTIFICATION_NEW,
                            "payload": serialize_notification(notification),
                            "request_id": request_id,
                        },
                    )
                    unread_count = await count_chat_unread_messages(db, call.chat_id, member_id)
                    await manager.send_to_user(
                        member_id,
                        {
                            "type": events.CHAT_UNREAD,
                            "payload": {
                                "chat_id": str(call.chat_id),
                                "unread_count": unread_count,
                            },
                            "request_id": request_id,
                        },
                    )
            await manager.broadcast_to_chat(
                call.chat_id,
                {
                    "type": events.CALL_ENDED,
                    "payload": {
                        **serialize_call(call),
                        "ended_by": str(user_id),
                    },
                    "request_id": request_id,
                },
            )
            if missed_message is not None:
                await manager.broadcast_to_chat(
                    call.chat_id,
                    {
                        "type": events.MESSAGE_RECEIVED,
                        "payload": serialize_message(missed_message),
                        "request_id": request_id,
                    },
                )
            return

        await _send_error(user_id, "unsupported_event", "Unsupported event", request_id=request_id)
    except (ValidationError, ValueError, KeyError) as error:
        await _send_error(user_id, "invalid_payload", str(error), request_id=request_id)
    except HTTPException as error:
        await _send_error(user_id, "request_failed", str(error.detail), request_id=request_id)


async def _bind_all_chat_members(db: AsyncSession, chat_id: UUID) -> None:
    member_ids = await list_chat_member_ids(db, chat_id)
    for member_id in member_ids:
        await manager.bind_chat_membership(chat_id, member_id)


async def _send_error(
    user_id: UUID, code: str, message: str, request_id: str | None = None
) -> None:
    payload: dict[str, str] = {"code": code, "message": message}
    if request_id is not None:
        payload["request_id"] = request_id
    await manager.send_to_user(user_id, {"type": events.ERROR, "payload": payload})
