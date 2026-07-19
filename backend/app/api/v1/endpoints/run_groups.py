from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.core.enums import UserRole
from app.models.event import Event
from app.models.run_group import RunGroup
from app.models.user import User
from app.schemas.run_group import RunGroupCreate, RunGroupRead, RunGroupUpdate
from app.services.run_group_service import normalize_run_group


router = APIRouter()


@router.post("", response_model=RunGroupRead, status_code=status.HTTP_201_CREATED)
def create_run_group(
    run_group_in: RunGroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> RunGroup:
    event = db.get(Event, run_group_in.event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if not event.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Event is archived")

    normalized = normalize_run_group(run_group_in.raw_text)
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid run group")

    existing = db.scalar(select(RunGroup).where(RunGroup.event_id == run_group_in.event_id))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Run group already set")

    run_group = RunGroup(
        event_id=run_group_in.event_id,
        raw_text=run_group_in.raw_text,
        normalized=normalized,
        created_by_id=current_user.id,
        locked=False,
    )
    db.add(run_group)
    db.commit()
    db.refresh(run_group)
    return run_group


@router.get("/event/{event_id}", response_model=RunGroupRead)
def read_run_group(
    event_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RunGroup:
    run_group = db.scalar(select(RunGroup).where(RunGroup.event_id == event_id))
    if not run_group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run group not set yet")
    return run_group


@router.put("/event/{event_id}", response_model=RunGroupRead)
def update_run_group(
    event_id: UUID,
    run_group_in: RunGroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> RunGroup:
    run_group = db.scalar(select(RunGroup).where(RunGroup.event_id == event_id))
    if not run_group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run group not found")
    if run_group.locked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Run group is locked and cannot be changed",
        )

    normalized = normalize_run_group(run_group_in.raw_text)
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid run group")

    run_group.raw_text = run_group_in.raw_text
    run_group.normalized = normalized
    if run_group_in.locked is not None:
        run_group.locked = run_group_in.locked

    db.commit()
    db.refresh(run_group)
    return run_group
