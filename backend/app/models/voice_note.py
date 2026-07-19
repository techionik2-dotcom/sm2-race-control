from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Integer, JSON, LargeBinary, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, DB_SCHEMA
from app.core.enums import VoiceNoteStatus
from app.models.base import TimestampMixin


class VoiceNoteSession(Base, TimestampMixin):
    __tablename__ = "voice_note_sessions"
    __table_args__ = {"schema": DB_SCHEMA}

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(f"{DB_SCHEMA}.events.id"), nullable=False)
    run_group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(f"{DB_SCHEMA}.run_groups.id"), nullable=False)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(f"{DB_SCHEMA}.users.id"), nullable=False)
    submission_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{DB_SCHEMA}.submissions.id", ondelete="SET NULL"),
        unique=True,
        nullable=True,
    )
    client_session_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[VoiceNoteStatus] = mapped_column(
        Enum(VoiceNoteStatus, name="voice_note_status", schema=DB_SCHEMA),
        nullable=False,
        default=VoiceNoteStatus.DRAFT,
    )
    validation_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    validation_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_storage_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    audio_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    audio_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    audio_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    audio_checksum: Mapped[str | None] = mapped_column(String(128), nullable=True)
    audio_language: Mapped[str | None] = mapped_column(String(32), nullable=True)
    transcript_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_edited_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_confidence: Mapped[float | None] = mapped_column(nullable=True)
    transcript_word_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    transcript_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    deepgram_request_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    deepgram_response_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    deepgram_request_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    deepgram_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uploaded_at: Mapped[datetime | None] = mapped_column(nullable=True)
    transcribed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_error_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    event = relationship("Event")
    run_group = relationship("RunGroup")
    created_by_user = relationship("User")
    audio_record = relationship(
        "VoiceNoteAudio",
        back_populates="voice_session",
        uselist=False,
        cascade="all, delete-orphan",
        single_parent=True,
    )
    submission = relationship(
        "Submission",
        foreign_keys=[submission_id],
        uselist=False,
    )
    attempts = relationship(
        "VoiceNoteTranscriptionAttempt",
        back_populates="voice_session",
        cascade="all, delete-orphan",
        order_by="VoiceNoteTranscriptionAttempt.attempt_number",
    )

    @property
    def audio_download_url(self) -> str | None:
        if not self.audio_storage_key:
            return None
        return f"/api/v1/submissions/voice-sessions/{self.id}/audio"


class VoiceNoteAudio(Base):
    __tablename__ = "voice_note_audio"
    __table_args__ = {"schema": DB_SCHEMA}

    voice_session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{DB_SCHEMA}.voice_note_sessions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    audio_blob: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    file_extension: Mapped[str] = mapped_column(String(16), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    voice_session = relationship("VoiceNoteSession", back_populates="audio_record")


class VoiceNoteTranscriptionAttempt(Base, TimestampMixin):
    __tablename__ = "voice_note_transcription_attempts"
    __table_args__ = {"schema": DB_SCHEMA}

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    voice_session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{DB_SCHEMA}.voice_note_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="openai")
    attempt_status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")
    request_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    response_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    transcript_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float | None] = mapped_column(nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    voice_session = relationship("VoiceNoteSession", back_populates="attempts")
