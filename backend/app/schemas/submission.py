from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator

from app.core.enums import SubmissionStatus, VoiceNoteStatus
from app.schemas.driver import DriverRead
from app.schemas.event import EventRead
from app.schemas.common import ORMModel, TimestampedModel
from app.schemas.run_group import RunGroupRead
from app.schemas.vehicle import VehicleRead


class SubmissionCreate(ORMModel):
    submission_ref: str = Field(min_length=1, max_length=120)
    correlation_id: str | None = Field(default=None, max_length=36)
    event_id: UUID
    run_group_id: UUID
    driver_id: str | None = Field(default=None, max_length=32)
    vehicle_id: str | None = Field(default=None, max_length=64)
    voice_session_id: UUID | None = None
    raw_text: str | None = None
    image_url: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
    analysis_result: dict[str, Any] | None = None


class OcrPreviewCreate(ORMModel):
    event_id: UUID
    run_group_id: UUID
    driver_id: str | None = Field(default=None, max_length=32)
    vehicle_id: str | None = Field(default=None, max_length=64)
    raw_text: str | None = None
    image_url: str | None = Field(default=None, min_length=1)
    image_urls: list[str] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)


class OcrPreviewRead(ORMModel):
    status: str = "success"
    message: str | None = None
    submission_ref: str | None = None
    correlation_id: str | None = None
    source: str | None = None
    image_url: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    doc_type: str = "unknown"
    template_name: str | None = None
    confidence: float | None = None
    model_used: str | None = None
    fallback_used: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)
    raw_evidence: dict[str, Any] = Field(default_factory=dict)
    field_evidence: list[dict[str, Any]] = Field(default_factory=list)
    normalized_sections: dict[str, Any] = Field(default_factory=dict)
    preprocessing: dict[str, Any] = Field(default_factory=dict)
    structured_data: dict[str, Any] = Field(default_factory=dict)
    raw_text: str | None = None
    review_flags: list[str] = Field(default_factory=list)
    extracted_text: str | None = None
    summary: str | None = None
    recommended_review_status: str = "PENDING"
    parser_version: str | None = None
    model: str | None = None


class OcrWebhookIngestRead(ORMModel):
    status: str
    message: str
    submission_input_id: int
    ocr_id: int | None = None
    submission_ref: str
    correlation_id: str
    source: str
    payload_shape: str
    template_type: str | None = None
    normalized: bool = False
    review_status: str = "PENDING"


class OcrStagedDraftRead(ORMModel):
    submission_input_id: int
    ocr_id: int | None = None
    submission_ref: str | None = None
    correlation_id: str | None = None
    source: str | None = None
    image_url: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    raw_text: str | None = None
    created_at: datetime | None = None
    created_by: str | None = None
    validation_status: str = "PENDING"
    validation_message: str | None = None
    review_status: str | None = None
    template_type: str | None = None
    payload_shape: str = "object"
    normalized: bool = False
    confidence: float | None = None
    document_type: str | None = None
    event_id: str | None = None
    event_name: str | None = None
    run_group: str | None = None
    track: str | None = None
    session_type: str | None = None
    session_number: str | None = None
    driver_id: str | None = None
    vehicle_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RawSubmissionCreate(ORMModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    source: str = Field(min_length=1, max_length=32)
    created_by: str = Field(min_length=1, max_length=120)
    event_id: str = Field(alias="eventId", min_length=1, max_length=120)
    run_group: str = Field(alias="runGroup", min_length=1, max_length=32)
    raw_text: str = Field(min_length=1)
    confidence: float = Field(default=1.0, ge=0, le=1)


class SubmissionUpdate(ORMModel):
    driver_id: str | None = Field(default=None, max_length=32)
    vehicle_id: str | None = Field(default=None, max_length=64)
    raw_text: str | None = None
    image_url: str | None = None
    image_urls: list[str] | None = None
    payload: dict[str, Any] | None = None
    analysis_result: dict[str, Any] | None = None
    status: SubmissionStatus | None = None
    error_message: str | None = Field(default=None, max_length=1000)


class VoiceNoteSessionCreate(ORMModel):
    event_id: UUID
    run_group_id: UUID
    client_session_id: str | None = Field(default=None, max_length=120)
    audio_language: str | None = Field(default=None, max_length=32)


class VoiceNoteSessionUpdate(ORMModel):
    transcript_edited_text: str | None = None
    status: VoiceNoteStatus | None = None
    validation_status: str | None = Field(default=None, max_length=32)
    validation_message: str | None = Field(default=None, max_length=4000)
    audio_language: str | None = Field(default=None, max_length=32)


class SubmissionRead(TimestampedModel):
    submission_ref: str
    correlation_id: str | None = None
    event_id: UUID
    run_group_id: UUID
    driver_id: UUID | None = None
    vehicle_id: UUID | None = None
    created_by_id: UUID
    voice_session_id: UUID | None = None
    raw_text: str | None
    image_url: str | None
    payload: dict[str, Any]
    analysis_result: dict[str, Any] | None = None
    structured_ingest_status: str = "skipped"
    structured_ingest_warnings: list[dict[str, Any]] = Field(default_factory=list)
    status: SubmissionStatus
    error_message: str | None = None
    event: EventRead | None = None
    run_group: RunGroupRead | None = None
    driver: DriverRead | None = None
    vehicle: VehicleRead | None = None
    voice_session: VoiceNoteSessionRead | None = None

    @field_validator("structured_ingest_status", mode="before")
    @classmethod
    def default_structured_ingest_status(cls, value: Any) -> str:
        return value or "skipped"

    @field_validator("structured_ingest_warnings", mode="before")
    @classmethod
    def default_structured_ingest_warnings(cls, value: Any) -> list[dict[str, Any]]:
        return [] if value is None else value


class VoiceNoteTranscriptionAttemptRead(TimestampedModel):
    voice_session_id: UUID
    attempt_number: int
    provider: str
    attempt_status: str
    request_json: dict[str, Any] | None = None
    response_json: dict[str, Any] | None = None
    transcript_text: str | None = None
    confidence: float | None = None
    request_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class VoiceNoteSessionRead(TimestampedModel):
    event_id: UUID
    run_group_id: UUID
    created_by_id: UUID
    submission_id: UUID | None = None
    client_session_id: str | None = None
    status: VoiceNoteStatus
    validation_status: str = "PENDING"
    validation_message: str | None = None
    audio_storage_key: str | None = None
    audio_file_name: str | None = None
    audio_content_type: str | None = None
    audio_size_bytes: int | None = None
    audio_duration_ms: int | None = None
    audio_checksum: str | None = None
    audio_language: str | None = None
    transcript_text: str | None = None
    transcript_edited_text: str | None = None
    transcript_confidence: float | None = None
    transcript_word_count: int | None = None
    transcript_json: dict[str, Any] | None = None
    deepgram_request_json: dict[str, Any] | None = None
    deepgram_response_json: dict[str, Any] | None = None
    deepgram_request_id: str | None = None
    deepgram_model: str | None = None
    retry_count: int = 0
    uploaded_at: datetime | None = None
    transcribed_at: datetime | None = None
    confirmed_at: datetime | None = None
    submitted_at: datetime | None = None
    archived_at: datetime | None = None
    last_error_code: str | None = None
    last_error_message: str | None = None
    attempts: list[VoiceNoteTranscriptionAttemptRead] = Field(default_factory=list)
    audio_download_url: str | None = None


class VoiceTranscriptionRead(ORMModel):
    transcript_text: str
    transcript_confidence: float | None = None
    transcript_word_count: int | None = None
    audio_language: str | None = None
    provider: str = "openai"
    request_id: str | None = None
    model: str | None = None
    openai_request_id: str | None = None
    openai_model: str | None = None
    deepgram_request_id: str | None = None
    deepgram_model: str | None = None
    transcript_json: dict[str, Any] | None = None


class VoiceSubmissionFinalizeCreate(SubmissionCreate):
    voice_session_id: UUID


class RawSubmissionResult(ORMModel):
    status: str
    id_seance: str | None = None
    message: str
    errors: list[dict[str, Any]] = Field(default_factory=list)
