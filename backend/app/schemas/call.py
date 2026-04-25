from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CallInvite(BaseModel):
    chat_id: UUID
    call_type: str = Field(pattern="^(audio|video)$")
    sdp_offer: dict


class CallAccept(BaseModel):
    call_id: UUID
    sdp_answer: dict


class CallReject(BaseModel):
    call_id: UUID


class CallIceCandidate(BaseModel):
    call_id: UUID
    candidate: dict


class CallEnd(BaseModel):
    call_id: UUID


class CallParticipantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    joined_at: datetime
    left_at: datetime | None


class CallRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    chat_id: UUID
    initiator_id: UUID
    type: str
    status: str
    started_at: datetime
    ended_at: datetime | None
    duration_s: int | None
    participants: list[CallParticipantRead]
