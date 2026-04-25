from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import bad_request_exception, not_found_exception
from app.db.models.call import Call, CallParticipant
from app.db.models.chat import Chat, ChatMember
from app.schemas.call import CallRead
from app.services.chat_service import get_chat_for_member, list_chat_member_ids


async def list_chat_calls(session: AsyncSession, chat_id: UUID, user_id: UUID) -> list[Call]:
    await get_chat_for_member(session, chat_id, user_id)
    stmt = (
        select(Call)
        .execution_options(populate_existing=True)
        .options(selectinload(Call.participants))
        .where(Call.chat_id == chat_id)
        .order_by(Call.started_at.desc())
    )
    return list((await session.execute(stmt)).scalars().all())


async def get_call_for_member(session: AsyncSession, call_id: UUID, user_id: UUID) -> Call:
    stmt = (
        select(Call)
        .execution_options(populate_existing=True)
        .options(selectinload(Call.participants))
        .join(ChatMember, ChatMember.chat_id == Call.chat_id)
        .where(and_(Call.id == call_id, ChatMember.user_id == user_id))
    )
    call = (await session.execute(stmt)).scalar_one_or_none()
    if call is None:
        raise not_found_exception("Call not found")
    return call


async def invite_call(
    session: AsyncSession,
    *,
    chat_id: UUID,
    initiator_id: UUID,
    call_type: str,
) -> Call:
    chat = await _get_direct_chat_for_member(session, chat_id, initiator_id)
    await _ensure_no_open_call(session, chat.id)

    call = Call(chat_id=chat.id, initiator_id=initiator_id, type=call_type, status="ringing")
    session.add(call)
    await session.flush()
    session.add(CallParticipant(call_id=call.id, user_id=initiator_id))
    await session.commit()
    return await _get_call_with_participants(session, call.id)


async def accept_call(session: AsyncSession, *, call_id: UUID, user_id: UUID) -> Call:
    call = await get_call_for_member(session, call_id, user_id)
    if call.status != "ringing":
        raise bad_request_exception("Only ringing calls can be accepted")
    if call.initiator_id == user_id:
        raise bad_request_exception("Initiator cannot accept their own call")

    participant = (
        await session.execute(
            select(CallParticipant).where(
                and_(CallParticipant.call_id == call_id, CallParticipant.user_id == user_id)
            )
        )
    ).scalar_one_or_none()
    if participant is None:
        session.add(CallParticipant(call_id=call_id, user_id=user_id))
        await session.flush()
    call.status = "active"
    await session.commit()
    return await _get_call_with_participants(session, call.id)


async def reject_call(session: AsyncSession, *, call_id: UUID, user_id: UUID) -> Call:
    call = await get_call_for_member(session, call_id, user_id)
    if call.status != "ringing":
        raise bad_request_exception("Only ringing calls can be rejected")
    if call.initiator_id == user_id:
        raise bad_request_exception("Initiator cannot reject their own call")

    ended_at = datetime.now(UTC)
    call.status = "rejected"
    call.ended_at = ended_at
    await _close_open_participants(session, call.id, ended_at)
    await session.commit()
    return await _get_call_with_participants(session, call.id)


async def end_call(session: AsyncSession, *, call_id: UUID, user_id: UUID) -> Call:
    call = await get_call_for_member(session, call_id, user_id)
    if call.status not in {"ringing", "active"}:
        raise bad_request_exception("Call is already closed")

    ended_at = datetime.now(UTC)
    if call.status == "ringing":
        call.status = "missed" if call.initiator_id == user_id else "rejected"
    else:
        call.status = "ended"
        started_at = call.started_at
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=UTC)
        call.duration_s = max(int((ended_at - started_at).total_seconds()), 0)

    call.ended_at = ended_at
    await _close_open_participants(session, call.id, ended_at)
    await session.commit()
    return await _get_call_with_participants(session, call.id)


async def get_other_call_member_ids(session: AsyncSession, call_id: UUID, user_id: UUID) -> list[UUID]:
    call = await get_call_for_member(session, call_id, user_id)
    member_ids = await list_chat_member_ids(session, call.chat_id)
    return [member_id for member_id in member_ids if member_id != user_id]


def serialize_call(call: Call) -> dict:
    return CallRead.model_validate(call).model_dump(mode="json")


async def _get_direct_chat_for_member(session: AsyncSession, chat_id: UUID, user_id: UUID) -> Chat:
    chat = await get_chat_for_member(session, chat_id, user_id)
    if chat.type != "direct":
        raise bad_request_exception("Calls are only supported for direct chats")
    return chat


async def _ensure_no_open_call(session: AsyncSession, chat_id: UUID) -> None:
    stmt = select(Call.id).where(
        and_(Call.chat_id == chat_id, Call.status.in_(["ringing", "active"]))
    )
    if (await session.execute(stmt)).scalar_one_or_none() is not None:
        raise bad_request_exception("A call is already in progress for this chat")


async def _get_call_with_participants(session: AsyncSession, call_id: UUID) -> Call:
    stmt = (
        select(Call)
        .execution_options(populate_existing=True)
        .options(selectinload(Call.participants))
        .where(Call.id == call_id)
    )
    call = (await session.execute(stmt)).scalar_one_or_none()
    if call is None:
        raise not_found_exception("Call not found")
    return call


async def _close_open_participants(
    session: AsyncSession, call_id: UUID, ended_at: datetime
) -> None:
    stmt = select(CallParticipant).where(
        and_(CallParticipant.call_id == call_id, CallParticipant.left_at.is_(None))
    )
    for participant in (await session.execute(stmt)).scalars().all():
        participant.left_at = ended_at
