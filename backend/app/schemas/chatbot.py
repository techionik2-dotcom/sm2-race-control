from __future__ import annotations

from datetime import date, datetime, time
from typing import Any, Literal
from uuid import UUID

from pydantic import ConfigDict, Field, model_validator

from app.schemas.common import ORMModel


BadgeTone = Literal["neutral", "success", "warning", "danger", "accent", "info"]


class ChatbotDirectoryChoice(ORMModel):
    value: str
    label: str
    sublabel: str | None = None
    tone: BadgeTone = "neutral"


class ChatbotRecordReference(ORMModel):
    kind: str
    value: str
    label: str
    details: str | None = None


class ChatbotQuery(ORMModel):
    message: str | None = Field(default=None, min_length=1, max_length=500)
    query: str | None = Field(default=None, min_length=1, max_length=500)
    conversation_id: str | None = Field(default=None, max_length=64)
    event_id: UUID | None = None
    session_id: str | None = Field(default=None, max_length=120)
    driver_id: str | None = Field(default=None, max_length=64)
    vehicle_id: str | None = Field(default=None, max_length=64)
    car_number: str | None = Field(default=None, max_length=64)
    limit: int = Field(default=5, ge=1, le=12)

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    @model_validator(mode="after")
    def _normalize_message(self) -> "ChatbotQuery":
        message = (self.message or self.query or "").strip()
        if not message:
            raise ValueError("message is required")

        self.message = message
        if self.query is None:
            self.query = message
        return self


class ChatbotEventChoice(ORMModel):
    value: str
    label: str
    sublabel: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    tone: BadgeTone = "neutral"


class ChatbotSessionChoice(ORMModel):
    value: str
    label: str
    sublabel: str | None = None
    session_date: date | None = None
    session_time: time | None = None
    track: str | None = None
    event_id: str | None = None
    driver_id: str | None = None
    vehicle_id: str | None = None
    tone: BadgeTone = "neutral"


class ChatbotField(ORMModel):
    label: str
    value: str


class ChatbotCard(ORMModel):
    title: str
    subtitle: str | None = None
    badge: str | None = None
    badge_tone: BadgeTone = "neutral"
    icon_key: str | None = None
    fields: list[ChatbotField] = Field(default_factory=list)


class ChatbotSection(ORMModel):
    title: str
    subtitle: str | None = None
    variant: Literal["fields", "cards", "table"] = "fields"
    icon_key: str | None = None
    fields: list[ChatbotField] = Field(default_factory=list)
    cards: list[ChatbotCard] = Field(default_factory=list)
    table_headers: list[str] = Field(default_factory=list)
    table_rows: list[list[str]] = Field(default_factory=list)


class ChatbotContextResponse(ORMModel):
    events: list[ChatbotEventChoice] = Field(default_factory=list)
    sessions: list[ChatbotSessionChoice] = Field(default_factory=list)
    drivers: list[ChatbotDirectoryChoice] = Field(default_factory=list)
    vehicles: list[ChatbotDirectoryChoice] = Field(default_factory=list)
    default_event_id: UUID | None = None
    default_session_id: str | None = None
    default_driver_id: str | None = None
    default_vehicle_id: str | None = None
    has_event_data: bool = False
    has_session_data: bool = False
    has_driver_data: bool = False
    has_vehicle_data: bool = False
    source_label: str = "SM2 Racing Database"


class ChatbotResponse(ORMModel):
    kind: Literal[
        "message",
        "empty",
        "events",
        "sessions",
        "setup",
        "compare",
        "fleet",
        "submissions",
        "recommendation",
        "coaching",
    ]
    title: str
    summary: str
    answer: str | None = None
    data_source: str | None = None
    source_label: str | None = None
    data_found: bool = False
    no_data_message: str | None = None
    records_used: list[ChatbotRecordReference] = Field(default_factory=list)
    intent: str | None = None
    status: Literal["success", "not_found", "error", "unsupported", "needs_context"] = "success"
    data: dict[str, Any] | list[Any] | None = None
    error: str | None = None
    error_message: str | None = None
    sections: list[ChatbotSection] = Field(default_factory=list)
    follow_up: list[str] = Field(default_factory=list)
    generated_at: datetime

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    @model_validator(mode="after")
    def _normalize_response(self) -> "ChatbotResponse":
        if self.answer is None:
            self.answer = self.summary

        if self.data_source is None:
            self.data_source = self.source_label or "SM2 Racing Database"

        if self.source_label is None:
            self.source_label = self.data_source

        if self.intent is None:
            self.intent = self.kind

        if self.status == "success" and not self.data_found:
            self.status = "not_found"

        if self.error_message is None and self.error is not None:
            self.error_message = self.error

        if self.error is None and self.error_message is not None:
            self.error = self.error_message

        if self.status == "not_found" and self.error_message is None:
            self.error_message = self.no_data_message or "No matching data was found in the SM2 Racing database."

        if self.status == "not_found" and self.error is None:
            self.error = self.error_message

        return self
