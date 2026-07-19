from __future__ import annotations

import copy
import re
from datetime import datetime, time
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.orm import Session, joinedload

from app.models.driver import Driver
from app.models.event import Event
from app.models.event_workflow import EventParticipant, RaceSession, SessionAttachment
from app.models.vehicle import Vehicle
from app.schemas.event_workflow import RaceScheduleCandidate
from app.services.submission_payload_service import normalize_optional_text


SESSION_PATTERNS: tuple[tuple[str, str], ...] = (
    ("PRACTICE", r"\b(?:practice|prac|free practice|test)\b"),
    ("QUALIFYING", r"\b(?:qualifying|qualifier|qual)\b"),
    ("WARMUP", r"\b(?:warm\s*up|warmup)\b"),
    ("RACE", r"\b(?:race|feature)\b"),
)
RUN_GROUP_RE = re.compile(r"\b(RED|BLUE|YELLOW|GREEN)\b", re.IGNORECASE)
TIME_12H_RE = re.compile(r"\b(?P<hour>1[0-2]|0?[1-9])(?::(?P<minute>[0-5]\d))?\s*(?P<ampm>a\.?m\.?|p\.?m\.?)\b", re.IGNORECASE)
TIME_24H_RE = re.compile(r"\b(?P<hour>[01]?\d|2[0-3]):(?P<minute>[0-5]\d)\b")
ISO_DATE_RE = re.compile(r"\b(?P<year>20\d{2})-(?P<month>\d{1,2})-(?P<day>\d{1,2})\b")
SLASH_DATE_RE = re.compile(r"\b(?P<month>\d{1,2})[/-](?P<day>\d{1,2})(?:[/-](?P<year>\d{2,4}))?\b")
MONTH_DATE_RE = re.compile(
    r"\b(?P<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(?P<day>\d{1,2})(?:,?\s+(?P<year>\d{4}))?\b",
    re.IGNORECASE,
)
MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def deep_merge(base: dict[str, Any] | None, changes: dict[str, Any] | None) -> dict[str, Any]:
    merged = copy.deepcopy(base or {})
    for key, value in (changes or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def diff_dict(previous: Any, current: Any) -> dict[str, Any]:
    if not isinstance(previous, dict) or not isinstance(current, dict):
        return {"before": previous, "after": current} if previous != current else {}

    diff: dict[str, Any] = {}
    for key in sorted(set(previous) | set(current)):
        before = previous.get(key)
        after = current.get(key)
        if isinstance(before, dict) and isinstance(after, dict):
            nested = diff_dict(before, after)
            if nested:
                diff[key] = nested
        elif before != after:
            diff[key] = {"before": before, "after": after}
    return diff


def _empty_state(starting: dict[str, Any] | None = None) -> dict[str, Any]:
    base = copy.deepcopy(starting or {})
    return {
        "starting": base,
        "changes": {},
        "final": copy.deepcopy(base),
    }


def _normalize_state(data: dict[str, Any] | None, fallback_starting: dict[str, Any] | None = None) -> dict[str, Any]:
    if not isinstance(data, dict) or not data:
        return _empty_state(fallback_starting)

    starting = copy.deepcopy(data.get("starting") if isinstance(data.get("starting"), dict) else fallback_starting or {})
    changes = copy.deepcopy(data.get("changes") if isinstance(data.get("changes"), dict) else {})
    final = copy.deepcopy(data.get("final") if isinstance(data.get("final"), dict) else deep_merge(starting, changes))
    return {
        **data,
        "starting": starting,
        "changes": changes,
        "final": final,
    }


def _tire_baseline_from_setup(setup: dict[str, Any]) -> dict[str, Any]:
    return {
        "pressures": copy.deepcopy(setup.get("tire_pressures") or setup.get("pressures") or {}),
        "temperatures": copy.deepcopy(setup.get("tire_temperatures") or setup.get("temperatures") or {}),
        "sets": copy.deepcopy(setup.get("tire_sets") or setup.get("sets") or {}),
    }


def _driver_name(driver: Driver) -> str:
    return driver.driver_name or " ".join(part for part in [driver.first_name, driver.last_name] if part).strip()


def build_default_baseline(driver: Driver, vehicle: Vehicle | None = None) -> dict[str, Any]:
    baseline: dict[str, Any] = {
        "driver": {
            "id": str(driver.id),
            "code": driver.driver_id,
            "name": _driver_name(driver),
            "team": driver.team_name,
        },
        "alignment": {},
        "setup": {},
        "tire_pressures": {},
        "tire_temperatures": {},
        "notes": normalize_optional_text(driver.notes),
    }
    if vehicle is not None:
        baseline["vehicle"] = {
            "id": str(vehicle.id),
            "code": vehicle.vehicle_id,
            "make": vehicle.make,
            "model": vehicle.model,
            "year": vehicle.year,
            "class": vehicle.vehicle_class,
            "registration_number": vehicle.registration_number,
        }
        if vehicle.notes:
            baseline["vehicle_notes"] = vehicle.notes
    return baseline


def get_event_or_404(db: Session, event_id: UUID) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


def _participant_query(event_id: UUID):
    return (
        select(EventParticipant)
        .where(EventParticipant.event_id == event_id)
        .options(
            joinedload(EventParticipant.driver),
            joinedload(EventParticipant.vehicle),
            joinedload(EventParticipant.sessions).joinedload(RaceSession.attachments),
        )
        .order_by(EventParticipant.created_at.asc())
    )


def list_event_participants(db: Session, event_id: UUID) -> list[EventParticipant]:
    participants = db.scalars(_participant_query(event_id)).unique().all()
    for participant in participants:
        participant.sessions = sorted(participant.sessions, key=_session_sort_key)
    return list(participants)


def get_event_session_or_404(db: Session, event_id: UUID, session_id: UUID) -> RaceSession:
    stmt = (
        select(RaceSession)
        .where(RaceSession.id == session_id, RaceSession.event_id == event_id)
        .options(
            joinedload(RaceSession.participant).joinedload(EventParticipant.driver),
            joinedload(RaceSession.participant).joinedload(EventParticipant.vehicle),
            joinedload(RaceSession.attachments),
        )
    )
    race_session = db.scalars(stmt).unique().one_or_none()
    if race_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Race session not found")
    return race_session


def create_or_update_participant(
    db: Session,
    event_id: UUID,
    *,
    driver_id: UUID,
    vehicle_id: UUID | None,
    baseline_setup: dict[str, Any] | None = None,
    notes: str | None = None,
) -> EventParticipant:
    event = get_event_or_404(db, event_id)
    if not event.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Archived events cannot be edited")

    driver = db.get(Driver, driver_id)
    if driver is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")

    vehicle = db.get(Vehicle, vehicle_id) if vehicle_id else None
    if vehicle_id and vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")

    resolved_baseline = baseline_setup or build_default_baseline(driver, vehicle)
    existing = db.scalar(
        select(EventParticipant).where(
            EventParticipant.event_id == event_id,
            EventParticipant.driver_id == driver_id,
        )
    )
    if existing is not None:
        existing.vehicle_id = vehicle_id
        existing.baseline_setup = resolved_baseline
        existing.notes = normalize_optional_text(notes)
        existing.is_active = True
        db.add(existing)
        db.flush()
        return existing

    participant = EventParticipant(
        event_id=event_id,
        driver_id=driver_id,
        vehicle_id=vehicle_id,
        baseline_setup=resolved_baseline,
        notes=normalize_optional_text(notes),
        is_active=True,
    )
    db.add(participant)
    db.flush()
    return participant


def update_participant(
    db: Session,
    event_id: UUID,
    participant_id: UUID,
    *,
    vehicle_id: UUID | None = None,
    baseline_setup: dict[str, Any] | None = None,
    notes: str | None = None,
    is_active: bool | None = None,
) -> EventParticipant:
    participant = db.get(EventParticipant, participant_id)
    if participant is None or participant.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event participant not found")

    if vehicle_id is not None:
        if db.get(Vehicle, vehicle_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
        participant.vehicle_id = vehicle_id
    if baseline_setup is not None:
        participant.baseline_setup = baseline_setup
    if notes is not None:
        participant.notes = normalize_optional_text(notes)
    if is_active is not None:
        participant.is_active = is_active
    db.add(participant)
    db.flush()
    return participant


def _detect_session_type(line: str) -> str | None:
    for session_type, pattern in SESSION_PATTERNS:
        if re.search(pattern, line, re.IGNORECASE):
            return session_type
    return None


def _parse_date(line: str, event: Event) -> tuple[int, int, int] | None:
    match = ISO_DATE_RE.search(line)
    if match:
        return int(match.group("year")), int(match.group("month")), int(match.group("day"))

    match = MONTH_DATE_RE.search(line)
    if match:
        month_key = match.group("month").strip(".").lower()
        year = int(match.group("year") or event.start_date.year)
        return year, MONTHS[month_key], int(match.group("day"))

    match = SLASH_DATE_RE.search(line)
    if match:
        year_text = match.group("year")
        year = int(year_text) if year_text else event.start_date.year
        if year < 100:
            year += 2000
        return year, int(match.group("month")), int(match.group("day"))

    return None


def _parse_time(line: str) -> time | None:
    match = TIME_12H_RE.search(line)
    if match:
        hour = int(match.group("hour"))
        minute = int(match.group("minute") or 0)
        ampm = match.group("ampm").lower()
        if ampm.startswith("p") and hour != 12:
            hour += 12
        if ampm.startswith("a") and hour == 12:
            hour = 0
        return time(hour=hour, minute=minute)

    match = TIME_24H_RE.search(line)
    if match:
        return time(hour=int(match.group("hour")), minute=int(match.group("minute")))

    return None


def _parse_scheduled_at(line: str, event: Event) -> datetime | None:
    date_parts = _parse_date(line, event)
    time_part = _parse_time(line)
    if not date_parts:
        return None
    try:
        return datetime(*date_parts, hour=time_part.hour if time_part else 0, minute=time_part.minute if time_part else 0)
    except ValueError:
        return None


def _session_title(line: str, session_type: str, session_number: int) -> str:
    label = {
        "PRACTICE": "Practice",
        "QUALIFYING": "Qualifying",
        "WARMUP": "Warm Up",
        "RACE": "Race",
    }.get(session_type, session_type.title())
    number_match = re.search(rf"{label.split()[0]}\s*(?P<number>\d+)", line, re.IGNORECASE)
    if number_match:
        return f"{label} {int(number_match.group('number'))}"
    if session_type in {"PRACTICE", "RACE"}:
        return f"{label} {session_number}"
    return label if session_number == 1 else f"{label} {session_number}"


def analyze_schedule_text(schedule_text: str, event: Event) -> tuple[list[RaceScheduleCandidate], list[str]]:
    counts: dict[str, int] = {}
    candidates: list[RaceScheduleCandidate] = []
    ignored: list[str] = []
    seen: set[tuple[str, int, str | None]] = set()

    for raw_line in schedule_text.splitlines():
        line = " ".join(raw_line.strip().split())
        if not line:
            continue

        session_type = _detect_session_type(line)
        if not session_type:
            ignored.append(line)
            continue

        number_match = re.search(r"\b(?:practice|prac|race|qualifying|qualifier|qual)\s*(?P<number>\d+)\b", line, re.IGNORECASE)
        if number_match:
            session_number = int(number_match.group("number"))
            counts[session_type] = max(counts.get(session_type, 0), session_number)
        else:
            counts[session_type] = counts.get(session_type, 0) + 1
            session_number = counts[session_type]

        scheduled_at = _parse_scheduled_at(line, event)
        run_group_match = RUN_GROUP_RE.search(line)
        title = _session_title(line, session_type, session_number)
        key = (session_type, session_number, scheduled_at.isoformat() if scheduled_at else None)
        if key in seen:
            continue
        seen.add(key)
        candidates.append(
            RaceScheduleCandidate(
                title=title,
                session_type=session_type,
                session_number=session_number,
                scheduled_at=scheduled_at,
                run_group=run_group_match.group(1).upper() if run_group_match else None,
                raw_text=line,
            )
        )

    candidates.sort(key=lambda item: (item.scheduled_at or datetime.max, item.session_type, item.session_number, item.title))
    return candidates, ignored


def _session_sort_key(race_session: RaceSession):
    return (
        race_session.scheduled_at or datetime.max,
        race_session.session_number or 0,
        race_session.title or "",
    )


def _existing_session(
    db: Session,
    participant_id: UUID,
    candidate: RaceScheduleCandidate,
) -> RaceSession | None:
    filters = [
        RaceSession.participant_id == participant_id,
        RaceSession.session_type == candidate.session_type.upper(),
        RaceSession.session_number == candidate.session_number,
        RaceSession.title == candidate.title,
    ]
    if candidate.scheduled_at is None:
        filters.append(RaceSession.scheduled_at.is_(None))
    else:
        filters.append(RaceSession.scheduled_at == candidate.scheduled_at)
    return db.scalar(select(RaceSession).where(and_(*filters)))


def _session_starting_state(participant: EventParticipant, previous: RaceSession | None) -> tuple[dict[str, Any], dict[str, Any], UUID | None]:
    if previous is None:
        baseline = copy.deepcopy(participant.baseline_setup or {})
        return baseline, _tire_baseline_from_setup(baseline), None

    previous_setup = _normalize_state(previous.setup_data)
    previous_tire = _normalize_state(previous.tire_data)
    return previous_setup["final"], previous_tire["final"], previous.id


def _reflow_participant_sessions(participant: EventParticipant) -> None:
    previous: RaceSession | None = None
    for race_session in sorted(participant.sessions, key=_session_sort_key):
        if previous is None:
            setup_starting = copy.deepcopy(participant.baseline_setup or {})
            tire_starting = _tire_baseline_from_setup(setup_starting)
            carried_from = None
        else:
            previous_setup = _normalize_state(previous.setup_data)
            previous_tire = _normalize_state(previous.tire_data)
            setup_starting = previous_setup["final"]
            tire_starting = previous_tire["final"]
            carried_from = previous.id

        setup_state = _normalize_state(race_session.setup_data, setup_starting)
        tire_state = _normalize_state(race_session.tire_data, tire_starting)
        setup_state["starting"] = copy.deepcopy(setup_starting)
        tire_state["starting"] = copy.deepcopy(tire_starting)
        setup_state["final"] = deep_merge(setup_state["starting"], setup_state["changes"])
        tire_state["final"] = deep_merge(tire_state["starting"], tire_state["changes"])
        race_session.setup_data = setup_state
        race_session.tire_data = tire_state
        race_session.carried_from_session_id = carried_from
        previous = race_session


def confirm_schedule(
    db: Session,
    event_id: UUID,
    candidates: list[RaceScheduleCandidate],
) -> tuple[int, int, list[RaceSession]]:
    get_event_or_404(db, event_id)
    participants = [
        participant
        for participant in list_event_participants(db, event_id)
        if participant.is_active
    ]
    if not participants:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add participating drivers before confirming a schedule",
        )
    if not candidates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No schedule sessions to confirm")

    created_count = 0
    skipped_count = 0
    created_sessions: list[RaceSession] = []
    for participant in participants:
        existing_sorted = sorted(participant.sessions, key=_session_sort_key)
        previous = existing_sorted[-1] if existing_sorted else None
        for candidate in sorted(candidates, key=lambda item: (item.scheduled_at or datetime.max, item.session_number, item.title)):
            candidate.session_type = candidate.session_type.upper()
            existing = _existing_session(db, participant.id, candidate)
            if existing is not None:
                skipped_count += 1
                previous = existing
                continue

            setup_starting, tire_starting, carried_from = _session_starting_state(participant, previous)
            race_session = RaceSession(
                event_id=event_id,
                participant_id=participant.id,
                title=candidate.title,
                session_type=candidate.session_type,
                session_number=candidate.session_number,
                scheduled_at=candidate.scheduled_at,
                status="PLANNED",
                source="schedule",
                setup_data=_empty_state(setup_starting),
                tire_data=_empty_state(tire_starting),
                lap_times=[],
                additional_data={
                    "schedule": {
                        "run_group": candidate.run_group,
                        "raw_text": candidate.raw_text,
                    }
                },
                carried_from_session_id=carried_from,
            )
            db.add(race_session)
            db.flush()
            participant.sessions.append(race_session)
            previous = race_session
            created_count += 1
            created_sessions.append(race_session)
        _reflow_participant_sessions(participant)
    db.flush()
    return created_count, skipped_count, created_sessions


def update_race_session(
    db: Session,
    event_id: UUID,
    session_id: UUID,
    payload: dict[str, Any],
) -> RaceSession:
    race_session = get_event_session_or_404(db, event_id, session_id)
    if "title" in payload and payload["title"]:
        race_session.title = payload["title"].strip()
    if "session_type" in payload and payload["session_type"]:
        race_session.session_type = payload["session_type"].strip().upper()
    if "session_number" in payload and payload["session_number"] is not None:
        race_session.session_number = int(payload["session_number"])
    if "scheduled_at" in payload:
        race_session.scheduled_at = payload["scheduled_at"]
    if "status" in payload and payload["status"]:
        race_session.status = payload["status"].strip().upper()

    setup_state = _normalize_state(race_session.setup_data)
    tire_state = _normalize_state(race_session.tire_data)
    if isinstance(payload.get("setup_changes"), dict):
        setup_state["changes"] = payload["setup_changes"]
    if isinstance(payload.get("tire_changes"), dict):
        tire_state["changes"] = payload["tire_changes"]
    setup_state["final"] = deep_merge(setup_state["starting"], setup_state["changes"])
    tire_state["final"] = deep_merge(tire_state["starting"], tire_state["changes"])
    race_session.setup_data = setup_state
    race_session.tire_data = tire_state

    for field in ("lap_times", "comments", "observations", "adjustments", "additional_data"):
        if field in payload:
            setattr(race_session, field, payload[field] if payload[field] is not None else ([] if field == "lap_times" else {} if field == "additional_data" else None))

    participant = race_session.participant
    if participant is not None:
        _reflow_future_sessions(participant, race_session)

    db.add(race_session)
    db.flush()
    return race_session


def _reflow_future_sessions(participant: EventParticipant, changed_session: RaceSession) -> None:
    sessions = sorted(participant.sessions, key=_session_sort_key)
    try:
        start_index = sessions.index(changed_session)
    except ValueError:
        return

    previous = changed_session
    for race_session in sessions[start_index + 1:]:
        if race_session.status.upper() == "COMPLETED":
            break

        previous_setup = _normalize_state(previous.setup_data)
        previous_tire = _normalize_state(previous.tire_data)
        setup_state = _normalize_state(race_session.setup_data, previous_setup["final"])
        tire_state = _normalize_state(race_session.tire_data, previous_tire["final"])
        setup_state["starting"] = copy.deepcopy(previous_setup["final"])
        tire_state["starting"] = copy.deepcopy(previous_tire["final"])
        setup_state["final"] = deep_merge(setup_state["starting"], setup_state["changes"])
        tire_state["final"] = deep_merge(tire_state["starting"], tire_state["changes"])
        race_session.setup_data = setup_state
        race_session.tire_data = tire_state
        race_session.carried_from_session_id = previous.id
        previous = race_session


def add_session_attachment(
    db: Session,
    event_id: UUID,
    session_id: UUID,
    *,
    filename: str,
    content_type: str,
    data: bytes,
) -> SessionAttachment:
    race_session = get_event_session_or_404(db, event_id, session_id)
    attachment = SessionAttachment(
        session_id=race_session.id,
        filename=filename[:255] or "session-photo",
        content_type=content_type[:120] or "application/octet-stream",
        size_bytes=len(data),
        data=data,
    )
    db.add(attachment)
    db.flush()
    return attachment


def get_attachment_or_404(db: Session, event_id: UUID, session_id: UUID, attachment_id: UUID) -> SessionAttachment:
    get_event_session_or_404(db, event_id, session_id)
    attachment = db.get(SessionAttachment, attachment_id)
    if attachment is None or attachment.session_id != session_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    return attachment


def prepare_session_read(race_session: RaceSession, previous: RaceSession | None = None) -> RaceSession:
    race_session.setup_data = _normalize_state(race_session.setup_data)
    race_session.tire_data = _normalize_state(race_session.tire_data)
    if previous is not None:
        previous_setup = _normalize_state(previous.setup_data)
        previous_tire = _normalize_state(previous.tire_data)
        race_session.setup_diff = diff_dict(previous_setup["final"], race_session.setup_data["final"])
        race_session.tire_diff = diff_dict(previous_tire["final"], race_session.tire_data["final"])
    else:
        race_session.setup_diff = {}
        race_session.tire_diff = {}
    return race_session


def prepare_workspace(db: Session, event_id: UUID) -> tuple[Event, list[EventParticipant], list[RaceSession], dict[str, int]]:
    event = get_event_or_404(db, event_id)
    participants = list_event_participants(db, event_id)
    all_sessions: list[RaceSession] = []
    for participant in participants:
        previous = None
        next_sessions = []
        for race_session in sorted(participant.sessions, key=_session_sort_key):
            next_sessions.append(prepare_session_read(race_session, previous))
            previous = race_session
        participant.sessions = next_sessions
        all_sessions.extend(next_sessions)

    all_sessions.sort(key=_session_sort_key)
    completed = sum(1 for item in all_sessions if item.status.upper() == "COMPLETED")
    summary = {
        "participant_count": len([item for item in participants if item.is_active]),
        "session_count": len(all_sessions),
        "completed_session_count": completed,
        "upcoming_session_count": len(all_sessions) - completed,
    }
    return event, participants, all_sessions, summary
