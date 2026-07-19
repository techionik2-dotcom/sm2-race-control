from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.core.enums import UserRole
from app.core.fleet_ids import normalize_text
from app.models.track import Track
from app.models.user import User
from app.schemas.track import TrackCreate, TrackRead, TrackUpdate


router = APIRouter()


def _normalize_short_code(value: str | None) -> str:
    return normalize_text(value).replace(" ", "").upper()


def _find_track_by_name(db: Session, name: str) -> Track | None:
    normalized_name = normalize_text(name)
    if not normalized_name:
        return None

    return db.scalar(select(Track).where(func.lower(Track.name) == normalized_name.lower()))


def _find_track_by_short_code(db: Session, short_code: str) -> Track | None:
    normalized_short_code = _normalize_short_code(short_code)
    if not normalized_short_code:
        return None

    return db.scalar(
        select(Track).where(func.lower(Track.short_code) == normalized_short_code.lower())
    )


def _ensure_name_available(db: Session, name: str, existing: Track | None = None) -> None:
    conflict = _find_track_by_name(db, name)
    if conflict is not None and (existing is None or conflict.name != existing.name):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Track name already exists")


def _ensure_short_code_available(db: Session, short_code: str, existing: Track | None = None) -> None:
    normalized_short_code = _normalize_short_code(short_code)
    if not normalized_short_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Short code is required")

    conflict = _find_track_by_short_code(db, normalized_short_code)
    if conflict is not None and (existing is None or conflict.name != existing.name):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Track short code already exists")


def _normalize_track_values(
    db: Session,
    track_in: TrackCreate | TrackUpdate,
    existing: Track | None = None,
) -> dict:
    payload = track_in.model_dump(exclude_unset=True)

    name_supplied = "name" in payload
    short_code_supplied = "short_code" in payload
    notes_supplied = "notes" in payload
    latitude_supplied = "latitude" in payload
    longitude_supplied = "longitude" in payload

    requested_name = normalize_text(payload.get("name"))
    requested_display_name = normalize_text(payload.get("display_name"))
    requested_short_code = _normalize_short_code(payload.get("short_code"))
    requested_country = normalize_text(payload.get("country"))
    requested_notes = normalize_text(payload.get("notes")) or None
    requested_latitude = payload.get("latitude")
    requested_longitude = payload.get("longitude")

    if existing is None and not requested_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track name is required")
    if existing is None and not requested_country:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Country is required")
    if existing is None:
        _ensure_name_available(db, requested_name)
        _ensure_short_code_available(db, requested_short_code)
    else:
        if name_supplied and requested_name:
            _ensure_name_available(db, requested_name, existing=existing)
        if short_code_supplied and requested_short_code:
            _ensure_short_code_available(db, requested_short_code, existing=existing)

    name = requested_name or (existing.name if existing is not None else "")
    display_name = requested_display_name or (existing.display_name if existing is not None else "") or name
    short_code = requested_short_code or (existing.short_code if existing is not None else None)
    country = requested_country or (existing.country if existing is not None else None)
    notes = requested_notes if notes_supplied else (existing.notes if existing is not None else None)
    latitude = requested_latitude if latitude_supplied else (existing.latitude if existing is not None else None)
    longitude = requested_longitude if longitude_supplied else (
        existing.longitude if existing is not None else None
    )

    active_value = (
        payload.get("active")
        if "active" in payload
        else payload.get("is_active")
        if "is_active" in payload
        else (existing.is_active if existing is not None else True)
    )
    is_active = bool(active_value)
    archived_at = existing.archived_at if existing is not None else None
    if is_active:
        archived_at = None
    elif archived_at is None:
        archived_at = datetime.now(timezone.utc)

    if existing is None and not short_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Short code is required")

    return {
        "name": name,
        "display_name": display_name,
        "short_code": short_code,
        "latitude": latitude,
        "longitude": longitude,
        "country": country,
        "notes": notes,
        "is_active": is_active,
        "archived_at": archived_at,
    }


def _save_track(db: Session, track: Track) -> Track:
    db.add(track)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Track name or short code already exists",
        ) from exc

    db.refresh(track)
    return track


@router.get("", response_model=list[TrackRead])
def list_tracks(
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Track]:
    if include_archived and current_user.role not in {UserRole.OWNER, UserRole.ADMIN}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    stmt = select(Track)
    if not include_archived:
        stmt = stmt.where(Track.is_active.is_(True))

    stmt = stmt.order_by(Track.is_active.desc(), Track.updated_at.desc(), Track.name.asc())
    return list(db.scalars(stmt).all())


@router.post("", response_model=TrackRead, status_code=status.HTTP_201_CREATED)
def create_track(
    track_in: TrackCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> Track:
    values = _normalize_track_values(db, track_in)
    track = Track(**values)
    return _save_track(db, track)


@router.put("/{track_name}", response_model=TrackRead)
def update_track(
    track_name: str,
    track_in: TrackUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> Track:
    track = db.get(Track, track_name)
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    values = _normalize_track_values(db, track_in, existing=track)
    for key, value in values.items():
        setattr(track, key, value)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Track name or short code already exists",
        ) from exc

    db.refresh(track)
    return track


@router.delete("/{track_name}", response_model=TrackRead)
def archive_track(
    track_name: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> Track:
    track = db.get(Track, track_name)
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    if track.is_active:
        track.is_active = False
        track.archived_at = datetime.now(timezone.utc)

    return _save_track(db, track)
