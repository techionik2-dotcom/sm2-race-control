from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import tracks as tracks_endpoints
from app.core.enums import UserRole
from app.models.track import Track
from app.schemas.track import TrackCreate, TrackUpdate


class DummyScalarResult:
    def __init__(self, items=None):
        self.items = items or []

    def all(self):
        return self.items


class DummySession:
    def __init__(self, get_result=None, scalar_result=None, scalars_result=None):
        self.get_result = get_result
        self.scalar_result = scalar_result
        self.scalars_result = scalars_result or []
        self.added = []
        self.commits = 0
        self.refreshed = []
        self.statements = []

    def get(self, _model, _pk):
        return self.get_result

    def scalar(self, statement):
        self.statements.append(str(statement))
        return self.scalar_result

    def scalars(self, statement):
        self.statements.append(str(statement))
        return DummyScalarResult(self.scalars_result)

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.commits += 1

    def refresh(self, obj):
        self.refreshed.append(obj)


def _admin_user(role: UserRole = UserRole.ADMIN):
    return SimpleNamespace(id="user-1", role=role)


def test_normalize_track_values_create_payload():
    payload = TrackCreate(
        name=" Sebring International Raceway ",
        display_name="",
        short_code=" se b ",
        latitude=27.451,
        longitude=-81.351,
        country=" United States ",
        notes="  Classic endurance venue  ",
        is_active=False,
    )

    values = tracks_endpoints._normalize_track_values(DummySession(), payload)

    assert values["name"] == "Sebring International Raceway"
    assert values["display_name"] == "Sebring International Raceway"
    assert values["short_code"] == "SEB"
    assert values["country"] == "United States"
    assert values["latitude"] == 27.451
    assert values["longitude"] == -81.351
    assert values["notes"] == "Classic endurance venue"
    assert values["is_active"] is False
    assert values["archived_at"] is not None


def test_normalize_track_values_preserves_existing_update_fields():
    existing = SimpleNamespace(
        name="Road Atlanta",
        display_name="Road Atlanta",
        short_code="RATL",
        latitude=33.457,
        longitude=-84.123,
        country="United States",
        notes="Original notes",
        is_active=True,
        archived_at=None,
    )
    payload = TrackUpdate(notes=" Updated notes ", is_active=False)

    values = tracks_endpoints._normalize_track_values(DummySession(), payload, existing=existing)

    assert values["name"] == "Road Atlanta"
    assert values["display_name"] == "Road Atlanta"
    assert values["short_code"] == "RATL"
    assert values["country"] == "United States"
    assert values["notes"] == "Updated notes"
    assert values["is_active"] is False
    assert values["archived_at"] is not None
    assert values["archived_at"].tzinfo == timezone.utc


def test_create_track_persists_backend_track(monkeypatch):
    monkeypatch.setattr(tracks_endpoints, "_ensure_name_available", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(tracks_endpoints, "_ensure_short_code_available", lambda *_args, **_kwargs: None)

    session = DummySession()
    admin = _admin_user()

    track = tracks_endpoints.create_track(
        TrackCreate(
            name="Sebring International Raceway",
            display_name="Sebring",
            short_code="SEB",
            country="United States",
            latitude=27.451,
            longitude=-81.351,
            notes="Official track master record",
            is_active=True,
        ),
        session,
        admin,
    )

    assert isinstance(track, Track)
    assert track.name == "Sebring International Raceway"
    assert track.display_name == "Sebring"
    assert track.short_code == "SEB"
    assert track.country == "United States"
    assert track.is_active is True
    assert track.archived_at is None
    assert session.commits == 1
    assert track in session.added
    assert track in session.refreshed


def test_update_track_archives_and_restores_backend_track(monkeypatch):
    monkeypatch.setattr(tracks_endpoints, "_ensure_name_available", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(tracks_endpoints, "_ensure_short_code_available", lambda *_args, **_kwargs: None)

    existing = SimpleNamespace(
        name="Road Atlanta",
        display_name="Road Atlanta",
        short_code="RATL",
        latitude=33.457,
        longitude=-84.123,
        country="United States",
        notes="Original notes",
        is_active=True,
        archived_at=None,
    )

    archive_session = DummySession(get_result=existing)
    archived = tracks_endpoints.update_track(
        "Road Atlanta",
        TrackUpdate(is_active=False),
        archive_session,
        _admin_user(),
    )

    assert archived.is_active is False
    assert archived.archived_at is not None
    assert archive_session.commits == 1
    assert archive_session.refreshed == [existing]

    restore_session = DummySession(get_result=existing)
    restored = tracks_endpoints.update_track(
        "Road Atlanta",
        TrackUpdate(is_active=True),
        restore_session,
        _admin_user(),
    )

    assert restored.is_active is True
    assert restored.archived_at is None
    assert restore_session.commits == 1
    assert restore_session.refreshed == [existing]


def test_update_track_returns_404_when_missing():
    session = DummySession(get_result=None)

    with pytest.raises(HTTPException) as exc_info:
        tracks_endpoints.update_track(
            "Missing Track",
            TrackUpdate(display_name="Missing Track"),
            session,
            _admin_user(),
        )

    assert exc_info.value.status_code == 404
    assert "Track not found" in exc_info.value.detail
    assert session.commits == 0


def test_list_tracks_blocks_archived_view_for_non_admin():
    session = DummySession()

    with pytest.raises(HTTPException) as exc_info:
        tracks_endpoints.list_tracks(
            include_archived=True,
            db=session,
            current_user=_admin_user(UserRole.MECHANIC),
        )

    assert exc_info.value.status_code == 403
    assert "Access denied" in exc_info.value.detail
    assert session.commits == 0


def test_list_tracks_builds_active_only_query_by_default():
    session = DummySession(scalars_result=[SimpleNamespace(name="Sebring", is_active=True)])

    tracks = tracks_endpoints.list_tracks(
        include_archived=False,
        db=session,
        current_user=_admin_user(),
    )

    assert len(tracks) == 1
    assert tracks[0].name == "Sebring"
    assert any("active" in statement.lower() for statement in session.statements)
