from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.enums import VoiceNoteStatus
from app.models.voice_note import VoiceNoteAudio, VoiceNoteSession, VoiceNoteTranscriptionAttempt
from app.schemas.submission import SubmissionCreate
from app.services import voice_note_service
from app.services.voice_note_service import (
    _validate_event_submission_window,
    create_transcription_attempt,
    ensure_voice_session_mutable,
    ensure_voice_transcription_allowed,
    load_voice_audio_payload,
    prepare_voice_submission_create,
    process_voice_transcription,
    require_explicit_review_before_finalize,
    store_voice_audio,
)


def _voice_session(
    *,
    status: VoiceNoteStatus = VoiceNoteStatus.DRAFT,
    validation_status: str = "PENDING",
    transcript_text: str | None = "Car rotates well on entry.",
    transcript_edited_text: str | None = None,
    audio_storage_key: str | None = "voice-notes/audio.webm",
) -> VoiceNoteSession:
    return VoiceNoteSession(
        id=uuid4(),
        event_id=uuid4(),
        run_group_id=uuid4(),
        created_by_id=uuid4(),
        status=status,
        validation_status=validation_status,
        transcript_text=transcript_text,
        transcript_edited_text=transcript_edited_text,
        audio_storage_key=audio_storage_key,
    )


class DummySession:
    def __init__(self, audio_record: VoiceNoteAudio | None = None) -> None:
        self.audio_record = audio_record
        self.added: list[object] = []
        self.flushed = 0
        self.get_calls: list[tuple[type, object]] = []

    def add(self, obj) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        self.flushed += 1

    def get(self, model, key):
        self.get_calls.append((model, key))
        if model is VoiceNoteAudio and self.audio_record is not None and key == self.audio_record.voice_session_id:
            return self.audio_record
        return None


def test_validate_event_submission_window_treats_midnight_end_as_full_day_open() -> None:
    now = datetime.now(timezone.utc)
    event = SimpleNamespace(
        start_date=now - timedelta(days=1),
        end_date=datetime(now.year, now.month, now.day, tzinfo=timezone.utc),
    )

    _validate_event_submission_window(event)


@pytest.mark.parametrize(
    ("status_value", "expected_detail"),
    [
        (VoiceNoteStatus.ARCHIVED, "archived and read-only"),
        (VoiceNoteStatus.SUBMITTED, "submitted and read-only"),
    ],
)
def test_ensure_voice_session_mutable_blocks_read_only_states(
    status_value: VoiceNoteStatus,
    expected_detail: str,
) -> None:
    session = _voice_session(status=status_value)

    with pytest.raises(HTTPException) as exc_info:
        ensure_voice_session_mutable(session)

    assert exc_info.value.status_code == 400
    assert expected_detail in str(exc_info.value.detail)


def test_ensure_voice_transcription_allowed_requires_uploaded_audio() -> None:
    session = _voice_session(audio_storage_key=None)

    with pytest.raises(HTTPException) as exc_info:
        ensure_voice_transcription_allowed(session)

    assert exc_info.value.status_code == 400
    assert "Upload audio before transcription" in str(exc_info.value.detail)


@pytest.mark.parametrize(
    "status_value",
    [VoiceNoteStatus.PENDING_TRANSCRIPTION, VoiceNoteStatus.TRANSCRIBING],
)
def test_ensure_voice_transcription_allowed_blocks_duplicate_in_progress_attempts(
    status_value: VoiceNoteStatus,
) -> None:
    session = _voice_session(status=status_value)

    with pytest.raises(HTTPException) as exc_info:
        ensure_voice_transcription_allowed(session)

    assert exc_info.value.status_code == 400
    assert "already in progress" in str(exc_info.value.detail)


def test_ensure_voice_transcription_allowed_blocks_restarting_completed_start_flow() -> None:
    session = _voice_session(status=VoiceNoteStatus.PENDING_REVIEW)

    with pytest.raises(HTTPException) as exc_info:
        ensure_voice_transcription_allowed(session, action="start")

    assert exc_info.value.status_code == 400
    assert "Use retry" in str(exc_info.value.detail)


def test_require_explicit_review_before_finalize_rejects_unconfirmed_low_confidence_session() -> None:
    session = _voice_session(
        status=VoiceNoteStatus.PENDING_REVIEW,
        validation_status="REVIEW_REQUIRED",
    )

    with pytest.raises(HTTPException) as exc_info:
        require_explicit_review_before_finalize(session)

    assert exc_info.value.status_code == 400
    assert "must be reviewed and confirmed" in str(exc_info.value.detail)


def test_prepare_voice_submission_create_links_voice_session_and_transcript() -> None:
    session = _voice_session(
        status=VoiceNoteStatus.CONFIRMED,
        validation_status="VALIDATED",
        transcript_text="Base transcript from OpenAI.",
        transcript_edited_text="Reviewed transcript for final submission.",
    )
    submission = SubmissionCreate(
        submission_ref="VOICE-REF-001",
        correlation_id=str(uuid4()),
        event_id=session.event_id,
        run_group_id=session.run_group_id,
        driver_id="DRV-01",
        vehicle_id="CAR-01",
        payload={"data": {"session_id": "VOICE-SESSION-001"}},
        analysis_result={"confidence": 0.91},
    )

    prepared = prepare_voice_submission_create(submission, voice_session=session)

    assert prepared.voice_session_id == session.id
    assert prepared.raw_text == "Reviewed transcript for final submission."
    assert prepared.analysis_result["source_type"] == "voice"
    assert prepared.analysis_result["raw_input_mode"] == "voice"
    assert prepared.analysis_result["voice_input_used"] is True
    assert prepared.analysis_result["has_voice_notes"] is True
    assert prepared.analysis_result["voice_session_id"] == str(session.id)


def test_prepare_voice_submission_create_rejects_empty_transcript() -> None:
    session = _voice_session(transcript_text=None, transcript_edited_text=None)
    submission = SubmissionCreate(
        submission_ref="VOICE-REF-EMPTY",
        correlation_id=str(uuid4()),
        event_id=session.event_id,
        run_group_id=session.run_group_id,
        driver_id="DRV-01",
        vehicle_id="CAR-01",
        payload={"data": {"session_id": "VOICE-SESSION-EMPTY"}},
        analysis_result={},
    )

    with pytest.raises(HTTPException) as exc_info:
        prepare_voice_submission_create(submission, voice_session=session)

    assert exc_info.value.status_code == 400
    assert "Transcript cannot be empty" in str(exc_info.value.detail)


def test_store_voice_audio_saves_database_blob_and_local_fallback(tmp_path, monkeypatch) -> None:
    session = _voice_session()
    db = DummySession()
    audio_bytes = b"fake-webm-audio"

    monkeypatch.setattr(voice_note_service, "_audit", lambda *args, **kwargs: None)
    monkeypatch.setattr(voice_note_service, "_audio_storage_root", lambda: tmp_path)

    stored = store_voice_audio(
        db,
        voice_session=session,
        audio_bytes=audio_bytes,
        content_type="audio/webm;codecs=opus",
        file_name="driver-note.webm",
        duration_ms=1234,
        audio_language="en",
    )

    audio_record = next(obj for obj in db.added if isinstance(obj, VoiceNoteAudio))

    assert stored is session
    assert session.audio_record is audio_record
    assert session.audio_storage_key == f"{session.event_id}/{session.id}/recording.webm"
    assert session.audio_file_name == "driver-note.webm"
    assert session.audio_content_type == "audio/webm"
    assert session.audio_size_bytes == len(audio_bytes)
    assert session.audio_checksum is not None
    assert session.audio_language == "en"
    assert session.audio_download_url == f"/api/v1/submissions/voice-sessions/{session.id}/audio"
    assert session.status == VoiceNoteStatus.UPLOADED
    assert session.validation_status == "PENDING"
    assert audio_record.audio_blob == audio_bytes
    assert audio_record.mime_type == "audio/webm"
    assert audio_record.file_extension == "webm"
    assert audio_record.size_bytes == len(audio_bytes)
    assert audio_record.original_filename == "driver-note.webm"
    assert audio_record.created_at is not None
    assert (tmp_path / str(session.event_id) / str(session.id) / "recording.webm").read_bytes() == audio_bytes


def test_create_transcription_attempt_uses_openai_provider() -> None:
    session = _voice_session(status=VoiceNoteStatus.UPLOADED)
    db = DummySession()

    attempt = create_transcription_attempt(
        db,
        voice_session=session,
        request_json={"voice_session_id": str(session.id)},
    )

    assert attempt.provider == "openai"
    assert attempt.attempt_number == 1
    assert attempt.attempt_status == "PENDING"
    assert session.status == VoiceNoteStatus.PENDING_TRANSCRIPTION


def test_process_voice_transcription_saves_openai_metadata(monkeypatch) -> None:
    session = _voice_session(status=VoiceNoteStatus.UPLOADED)
    session.audio_file_name = "driver-note.webm"
    session.audio_content_type = "audio/webm"
    session.audio_size_bytes = 10
    audio_record = VoiceNoteAudio(
        voice_session_id=session.id,
        audio_blob=b"audio-data",
        mime_type="audio/webm",
        file_extension="webm",
        size_bytes=10,
        original_filename="driver-note.webm",
        created_at=datetime.now(timezone.utc),
    )
    attempt = VoiceNoteTranscriptionAttempt(
        id=uuid4(),
        voice_session_id=session.id,
        attempt_number=1,
        provider="openai",
        attempt_status="PENDING",
        request_json={},
    )
    db = DummySession(audio_record=audio_record)

    monkeypatch.setattr(voice_note_service, "_audit", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        voice_note_service,
        "transcribe_audio_bytes",
        lambda *_args, **_kwargs: (
            {"text": "Car rotates better on entry.", "_request_id": "req_openai_voice"},
            {
                "provider": "openai",
                "model": "gpt-4o-transcribe",
                "request_id": "req_openai_voice",
            },
        ),
    )
    monkeypatch.setattr(
        voice_note_service,
        "extract_transcription_result",
        lambda _payload: {
            "transcript_text": "Car rotates better on entry.",
            "transcript_confidence": None,
            "transcript_word_count": 5,
            "audio_language": None,
            "openai_request_id": "req_openai_voice",
            "openai_model": "gpt-4o-transcribe",
            "transcript_json": {"provider": "openai", "text": "Car rotates better on entry."},
        },
    )

    processed = process_voice_transcription(db, voice_session=session, attempt=attempt)

    assert processed is session
    assert session.status == VoiceNoteStatus.PENDING_REVIEW
    assert session.validation_status == "PENDING"
    assert session.transcript_text == "Car rotates better on entry."
    assert session.deepgram_request_json["provider"] == "openai"
    assert session.deepgram_request_json["request"]["model"] == "gpt-4o-transcribe"
    assert session.deepgram_request_id == "req_openai_voice"
    assert session.deepgram_model == "gpt-4o-transcribe"
    assert attempt.attempt_status == "SUCCESS"
    assert attempt.request_id == "req_openai_voice"


def test_load_voice_audio_payload_prefers_database_blob(tmp_path, monkeypatch) -> None:
    session = _voice_session(audio_storage_key="event/session/recording.webm")
    audio_record = VoiceNoteAudio(
        voice_session_id=session.id,
        audio_blob=b"database-bytes",
        mime_type="audio/ogg",
        file_extension="ogg",
        size_bytes=14,
        original_filename="database-note.ogg",
        created_at=datetime.now(timezone.utc),
    )
    db = DummySession(audio_record=audio_record)

    local_path = tmp_path / "event" / "session" / "recording.webm"
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_bytes(b"local-bytes")

    monkeypatch.setattr(voice_note_service, "_audio_storage_root", lambda: tmp_path)

    payload = load_voice_audio_payload(db, voice_session=session)

    assert payload == (b"database-bytes", "audio/ogg", "database-note.ogg", "database")


def test_load_voice_audio_payload_falls_back_to_local_file(tmp_path, monkeypatch) -> None:
    session = _voice_session(audio_storage_key="event/session/recording.webm")
    session.audio_file_name = "driver-note.webm"
    session.audio_content_type = "audio/webm"
    db = DummySession()

    local_path = tmp_path / "event" / "session" / "recording.webm"
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_bytes(b"local-bytes")

    monkeypatch.setattr(voice_note_service, "_audio_storage_root", lambda: tmp_path)

    payload = load_voice_audio_payload(db, voice_session=session)

    assert payload == (b"local-bytes", "audio/webm", "driver-note.webm", "disk")
