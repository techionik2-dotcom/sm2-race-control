from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.core.database import get_session_local
from app.core.enums import UserRole, VoiceNoteStatus
from app.models.event import Event
from app.models.run_group import RunGroup
from app.models.submission import Submission
from app.models.user import User
from app.models.voice_note import VoiceNoteAudio, VoiceNoteSession, VoiceNoteTranscriptionAttempt
from app.schemas.submission import SubmissionCreate
from app.services.openai_transcription_service import (
    OpenAITranscriptionError,
    extract_transcription_result,
    transcribe_audio_bytes,
)
from app.services.submission_ingest_service import _write_audit_log
from app.services.submission_payload_service import normalize_optional_text


settings = get_settings()
logger = logging.getLogger(__name__)

ALLOWED_AUDIO_CONTENT_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/aac",
    "video/webm",
}
CONTENT_TYPE_EXTENSIONS = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/aac": ".aac",
    "video/webm": ".webm",
}


def _table(name: str) -> str:
    return f"{settings.database_schema}.{name}"


def _audio_storage_root() -> Path:
    root = Path(settings.voice_storage_root).expanduser()
    if not root.is_absolute():
        root = Path.cwd() / root
    return root


def _normalized_content_type(content_type: str | None) -> str:
    return (content_type or "").split(";")[0].strip().lower()


def _audio_extension(content_type: str | None, file_name: str | None = None) -> str:
    normalized_content_type = _normalized_content_type(content_type)
    if normalized_content_type in CONTENT_TYPE_EXTENSIONS:
        return CONTENT_TYPE_EXTENSIONS[normalized_content_type]

    if file_name:
        suffix = Path(file_name).suffix.lower()
        if suffix:
            return suffix[:8]

    return ".webm"


def _is_allowed_audio_content_type(content_type: str | None) -> bool:
    normalized_content_type = _normalized_content_type(content_type)
    return normalized_content_type in ALLOWED_AUDIO_CONTENT_TYPES


def _voice_session_query(*, load_attempts: bool = True):
    stmt = select(VoiceNoteSession)
    if load_attempts:
        stmt = stmt.options(joinedload(VoiceNoteSession.attempts))
    return stmt


def get_voice_session(
    db: Session,
    voice_session_id: UUID,
    *,
    load_attempts: bool = True,
) -> VoiceNoteSession | None:
    stmt = _voice_session_query(load_attempts=load_attempts).where(VoiceNoteSession.id == voice_session_id)
    return db.scalar(stmt)


def get_voice_session_for_user(
    db: Session,
    voice_session_id: UUID,
    *,
    current_user: User,
    load_attempts: bool = True,
) -> VoiceNoteSession:
    voice_session = get_voice_session(db, voice_session_id, load_attempts=load_attempts)
    if voice_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice note session not found")

    if current_user.role not in (UserRole.OWNER, UserRole.ADMIN) and voice_session.created_by_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return voice_session


def _validate_event_submission_window(event: Event) -> None:
    now = datetime.now(timezone.utc)
    event_start = getattr(event, "start_date", None)
    event_end = getattr(event, "end_date", None)

    if event_start is not None:
        if event_start.tzinfo is None or event_start.tzinfo.utcoffset(event_start) is None:
            event_start = event_start.replace(tzinfo=timezone.utc)
        else:
            event_start = event_start.astimezone(timezone.utc)
        if now < event_start:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Voice submissions open when the event start date arrives",
            )

    if event_end is not None:
        if event_end.tzinfo is None or event_end.tzinfo.utcoffset(event_end) is None:
            event_end = event_end.replace(tzinfo=timezone.utc)
        else:
            event_end = event_end.astimezone(timezone.utc)
        if (
            event_end.hour == 0
            and event_end.minute == 0
            and event_end.second == 0
            and event_end.microsecond == 0
        ):
            event_end = event_end + timedelta(days=1)
        if now >= event_end:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Voice submissions close after the event end date passes",
            )


def _ensure_voice_session_event_context(
    db: Session,
    *,
    event_id: UUID,
    run_group_id: UUID,
) -> tuple[Event, RunGroup]:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if not event.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Event is archived")

    run_group = db.get(RunGroup, run_group_id)
    if run_group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run group not found")
    if run_group.event_id != event.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Run group does not belong to the event",
        )

    _validate_event_submission_window(event)
    return event, run_group


def _audit(
    db: Session,
    *,
    action: str,
    status_value: str,
    message: str | None = None,
    payload: dict[str, Any] | None = None,
    actor: str | None = None,
) -> None:
    try:
        _write_audit_log(
            db,
            action=action,
            status=status_value,
            message=message,
            payload=payload or {},
            user=actor or "voice-system",
        )
    except Exception:  # pragma: no cover - audit logging must never block voice flow
        logger.warning("Voice audit log write skipped for action %s", action, exc_info=True)


def _voice_storage_directory(voice_session: VoiceNoteSession) -> Path:
    return _audio_storage_root() / str(voice_session.event_id) / str(voice_session.id)


def _voice_storage_key(path: Path) -> str:
    root = _audio_storage_root().resolve()
    try:
        return str(path.resolve().relative_to(root)).replace("\\", "/")
    except Exception:
        return str(path.name)


def _voice_audio_filename(
    voice_session: VoiceNoteSession,
    *,
    audio_record: VoiceNoteAudio | None = None,
    fallback_path: Path | None = None,
) -> str:
    original_filename = normalize_optional_text(audio_record.original_filename if audio_record else None)
    if original_filename:
        return Path(original_filename).name

    session_filename = normalize_optional_text(voice_session.audio_file_name)
    if session_filename:
        return Path(session_filename).name

    if audio_record is not None:
        file_extension = normalize_optional_text(audio_record.file_extension)
        if file_extension:
            normalized_extension = file_extension.lstrip(".")
            return f"recording.{normalized_extension}"

    if fallback_path is not None:
        return fallback_path.name

    return "voice-note.webm"


def load_voice_audio_payload(
    db: Session,
    *,
    voice_session: VoiceNoteSession,
) -> tuple[bytes, str, str, str]:
    audio_record = db.get(VoiceNoteAudio, voice_session.id)
    if audio_record is not None and audio_record.audio_blob:
        mime_type = (
            normalize_optional_text(audio_record.mime_type)
            or normalize_optional_text(voice_session.audio_content_type)
            or "application/octet-stream"
        )
        return (
            bytes(audio_record.audio_blob),
            mime_type,
            _voice_audio_filename(voice_session, audio_record=audio_record),
            "database",
        )

    audio_path = _voice_audio_path(voice_session)
    if not audio_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice audio file not found")

    mime_type = normalize_optional_text(voice_session.audio_content_type) or "application/octet-stream"
    return (
        audio_path.read_bytes(),
        mime_type,
        _voice_audio_filename(voice_session, fallback_path=audio_path),
        "disk",
    )


def create_voice_session(
    db: Session,
    *,
    event: Event,
    run_group: RunGroup,
    current_user: User,
    client_session_id: str | None = None,
    audio_language: str | None = None,
) -> VoiceNoteSession:
    voice_session = VoiceNoteSession(
        event_id=event.id,
        run_group_id=run_group.id,
        created_by_id=current_user.id,
        client_session_id=normalize_optional_text(client_session_id),
        status=VoiceNoteStatus.RECORDING,
        validation_status="PENDING",
        audio_language=normalize_optional_text(audio_language),
    )
    db.add(voice_session)
    db.flush()

    _audit(
        db,
        action="voice.session.create",
        status_value="SUCCESS",
        message="Created a voice note session",
        payload={
            "voice_session_id": str(voice_session.id),
            "event_id": str(event.id),
            "run_group_id": str(run_group.id),
            "created_by_id": str(current_user.id),
            "client_session_id": voice_session.client_session_id,
        },
        actor=current_user.name or current_user.email,
    )
    return voice_session


def store_voice_audio(
    db: Session,
    *,
    voice_session: VoiceNoteSession,
    audio_bytes: bytes,
    content_type: str | None,
    file_name: str | None,
    duration_ms: int | None,
    audio_language: str | None = None,
) -> VoiceNoteSession:
    if not audio_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No audio was captured")

    if len(audio_bytes) > settings.voice_upload_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Audio file exceeds the allowed size",
        )

    normalized_content_type = _normalized_content_type(content_type)
    if not _is_allowed_audio_content_type(normalized_content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported audio format",
        )

    if duration_ms is not None:
        try:
            duration_seconds = max(0, int(duration_ms)) / 1000.0
        except (TypeError, ValueError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Audio duration is invalid")
        if duration_seconds > settings.voice_upload_max_duration_seconds:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Audio duration exceeds the allowed limit",
            )

    extension = _audio_extension(normalized_content_type, file_name).lstrip(".") or "webm"
    storage_directory = _voice_storage_directory(voice_session)
    storage_path = storage_directory / f"recording.{extension}"

    checksum = hashlib.sha256(audio_bytes).hexdigest()

    audio_record = db.get(VoiceNoteAudio, voice_session.id)
    if audio_record is None:
        audio_record = VoiceNoteAudio(
            voice_session_id=voice_session.id,
            created_at=datetime.now(timezone.utc),
        )
    if audio_record.created_at is None:
        audio_record.created_at = datetime.now(timezone.utc)
    audio_record.audio_blob = audio_bytes
    audio_record.mime_type = normalized_content_type or "application/octet-stream"
    audio_record.file_extension = extension
    audio_record.size_bytes = len(audio_bytes)
    audio_record.original_filename = normalize_optional_text(file_name) or storage_path.name

    voice_session.audio_record = audio_record
    voice_session.audio_storage_key = _voice_storage_key(storage_path)
    voice_session.audio_file_name = audio_record.original_filename
    voice_session.audio_content_type = audio_record.mime_type
    voice_session.audio_size_bytes = len(audio_bytes)
    voice_session.audio_duration_ms = int(duration_ms) if duration_ms is not None else None
    voice_session.audio_checksum = checksum
    if audio_language:
        voice_session.audio_language = normalize_optional_text(audio_language)
    voice_session.uploaded_at = datetime.now(timezone.utc)
    voice_session.status = VoiceNoteStatus.UPLOADED
    voice_session.validation_status = "PENDING"
    voice_session.validation_message = None
    voice_session.last_error_code = None
    voice_session.last_error_message = None

    db.add(audio_record)
    db.add(voice_session)
    db.flush()

    try:
        storage_directory.mkdir(parents=True, exist_ok=True)
        storage_path.write_bytes(audio_bytes)
    except OSError:
        logger.warning(
            "Unable to write local fallback audio for voice session %s",
            voice_session.id,
            exc_info=True,
        )

    _audit(
        db,
        action="voice.audio.upload",
        status_value="SUCCESS",
        message="Stored voice note audio",
        payload={
            "voice_session_id": str(voice_session.id),
            "audio_storage_key": voice_session.audio_storage_key,
            "audio_size_bytes": voice_session.audio_size_bytes,
            "audio_duration_ms": voice_session.audio_duration_ms,
            "audio_content_type": voice_session.audio_content_type,
            "audio_checksum": voice_session.audio_checksum,
        },
    )
    return voice_session


def create_transcription_attempt(
    db: Session,
    *,
    voice_session: VoiceNoteSession,
    request_json: dict[str, Any],
) -> VoiceNoteTranscriptionAttempt:
    next_attempt_number = (
        max((attempt.attempt_number for attempt in voice_session.attempts), default=0) + 1
    )
    voice_session.retry_count = next_attempt_number
    voice_session.status = VoiceNoteStatus.PENDING_TRANSCRIPTION
    voice_session.validation_message = None
    db.add(voice_session)
    db.flush()

    attempt = VoiceNoteTranscriptionAttempt(
        voice_session_id=voice_session.id,
        attempt_number=next_attempt_number,
        provider="openai",
        attempt_status="PENDING",
        request_json=request_json,
    )
    db.add(attempt)
    db.flush()
    return attempt


def ensure_voice_session_mutable(
    voice_session: VoiceNoteSession,
    *,
    allow_archive_transition: bool = False,
) -> None:
    if voice_session.status == VoiceNoteStatus.SUBMITTED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Voice session is submitted and read-only")

    if voice_session.status == VoiceNoteStatus.ARCHIVED and not allow_archive_transition:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Voice session is archived and read-only")


def ensure_voice_transcription_allowed(
    voice_session: VoiceNoteSession,
    *,
    action: str = "start",
) -> None:
    ensure_voice_session_mutable(voice_session)

    if not voice_session.audio_storage_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload audio before transcription")

    if voice_session.status in {VoiceNoteStatus.PENDING_TRANSCRIPTION, VoiceNoteStatus.TRANSCRIBING}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Voice transcription is already in progress")

    if action == "start" and voice_session.status in {VoiceNoteStatus.PENDING_REVIEW, VoiceNoteStatus.CONFIRMED}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Voice transcription already completed. Use retry if a new transcription attempt is required",
        )


def require_explicit_review_before_finalize(voice_session: VoiceNoteSession) -> None:
    if voice_session.validation_status == "REVIEW_REQUIRED" and voice_session.status != VoiceNoteStatus.CONFIRMED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Low-confidence transcripts must be reviewed and confirmed before final submission",
        )


def _voice_audio_path(voice_session: VoiceNoteSession) -> Path:
    if not voice_session.audio_storage_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice audio not found")
    return _audio_storage_root() / voice_session.audio_storage_key


def _normalize_confidence(value: Any) -> float | None:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric < 0:
        return None
    if numeric > 1:
        if numeric <= 100:
            numeric = numeric / 100.0
        else:
            return None
    return round(numeric, 4)


def process_voice_transcription(
    db: Session,
    *,
    voice_session: VoiceNoteSession,
    attempt: VoiceNoteTranscriptionAttempt,
) -> VoiceNoteSession:
    audio_bytes, audio_content_type, audio_file_name, audio_source = load_voice_audio_payload(
        db,
        voice_session=voice_session,
    )

    voice_session.status = VoiceNoteStatus.TRANSCRIBING
    voice_session.last_error_code = None
    voice_session.last_error_message = None
    db.add(voice_session)
    db.flush()

    request_json = {
        "audio_storage_key": voice_session.audio_storage_key,
        "audio_file_name": audio_file_name,
        "audio_content_type": audio_content_type,
        "audio_size_bytes": voice_session.audio_size_bytes,
        "audio_duration_ms": voice_session.audio_duration_ms,
        "audio_language": voice_session.audio_language,
        "audio_source": audio_source,
        "voice_session_id": str(voice_session.id),
        "attempt_number": attempt.attempt_number,
    }

    try:
        openai_response, openai_request = transcribe_audio_bytes(
            audio_bytes,
            content_type=audio_content_type or "audio/webm",
            audio_language=voice_session.audio_language,
            session_id=str(voice_session.id),
            file_name=audio_file_name,
        )
        transcript = extract_transcription_result(openai_response)
        transcript_text = normalize_optional_text(transcript["transcript_text"])
        if not transcript_text:
            raise OpenAITranscriptionError(
                "OpenAI returned an empty transcript",
                code="OPENAI_EMPTY_TRANSCRIPT",
                retryable=False,
                detail=openai_response,
            )

        confidence = _normalize_confidence(transcript["transcript_confidence"])
        voice_session.transcript_text = transcript_text
        voice_session.transcript_edited_text = (
            normalize_optional_text(voice_session.transcript_edited_text) or transcript_text
        )
        voice_session.transcript_confidence = confidence
        voice_session.transcript_word_count = transcript["transcript_word_count"]
        voice_session.transcript_json = transcript["transcript_json"]
        voice_session.deepgram_request_json = {
            "provider": "openai",
            "request": openai_request,
            "audio": request_json,
        }
        voice_session.deepgram_response_json = openai_response
        voice_session.deepgram_request_id = transcript["openai_request_id"]
        voice_session.deepgram_model = transcript["openai_model"]
        if transcript["audio_language"]:
            voice_session.audio_language = normalize_optional_text(transcript["audio_language"])
        voice_session.transcribed_at = datetime.now(timezone.utc)
        voice_session.status = VoiceNoteStatus.PENDING_REVIEW
        voice_session.validation_status = (
            "REVIEW_REQUIRED"
            if confidence is not None and confidence < settings.voice_transcription_confidence_threshold
            else "PENDING"
        )
        voice_session.validation_message = (
            f"OpenAI transcription confidence {confidence:.2f} is below the review threshold of "
            f"{settings.voice_transcription_confidence_threshold:.2f}."
            if confidence is not None and confidence < settings.voice_transcription_confidence_threshold
            else "Transcript is ready for driver review."
        )
        voice_session.last_error_code = None
        voice_session.last_error_message = None

        attempt.attempt_status = "SUCCESS"
        attempt.request_json = request_json
        attempt.response_json = openai_response
        attempt.transcript_text = transcript_text
        attempt.confidence = confidence
        attempt.request_id = transcript["openai_request_id"]
    except OpenAITranscriptionError as exc:
        voice_session.status = VoiceNoteStatus.TRANSCRIPTION_FAILED
        voice_session.validation_status = "FAILED"
        voice_session.validation_message = str(exc)
        voice_session.last_error_code = exc.code
        voice_session.last_error_message = str(exc)

        attempt.attempt_status = "FAILED"
        attempt.request_json = request_json
        attempt.error_code = exc.code
        attempt.error_message = str(exc)
        if getattr(exc, "detail", None) is not None:
            attempt.response_json = {"detail": exc.detail}

        db.add(voice_session)
        db.add(attempt)
        db.flush()

        _audit(
            db,
            action="voice.transcription.failed",
            status_value="FAILED",
            message="Voice transcription failed",
            payload={
                "voice_session_id": str(voice_session.id),
                "attempt_id": str(attempt.id),
                "error_code": exc.code,
                "error_message": str(exc),
                "retryable": exc.retryable,
            },
        )
        return voice_session

    db.add(voice_session)
    db.add(attempt)
    db.flush()

    _audit(
        db,
        action="voice.transcription.success",
        status_value="SUCCESS",
        message="Voice transcription completed",
        payload={
            "voice_session_id": str(voice_session.id),
            "attempt_id": str(attempt.id),
            "transcript_confidence": voice_session.transcript_confidence,
            "transcript_word_count": voice_session.transcript_word_count,
        },
    )
    return voice_session


def process_voice_transcription_task(
    voice_session_id: UUID,
    attempt_id: UUID,
) -> None:
    session_local = get_session_local()
    db = session_local()
    try:
        voice_session = get_voice_session(db, voice_session_id, load_attempts=True)
        if voice_session is None:
            logger.warning("Voice transcription task skipped because session %s no longer exists", voice_session_id)
            return

        attempt = db.get(VoiceNoteTranscriptionAttempt, attempt_id)
        if attempt is None:
            logger.warning("Voice transcription task skipped because attempt %s no longer exists", attempt_id)
            return

        try:
            process_voice_transcription(db, voice_session=voice_session, attempt=attempt)
            db.commit()
        except Exception as exc:
            db.rollback()
            voice_session = get_voice_session(db, voice_session_id, load_attempts=True)
            attempt = db.get(VoiceNoteTranscriptionAttempt, attempt_id)
            if voice_session is not None and attempt is not None:
                voice_session.status = VoiceNoteStatus.TRANSCRIPTION_FAILED
                voice_session.validation_status = "FAILED"
                voice_session.validation_message = str(exc)
                voice_session.last_error_code = "VOICE_TRANSCRIPTION_UNEXPECTED_ERROR"
                voice_session.last_error_message = str(exc)

                attempt.attempt_status = "FAILED"
                attempt.error_code = "VOICE_TRANSCRIPTION_UNEXPECTED_ERROR"
                attempt.error_message = str(exc)

                db.add(voice_session)
                db.add(attempt)
                db.commit()
            logger.exception("Voice transcription task failed for session %s", voice_session_id)
    finally:
        db.close()


def confirm_voice_session(
    db: Session,
    *,
    voice_session: VoiceNoteSession,
    transcript_text: str | None = None,
    validation_status: str = "VALIDATED",
) -> VoiceNoteSession:
    cleaned_transcript = normalize_optional_text(transcript_text)
    if cleaned_transcript:
        voice_session.transcript_edited_text = cleaned_transcript
        if not voice_session.transcript_text:
            voice_session.transcript_text = cleaned_transcript

    if not normalize_optional_text(voice_session.transcript_edited_text or voice_session.transcript_text):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transcript cannot be empty")

    voice_session.status = VoiceNoteStatus.CONFIRMED
    voice_session.validation_status = validation_status
    voice_session.validation_message = "Transcript confirmed by the driver."
    voice_session.confirmed_at = datetime.now(timezone.utc)
    voice_session.last_error_code = None
    voice_session.last_error_message = None
    db.add(voice_session)
    db.flush()

    _audit(
        db,
        action="voice.session.confirm",
        status_value="SUCCESS",
        message="Confirmed voice transcript",
        payload={
            "voice_session_id": str(voice_session.id),
            "validation_status": validation_status,
        },
    )
    return voice_session


def archive_voice_session(db: Session, *, voice_session: VoiceNoteSession) -> VoiceNoteSession:
    voice_session.status = VoiceNoteStatus.ARCHIVED
    voice_session.validation_status = "ARCHIVED"
    voice_session.archived_at = datetime.now(timezone.utc)
    db.add(voice_session)
    db.flush()

    _audit(
        db,
        action="voice.session.archive",
        status_value="SUCCESS",
        message="Archived voice note session",
        payload={"voice_session_id": str(voice_session.id)},
    )
    return voice_session


def prepare_voice_submission_create(
    submission_in: SubmissionCreate,
    *,
    voice_session: VoiceNoteSession,
) -> SubmissionCreate:
    transcript = (
        normalize_optional_text(submission_in.raw_text)
        or normalize_optional_text(voice_session.transcript_edited_text)
        or normalize_optional_text(voice_session.transcript_text)
    )
    if not transcript:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transcript cannot be empty")

    return submission_in.model_copy(
        update={
            "voice_session_id": voice_session.id,
            "raw_text": transcript,
            "analysis_result": {
                **(submission_in.analysis_result or {}),
                "voice_session_id": str(voice_session.id),
                "voice_input_used": True,
                "has_voice_notes": True,
                "raw_input_mode": "voice",
                "source_type": "voice",
                "submission_mode": "quick",
            },
        }
    )
