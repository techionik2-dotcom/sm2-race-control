from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.core.enums import UserRole
from app.models.event import Event
from app.models.event_workflow import EventParticipant
from app.models.run_group import RunGroup
from app.models.user import User
from app.schemas.event import EventCreate, EventRead, EventUpdate
from app.schemas.event_workflow import (
    EventParticipantCreate,
    EventParticipantRead,
    EventParticipantUpdate,
    EventWeekendWorkspaceRead,
    RaceScheduleAnalyzeRead,
    RaceScheduleAnalyzeRequest,
    RaceScheduleConfirmRead,
    RaceScheduleConfirmRequest,
    RaceSessionRead,
    RaceSessionUpdate,
    SessionAttachmentRead,
)
from app.services.event_workflow_service import (
    add_session_attachment,
    analyze_schedule_text,
    confirm_schedule,
    create_or_update_participant,
    get_attachment_or_404,
    get_event_or_404,
    get_event_session_or_404,
    prepare_session_read,
    prepare_workspace,
    update_participant,
    update_race_session,
)
from app.services.run_group_service import normalize_run_group


router = APIRouter()


def _normalize_notes(notes: str | None) -> str | None:
    if notes is None:
        return None

    normalized = notes.strip()
    return normalized or None


@router.get("", response_model=list[EventRead])
def list_events(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[Event]:
    stmt = select(Event).order_by(Event.start_date.desc())
    if current_user.role not in (UserRole.OWNER, UserRole.ADMIN):
        stmt = stmt.where(Event.is_active.is_(True))
    return list(db.scalars(stmt).all())


@router.post("", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def create_event(
    event_in: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> Event:
    normalized_run_group = normalize_run_group(event_in.run_group_raw_text)
    if not normalized_run_group:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid run group")

    event = Event(
        name=event_in.name,
        track=event_in.track,
        start_date=event_in.start_date,
        end_date=event_in.end_date,
        notes=_normalize_notes(event_in.notes),
        created_by_id=current_user.id,
    )
    db.add(event)
    db.flush()

    run_group = RunGroup(
        event_id=event.id,
        raw_text=event_in.run_group_raw_text,
        normalized=normalized_run_group,
        created_by_id=current_user.id,
        locked=False,
    )
    db.add(run_group)
    db.commit()
    db.refresh(event)
    return event


@router.post("/{event_id}/select", response_model=EventRead)
def select_active_event(
    event_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Event:
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if not event.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Event is archived")

    run_group = db.scalar(select(RunGroup).where(RunGroup.event_id == event.id))
    if not run_group:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Run group is not configured for this event",
        )

    current_user.active_event_id = event.id
    db.commit()
    db.refresh(event)
    return event


@router.get("/active", response_model=EventRead)
def read_active_event(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Event:
    if not current_user.active_event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active event not set")

    event = db.get(Event, current_user.active_event_id)
    if not event or not event.is_active:
        current_user.active_event_id = None
        db.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active event not found")

    return event


@router.get("/{event_id}", response_model=EventRead)
def read_event(
    event_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Event:
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


@router.get("/{event_id}/workspace", response_model=EventWeekendWorkspaceRead)
def read_event_weekend_workspace(
    event_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EventWeekendWorkspaceRead:
    event, participants, sessions, summary = prepare_workspace(db, event_id)
    return EventWeekendWorkspaceRead(
        event=event,
        participants=participants,
        sessions=sessions,
        summary=summary,
    )


@router.post("/{event_id}/participants", response_model=EventParticipantRead, status_code=status.HTTP_201_CREATED)
def add_event_participant(
    event_id: UUID,
    participant_in: EventParticipantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> EventParticipantRead:
    participant = create_or_update_participant(
        db,
        event_id,
        driver_id=participant_in.driver_id,
        vehicle_id=participant_in.vehicle_id,
        baseline_setup=participant_in.baseline_setup,
        notes=participant_in.notes,
    )
    db.commit()
    db.refresh(participant)
    return participant


@router.patch("/{event_id}/participants/{participant_id}", response_model=EventParticipantRead)
def update_event_participant(
    event_id: UUID,
    participant_id: UUID,
    participant_in: EventParticipantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> EventParticipantRead:
    participant = update_participant(
        db,
        event_id,
        participant_id,
        **participant_in.model_dump(exclude_unset=True),
    )
    db.commit()
    db.refresh(participant)
    return participant


@router.delete(
    "/{event_id}/participants/{participant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_event_participant(
    event_id: UUID,
    participant_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> None:
    participant = db.get(EventParticipant, participant_id)
    if participant is None or participant.event_id != event_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event participant not found",
        )

    db.delete(participant)
    db.commit()
    return None


@router.post("/{event_id}/schedule/analyze", response_model=RaceScheduleAnalyzeRead)
def analyze_event_schedule(
    event_id: UUID,
    schedule_in: RaceScheduleAnalyzeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> RaceScheduleAnalyzeRead:
    event = get_event_or_404(db, event_id)
    detected, ignored = analyze_schedule_text(schedule_in.schedule_text, event)
    return RaceScheduleAnalyzeRead(detected_sessions=detected, ignored_lines=ignored)


@router.post("/{event_id}/schedule/confirm", response_model=RaceScheduleConfirmRead)
def confirm_event_schedule(
    event_id: UUID,
    schedule_in: RaceScheduleConfirmRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> RaceScheduleConfirmRead:
    created_count, skipped_count, created_sessions = confirm_schedule(db, event_id, schedule_in.sessions)
    db.commit()
    sessions = [
        prepare_session_read(get_event_session_or_404(db, event_id, item.id))
        for item in created_sessions
    ]
    return RaceScheduleConfirmRead(
        created_count=created_count,
        skipped_count=skipped_count,
        sessions=sessions,
    )


@router.patch("/{event_id}/sessions/{session_id}", response_model=RaceSessionRead)
def update_event_race_session(
    event_id: UUID,
    session_id: UUID,
    session_in: RaceSessionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RaceSessionRead:
    race_session = update_race_session(
        db,
        event_id,
        session_id,
        session_in.model_dump(exclude_unset=True),
    )
    db.commit()
    db.refresh(race_session)
    return prepare_session_read(race_session)


@router.post("/{event_id}/sessions/{session_id}/attachments", response_model=SessionAttachmentRead, status_code=status.HTTP_201_CREATED)
async def upload_event_session_attachment(
    event_id: UUID,
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    file: UploadFile = File(...),
) -> SessionAttachmentRead:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Attachment is empty")
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Attachment is too large")

    attachment = add_session_attachment(
        db,
        event_id,
        session_id,
        filename=file.filename or "session-photo",
        content_type=file.content_type or "application/octet-stream",
        data=data,
    )
    db.commit()
    db.refresh(attachment)
    return attachment


@router.get("/{event_id}/sessions/{session_id}/attachments/{attachment_id}")
def read_event_session_attachment(
    event_id: UUID,
    session_id: UUID,
    attachment_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    attachment = get_attachment_or_404(db, event_id, session_id, attachment_id)
    return Response(
        content=attachment.data,
        media_type=attachment.content_type,
        headers={
            "Content-Disposition": f'inline; filename="{attachment.filename}"',
            "Cache-Control": "private, max-age=300",
        },
    )


@router.put("/{event_id}", response_model=EventRead)
def update_event(
    event_id: UUID,
    event_in: EventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> Event:
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    data = event_in.model_dump(exclude_unset=True)
    run_group_raw_text = data.pop("run_group_raw_text", None)
    notes = data.pop("notes", None)

    for key, value in data.items():
        setattr(event, key, value)

    if notes is not None:
        event.notes = _normalize_notes(notes)

    if run_group_raw_text is not None:
        normalized_run_group = normalize_run_group(run_group_raw_text)
        if not normalized_run_group:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid run group")

        run_group = db.scalar(select(RunGroup).where(RunGroup.event_id == event.id))
        if not run_group:
            if not event.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Archived events cannot create new run groups",
                )

            run_group = RunGroup(
                event_id=event.id,
                raw_text=run_group_raw_text,
                normalized=normalized_run_group,
                created_by_id=current_user.id,
                locked=False,
            )
            db.add(run_group)
        else:
            if run_group.locked:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Run group is locked and cannot be changed",
                )

            run_group.raw_text = run_group_raw_text
            run_group.normalized = normalized_run_group

    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}", response_model=EventRead)
def archive_event(
    event_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> Event:
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    event.is_active = False
    if current_user.active_event_id == event.id:
        current_user.active_event_id = None
    db.commit()
    db.refresh(event)
    return event
