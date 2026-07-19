from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.enums import UserRole, VoiceNoteStatus
from app.models.submission import Submission
from app.models.user import User
from app.models.voice_note import VoiceNoteSession
from app.schemas.submission import (
    SubmissionRead,
    VoiceNoteSessionCreate,
    VoiceNoteSessionRead,
    VoiceNoteSessionUpdate,
    VoiceSubmissionFinalizeCreate,
)
from app.services.voice_note_service import (
    archive_voice_session,
    confirm_voice_session,
    create_transcription_attempt,
    create_voice_session,
    ensure_voice_session_mutable,
    ensure_voice_transcription_allowed,
    get_voice_session_for_user,
    prepare_voice_submission_create,
    process_voice_transcription_task,
    require_explicit_review_before_finalize,
    load_voice_audio_payload,
    store_voice_audio,
    _audit,
    _ensure_voice_session_event_context,
)
from app.api.v1.endpoints.submissions import create_submission


router = APIRouter()
logger = logging.getLogger(__name__)


def _voice_session_summary(session: VoiceNoteSession) -> dict[str, object]:
    return {
        "voice_session_id": str(session.id),
        "event_id": str(session.event_id),
        "run_group_id": str(session.run_group_id),
        "status": session.status.value if hasattr(session.status, "value") else session.status,
        "validation_status": session.validation_status,
        "validation_message": session.validation_message,
        "audio_storage_key": session.audio_storage_key,
        "audio_file_name": session.audio_file_name,
        "audio_content_type": session.audio_content_type,
        "audio_size_bytes": session.audio_size_bytes,
        "audio_duration_ms": session.audio_duration_ms,
        "transcript_confidence": session.transcript_confidence,
    }


def _voice_audio_content_disposition(file_name: str | None) -> str:
    safe_name = Path(file_name or "voice-note.webm").name.replace("\r", "").replace("\n", "").replace('"', "")
    return f'inline; filename="{safe_name or "voice-note.webm"}"'


@router.post("/voice-sessions", response_model=VoiceNoteSessionRead, status_code=status.HTTP_201_CREATED)
def create_voice_session_endpoint(
    payload: VoiceNoteSessionCreate,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VoiceNoteSession:
    event, run_group = _ensure_voice_session_event_context(
        db,
        event_id=payload.event_id,
        run_group_id=payload.run_group_id,
    )
    voice_session = create_voice_session(
        db,
        event=event,
        run_group=run_group,
        current_user=current_user,
        client_session_id=payload.client_session_id,
        audio_language=payload.audio_language,
    )
    db.commit()
    db.refresh(voice_session)
    return voice_session


@router.get("/voice-sessions/{voice_session_id}", response_model=VoiceNoteSessionRead)
def read_voice_session_endpoint(
    voice_session_id: UUID,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VoiceNoteSession:
    voice_session = get_voice_session_for_user(
        db,
        voice_session_id,
        current_user=current_user,
        load_attempts=True,
    )
    return voice_session


@router.post("/voice-sessions/{voice_session_id}/audio", response_model=VoiceNoteSessionRead)
async def upload_voice_audio_endpoint(
    voice_session_id: UUID,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
    audio_file: UploadFile = File(...),
    audio_duration_ms: int | None = Form(default=None),
    audio_language: str | None = Form(default=None),
) -> VoiceNoteSession:
    voice_session = get_voice_session_for_user(
        db,
        voice_session_id,
        current_user=current_user,
        load_attempts=True,
    )
    _ensure_voice_session_event_context(
        db,
        event_id=voice_session.event_id,
        run_group_id=voice_session.run_group_id,
    )
    ensure_voice_session_mutable(voice_session)

    audio_bytes = await audio_file.read()
    store_voice_audio(
        db,
        voice_session=voice_session,
        audio_bytes=audio_bytes,
        content_type=audio_file.content_type,
        file_name=audio_file.filename,
        duration_ms=audio_duration_ms,
        audio_language=audio_language,
    )
    db.commit()
    db.refresh(voice_session)
    _audit(
        db,
        action="voice.audio.upload.response",
        status_value="SUCCESS",
        message="Voice audio upload completed",
        payload=_voice_session_summary(voice_session),
        actor=current_user.name or current_user.email,
    )
    return voice_session


def _queue_transcription(
    *,
    db,
    current_user: User,
    voice_session: VoiceNoteSession,
    background_tasks: BackgroundTasks,
    action: str = "start",
) -> VoiceNoteSession:
    ensure_voice_transcription_allowed(voice_session, action=action)

    request_json = {
        "voice_session_id": str(voice_session.id),
        "event_id": str(voice_session.event_id),
        "run_group_id": str(voice_session.run_group_id),
        "audio_storage_key": voice_session.audio_storage_key,
        "audio_file_name": voice_session.audio_file_name,
        "audio_content_type": voice_session.audio_content_type,
        "audio_size_bytes": voice_session.audio_size_bytes,
        "audio_duration_ms": voice_session.audio_duration_ms,
        "audio_language": voice_session.audio_language,
    }
    attempt = create_transcription_attempt(
        db,
        voice_session=voice_session,
        request_json=request_json,
    )
    voice_session.status = VoiceNoteStatus.PENDING_TRANSCRIPTION
    db.add(voice_session)
    db.flush()
    background_tasks.add_task(process_voice_transcription_task, voice_session.id, attempt.id)
    _audit(
        db,
        action="voice.transcription.queue",
        status_value="SUCCESS",
        message="Queued voice transcription",
        payload={
            "voice_session_id": str(voice_session.id),
            "attempt_id": str(attempt.id),
            "attempt_number": attempt.attempt_number,
        },
        actor=current_user.name or current_user.email,
    )
    return voice_session


@router.post("/voice-sessions/{voice_session_id}/transcribe", response_model=VoiceNoteSessionRead)
def transcribe_voice_session_endpoint(
    voice_session_id: UUID,
    background_tasks: BackgroundTasks,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VoiceNoteSession:
    voice_session = get_voice_session_for_user(
        db,
        voice_session_id,
        current_user=current_user,
        load_attempts=True,
    )
    _ensure_voice_session_event_context(
        db,
        event_id=voice_session.event_id,
        run_group_id=voice_session.run_group_id,
    )
    _queue_transcription(
        db=db,
        current_user=current_user,
        voice_session=voice_session,
        background_tasks=background_tasks,
        action="start",
    )
    db.commit()
    db.refresh(voice_session)
    return voice_session


@router.post("/voice-sessions/{voice_session_id}/retry", response_model=VoiceNoteSessionRead)
def retry_voice_transcription_endpoint(
    voice_session_id: UUID,
    background_tasks: BackgroundTasks,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VoiceNoteSession:
    voice_session = get_voice_session_for_user(
        db,
        voice_session_id,
        current_user=current_user,
        load_attempts=True,
    )
    _ensure_voice_session_event_context(
        db,
        event_id=voice_session.event_id,
        run_group_id=voice_session.run_group_id,
    )
    ensure_voice_transcription_allowed(voice_session, action="retry")

    _queue_transcription(
        db=db,
        current_user=current_user,
        voice_session=voice_session,
        background_tasks=background_tasks,
        action="retry",
    )
    db.commit()
    db.refresh(voice_session)
    return voice_session


@router.get("/voice-sessions/{voice_session_id}/audio")
def read_voice_audio_endpoint(
    voice_session_id: UUID,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    voice_session = get_voice_session_for_user(
        db,
        voice_session_id,
        current_user=current_user,
        load_attempts=False,
    )
    audio_bytes, mime_type, file_name, _audio_source = load_voice_audio_payload(
        db,
        voice_session=voice_session,
    )

    return Response(
        content=audio_bytes,
        media_type=mime_type,
        headers={
            "Content-Disposition": _voice_audio_content_disposition(file_name),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.patch("/voice-sessions/{voice_session_id}", response_model=VoiceNoteSessionRead)
def update_voice_session_endpoint(
    voice_session_id: UUID,
    payload: VoiceNoteSessionUpdate,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VoiceNoteSession:
    voice_session = get_voice_session_for_user(
        db,
        voice_session_id,
        current_user=current_user,
        load_attempts=True,
    )
    _ensure_voice_session_event_context(
        db,
        event_id=voice_session.event_id,
        run_group_id=voice_session.run_group_id,
    )

    ensure_voice_session_mutable(voice_session)
    if payload.status not in {None, VoiceNoteStatus.ARCHIVED, VoiceNoteStatus.CONFIRMED}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported voice session transition")
    if payload.status == VoiceNoteStatus.ARCHIVED:
        archive_voice_session(db, voice_session=voice_session)
    elif payload.transcript_edited_text is not None or payload.status == VoiceNoteStatus.CONFIRMED:
        confirm_voice_session(
            db,
            voice_session=voice_session,
            transcript_text=payload.transcript_edited_text,
            validation_status=payload.validation_status or "VALIDATED",
        )
    else:
        if payload.status is not None:
            voice_session.status = payload.status
        if payload.validation_status is not None:
            voice_session.validation_status = payload.validation_status
        if payload.validation_message is not None:
            voice_session.validation_message = payload.validation_message
        if payload.audio_language is not None:
            voice_session.audio_language = payload.audio_language
        db.add(voice_session)
        db.flush()

    db.commit()
    db.refresh(voice_session)
    return voice_session


@router.post("/voice-sessions/{voice_session_id}/finalize", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
def finalize_voice_submission_endpoint(
    voice_session_id: UUID,
    payload: VoiceSubmissionFinalizeCreate,
    background_tasks: BackgroundTasks,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Submission:
    if payload.voice_session_id != voice_session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Voice session mismatch")

    voice_session = get_voice_session_for_user(
        db,
        voice_session_id,
        current_user=current_user,
        load_attempts=True,
    )
    _ensure_voice_session_event_context(
        db,
        event_id=voice_session.event_id,
        run_group_id=voice_session.run_group_id,
    )
    if voice_session.submission_id is not None:
        existing_submission = db.get(Submission, voice_session.submission_id)
        if existing_submission is not None:
            return existing_submission

    if voice_session.status in {VoiceNoteStatus.TRANSCRIPTION_FAILED, VoiceNoteStatus.ARCHIVED}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Voice session cannot be finalized in its current state",
        )
    require_explicit_review_before_finalize(voice_session)

    finalized_submission = prepare_voice_submission_create(payload, voice_session=voice_session)
    if voice_session.status != VoiceNoteStatus.CONFIRMED:
        confirm_voice_session(
            db,
            voice_session=voice_session,
            transcript_text=finalized_submission.raw_text,
            validation_status="VALIDATED",
        )

    submission = create_submission(
        submission_in=finalized_submission,
        background_tasks=background_tasks,
        db=db,
        current_user=current_user,
    )
    if voice_session.submission_id is None and getattr(submission, "id", None) is not None:
        voice_session.submission_id = submission.id
        voice_session.status = VoiceNoteStatus.SUBMITTED
        voice_session.submitted_at = datetime.now(timezone.utc)
        db.add(voice_session)
        db.commit()
    return submission
