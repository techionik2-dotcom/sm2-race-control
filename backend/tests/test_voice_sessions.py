from types import SimpleNamespace
from uuid import uuid4

from fastapi import BackgroundTasks

from app.api.v1.endpoints import voice_sessions as voice_sessions_endpoints
from app.core.enums import VoiceNoteStatus
from app.models.voice_note import VoiceNoteSession
from app.schemas.submission import VoiceSubmissionFinalizeCreate
from app.services import voice_note_service


class DummySession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.flushed = 0
        self.commits = 0

    def add(self, obj) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        self.flushed += 1

    def commit(self) -> None:
        self.commits += 1

    def get(self, _model, _key):
        return None


def _voice_session() -> VoiceNoteSession:
    return VoiceNoteSession(
        id=uuid4(),
        event_id=uuid4(),
        run_group_id=uuid4(),
        created_by_id=uuid4(),
        status=VoiceNoteStatus.PENDING_REVIEW,
        validation_status="PENDING",
        transcript_text="Base transcript from OpenAI.",
        transcript_edited_text="Reviewed transcript for final submission.",
        audio_storage_key="event/session/recording.webm",
        audio_file_name="driver-note.webm",
        audio_content_type="audio/webm",
    )


def test_read_voice_audio_endpoint_returns_db_audio_payload(monkeypatch) -> None:
    session = _voice_session()
    db = DummySession()
    current_user = SimpleNamespace(id=uuid4(), role="OWNER")

    monkeypatch.setattr(voice_sessions_endpoints, "get_voice_session_for_user", lambda *_args, **_kwargs: session)
    monkeypatch.setattr(
        voice_sessions_endpoints,
        "load_voice_audio_payload",
        lambda *_args, **_kwargs: (b"db-bytes", "audio/webm", "database-note.webm", "database"),
    )

    response = voice_sessions_endpoints.read_voice_audio_endpoint(
        session.id,
        db=db,
        current_user=current_user,
    )

    assert response.status_code == 200
    assert response.body == b"db-bytes"
    assert response.media_type == "audio/webm"
    assert response.headers["content-disposition"] == 'inline; filename="database-note.webm"'
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_finalize_voice_submission_keeps_voice_metadata_and_transcript(monkeypatch) -> None:
    session = _voice_session()
    db = DummySession()
    current_user = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")
    background_tasks = BackgroundTasks()
    captured = {}
    created_submission = SimpleNamespace(id=uuid4(), status="PENDING", submission_ref="VOICE-SUB-1")

    payload = VoiceSubmissionFinalizeCreate(
        submission_ref="VOICE-REF-001",
        correlation_id=str(uuid4()),
        event_id=session.event_id,
        run_group_id=session.run_group_id,
        driver_id="DRV-01",
        vehicle_id="CAR-01",
        voice_session_id=session.id,
        raw_text=None,
        payload={"data": {"session_id": "VOICE-SESSION-001"}},
        analysis_result={"confidence": 0.91},
    )

    monkeypatch.setattr(voice_sessions_endpoints, "get_voice_session_for_user", lambda *_args, **_kwargs: session)
    monkeypatch.setattr(
        voice_sessions_endpoints,
        "_ensure_voice_session_event_context",
        lambda *_args, **_kwargs: (SimpleNamespace(id=session.event_id), SimpleNamespace(id=session.run_group_id)),
    )
    monkeypatch.setattr(voice_note_service, "_audit", lambda *args, **kwargs: None)

    def fake_create_submission(*, submission_in, **_kwargs):
        captured["submission_in"] = submission_in
        return created_submission

    monkeypatch.setattr(voice_sessions_endpoints, "create_submission", fake_create_submission)

    result = voice_sessions_endpoints.finalize_voice_submission_endpoint(
        session.id,
        payload,
        background_tasks,
        db=db,
        current_user=current_user,
    )

    assert result is created_submission
    assert captured["submission_in"].voice_session_id == session.id
    assert captured["submission_in"].raw_text == "Reviewed transcript for final submission."
    assert captured["submission_in"].analysis_result["source_type"] == "voice"
    assert captured["submission_in"].analysis_result["raw_input_mode"] == "voice"
    assert captured["submission_in"].analysis_result["voice_input_used"] is True
    assert captured["submission_in"].analysis_result["has_voice_notes"] is True
    assert captured["submission_in"].analysis_result["voice_session_id"] == str(session.id)
    assert session.transcript_edited_text == "Reviewed transcript for final submission."
    assert session.transcript_text == "Base transcript from OpenAI."
    assert session.confirmed_at is not None
    assert session.status == VoiceNoteStatus.SUBMITTED
    assert session.submission_id == created_submission.id
    assert session.submitted_at is not None
    assert db.commits == 1
