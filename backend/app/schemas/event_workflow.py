from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import ORMModel, TimestampedModel
from app.schemas.driver import DriverRead
from app.schemas.event import EventRead
from app.schemas.vehicle import VehicleRead


class EventParticipantCreate(ORMModel):
    driver_id: UUID
    vehicle_id: UUID | None = None
    baseline_setup: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = Field(default=None, max_length=4000)


class EventParticipantUpdate(ORMModel):
    vehicle_id: UUID | None = None
    baseline_setup: dict[str, Any] | None = None
    notes: str | None = Field(default=None, max_length=4000)
    is_active: bool | None = None


class SessionAttachmentRead(TimestampedModel):
    session_id: UUID
    filename: str
    content_type: str
    size_bytes: int


class RaceSessionRead(TimestampedModel):
    event_id: UUID
    participant_id: UUID
    title: str
    session_type: str
    session_number: int
    scheduled_at: datetime | None = None
    status: str
    source: str
    setup_data: dict[str, Any]
    tire_data: dict[str, Any]
    lap_times: list[Any]
    comments: str | None = None
    observations: str | None = None
    adjustments: str | None = None
    additional_data: dict[str, Any]
    carried_from_session_id: UUID | None = None
    attachments: list[SessionAttachmentRead] = Field(default_factory=list)
    setup_diff: dict[str, Any] = Field(default_factory=dict)
    tire_diff: dict[str, Any] = Field(default_factory=dict)


class EventParticipantRead(TimestampedModel):
    event_id: UUID
    driver_id: UUID
    vehicle_id: UUID | None = None
    baseline_setup: dict[str, Any]
    notes: str | None = None
    is_active: bool
    driver: DriverRead | None = None
    vehicle: VehicleRead | None = None
    sessions: list[RaceSessionRead] = Field(default_factory=list)


class RaceScheduleAnalyzeRequest(ORMModel):
    schedule_text: str = Field(min_length=1, max_length=50000)


class RaceScheduleCandidate(ORMModel):
    title: str = Field(min_length=1, max_length=255)
    session_type: str = Field(min_length=1, max_length=64)
    session_number: int = Field(default=1, ge=1, le=99)
    scheduled_at: datetime | None = None
    run_group: str | None = Field(default=None, max_length=64)
    raw_text: str | None = Field(default=None, max_length=1000)


class RaceScheduleAnalyzeRead(ORMModel):
    detected_sessions: list[RaceScheduleCandidate] = Field(default_factory=list)
    ignored_lines: list[str] = Field(default_factory=list)


class RaceScheduleConfirmRequest(ORMModel):
    sessions: list[RaceScheduleCandidate] = Field(default_factory=list)


class RaceScheduleConfirmRead(ORMModel):
    created_count: int
    skipped_count: int
    sessions: list[RaceSessionRead] = Field(default_factory=list)


class RaceSessionUpdate(ORMModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    session_type: str | None = Field(default=None, min_length=1, max_length=64)
    session_number: int | None = Field(default=None, ge=1, le=99)
    scheduled_at: datetime | None = None
    status: str | None = Field(default=None, max_length=32)
    setup_changes: dict[str, Any] | None = None
    tire_changes: dict[str, Any] | None = None
    lap_times: list[Any] | None = None
    comments: str | None = None
    observations: str | None = None
    adjustments: str | None = None
    additional_data: dict[str, Any] | None = None


class EventWeekendSummary(ORMModel):
    participant_count: int
    session_count: int
    completed_session_count: int
    upcoming_session_count: int


class EventWeekendWorkspaceRead(ORMModel):
    event: EventRead
    participants: list[EventParticipantRead] = Field(default_factory=list)
    sessions: list[RaceSessionRead] = Field(default_factory=list)
    summary: EventWeekendSummary
