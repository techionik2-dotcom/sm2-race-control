from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

import app.services.submission_ingest_service as ingest_service
from app.services.raw_submission_current_schema_service import (
    RawCurrentSchemaPersistResult,
    lookup_raw_duplicate_current_schema,
    persist_raw_submission_current_schema,
    write_raw_audit_log_current_schema,
)
from app.services.raw_submission_service import (
    RawSubmissionValidationError,
    build_raw_submission_payload,
    parse_raw_note,
    resolve_driver_alias,
    resolve_vehicle_alias,
    validate_raw_submission_payload,
)


class _FakeResult:
    def __init__(self, *, scalar_value=None, row=None, rows=None):
        self._scalar_value = scalar_value
        self._row = row
        self._rows = rows or []

    def scalar_one(self):
        return self._scalar_value

    def first(self):
        return self._row

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _FakeSession:
    def __init__(self, *, track_schema_variant: str = "current", seance_schema_variant: str = "current"):
        self.executed: list[tuple[str, dict]] = []
        self.track_id = uuid4()
        self.vehicle_assignment_id = uuid4()
        self.seance_id = uuid4()
        self.submission_input_id = uuid4()
        self.duplicate_id_seance: str | None = None
        self.track_schema_variant = track_schema_variant
        self.seance_schema_variant = seance_schema_variant

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        normalized = sql.lower()
        params = params or {}
        self.executed.append((sql, params))

        if "information_schema.columns" in normalized and params.get("table_name") == "tracks":
            if self.track_schema_variant == "legacy":
                return _FakeResult(
                    rows=[
                        {"column_name": "id"},
                        {"column_name": "name"},
                        {"column_name": "status"},
                        {"column_name": "archived_at"},
                    ]
                )
            if self.track_schema_variant == "name_only":
                return _FakeResult(
                    rows=[
                        {"column_name": "name"},
                        {"column_name": "active"},
                        {"column_name": "created_at"},
                        {"column_name": "updated_at"},
                    ]
                )
            return _FakeResult(
                rows=[
                    {"column_name": "track_id"},
                    {"column_name": "track_name"},
                    {"column_name": "status"},
                    {"column_name": "archived_at"},
                ]
            )
        if "information_schema.columns" in normalized and params.get("table_name") == "seances":
            if self.seance_schema_variant == "legacy":
                return _FakeResult(
                    rows=[
                        {"column_name": "id_seance"},
                        {"column_name": "session_date"},
                        {"column_name": "session_time"},
                        {"column_name": "track"},
                        {"column_name": "driver_id"},
                        {"column_name": "vehicle_id"},
                        {"column_name": "session_type"},
                        {"column_name": "session_number"},
                        {"column_name": "duration_min"},
                        {"column_name": "tire_set"},
                        {"column_name": "notes"},
                        {"column_name": "created_by"},
                    ]
                )
            return _FakeResult(
                rows=[
                    {"column_name": "seance_id"},
                    {"column_name": "id_seance"},
                    {"column_name": "track_id"},
                    {"column_name": "vehicle_assignment_id"},
                    {"column_name": "session_started_at"},
                    {"column_name": "session_date"},
                    {"column_name": "session_type"},
                    {"column_name": "session_number"},
                    {"column_name": "duration_min"},
                    {"column_name": "notes"},
                    {"column_name": "created_by_user_id"},
                ]
            )
        if "select track_id" in normalized and "from sm2racing.tracks" in normalized:
            return _FakeResult(row={"track_id": self.track_id})
        if "select id as track_id" in normalized and "from sm2racing.tracks" in normalized:
            return _FakeResult(row={"track_id": self.track_id})
        if "select vehicle_assignment_id" in normalized and "from sm2racing.vehicle_assignments" in normalized:
            return _FakeResult(row={"vehicle_assignment_id": self.vehicle_assignment_id})
        if "select id_seance" in normalized and "from sm2racing.seances" in normalized:
            if self.duplicate_id_seance == params.get("id_seance"):
                return _FakeResult(row={"id_seance": self.duplicate_id_seance})
            return _FakeResult(row=None)
        if "insert into sm2racing.seances" in normalized and "returning seance_id" in normalized:
            return _FakeResult(scalar_value=self.seance_id)
        if "insert into sm2racing.submission_inputs" in normalized and "returning submission_input_id" in normalized:
            return _FakeResult(scalar_value=self.submission_input_id)
        if "insert into sm2racing.logs" in normalized:
            return _FakeResult()
        return _FakeResult()

    def begin_nested(self):
        class _Nested:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, exc_type, exc, tb):
                return False

        return _Nested()

    def commit(self):
        return None

    def rollback(self):
        return None


def _build_submission(raw_text: str):
    drivers = [
        SimpleNamespace(
            driver_id="NG",
            driver_name="Nicolas Guigere",
            first_name="Nicolas",
            last_name="Guigere",
            aliases=["nico", "nicolas"],
        )
    ]
    vehicles = [
        SimpleNamespace(
            vehicle_id="NG-GT4-2025",
            driver_id="NG",
            make="Porsche",
            model="GT4 RS Clubsport",
            registration_number=None,
            vehicle_class="GT4",
        )
    ]
    parsed = parse_raw_note(raw_text)
    driver = resolve_driver_alias(drivers, parsed.driver_alias)
    vehicle = resolve_vehicle_alias(vehicles, parsed.vehicle_alias)
    captured_at = datetime(2026, 4, 30, 15, 45, tzinfo=timezone.utc)
    payload, analysis_result, id_seance = build_raw_submission_payload(
        parsed,
        driver_id=driver.driver_id,
        vehicle_id=vehicle.vehicle_id,
        track="Sebring International Raceway",
        run_group="RED",
        created_by="Alexandre",
        captured_at=captured_at,
        confidence=0.93,
    )
    errors = validate_raw_submission_payload(
        created_by="Alexandre",
        raw_text=raw_text,
        payload=payload,
        analysis_result=analysis_result,
    )
    assert errors == []
    submission = SimpleNamespace(
        submission_ref=f"RAW-{id_seance}",
        correlation_id=str(uuid4()),
        raw_text=raw_text,
        image_url=None,
        payload=payload,
        analysis_result=analysis_result,
    )
    event = SimpleNamespace(track="Sebring International Raceway")
    run_group = SimpleNamespace(normalized="RED")
    current_user = SimpleNamespace(id=uuid4())
    return submission, event, run_group, driver, vehicle, current_user, payload, analysis_result, id_seance, captured_at


def test_raw_persistence_uses_current_schema_columns():
    db = _FakeSession()
    raw_text = "s2 25min nico gt4 Y-S3 pf 26/26/27/27 pc 31/31/32/32"
    submission, event, run_group, driver, vehicle, current_user, payload, analysis_result, id_seance, captured_at = _build_submission(raw_text)

    result = persist_raw_submission_current_schema(
        db,
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        current_user=current_user,
        source="pwa",
        payload=payload,
        analysis_result=analysis_result,
        id_seance=id_seance,
        captured_at=captured_at,
    )

    assert isinstance(result, RawCurrentSchemaPersistResult)
    assert result.status == "saved"
    assert str(result.seance_id) == str(db.seance_id)
    assert str(result.submission_input_id) == str(db.submission_input_id)
    assert result.id_seance == id_seance

    seance_insert = next(params for sql, params in db.executed if "insert into sm2racing.seances" in sql.lower())
    assert seance_insert["track_id"] == db.track_id
    assert seance_insert["vehicle_assignment_id"] == db.vehicle_assignment_id
    assert seance_insert["session_started_at"] == captured_at
    assert seance_insert["status"] == "FINAL"

    submission_insert = next(
        params for sql, params in db.executed if "insert into sm2racing.submission_inputs" in sql.lower()
    )
    raw_payload_json = json.loads(submission_insert["raw_payload_jsonb"])
    assert submission_insert["seance_id"] == db.seance_id
    assert submission_insert["created_by_user_id"] == current_user.id
    assert submission_insert["source"] == "pwa"
    assert submission_insert["submission_type"] == "quick"
    assert raw_payload_json["data"]["session_number"] == 2
    assert raw_payload_json["data"]["pressures"]["cold"]["fl"] == 26.0

    pressure_insert = next(params for sql, params in db.executed if "insert into sm2racing.pressures" in sql.lower())
    assert pressure_insert["seance_id"] == db.seance_id
    assert pressure_insert["cold_fl"] == 26.0
    assert pressure_insert["hot_rr"] == 32.0


def test_raw_persistence_supports_legacy_track_columns():
    db = _FakeSession(track_schema_variant="legacy")
    raw_text = "s1 30min nico gt4 Y-S3 pf 27 wb 2450"
    submission, event, run_group, driver, vehicle, current_user, payload, analysis_result, id_seance, captured_at = _build_submission(raw_text)

    result = persist_raw_submission_current_schema(
        db,
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        current_user=current_user,
        source="pwa",
        payload=payload,
        analysis_result=analysis_result,
        id_seance=id_seance,
        captured_at=captured_at,
    )

    assert result.status == "saved"
    track_select = next(sql for sql, _ in db.executed if "from sm2racing.tracks" in sql.lower())
    assert "select id as track_id" in track_select.lower()


def test_raw_persistence_falls_back_to_legacy_structured_ingest(monkeypatch):
    db = _FakeSession(track_schema_variant="name_only", seance_schema_variant="legacy")
    raw_text = "s1 30min nico gt4 Y-S3 pf 27 wb 2450"
    submission, event, run_group, driver, vehicle, current_user, payload, analysis_result, id_seance, captured_at = _build_submission(raw_text)

    called = {}

    def _fake_persist_structured_submission(*args, **kwargs):
        called["args"] = args
        called["kwargs"] = kwargs
        return SimpleNamespace(
            submission_input_id=777,
            status="saved",
            warnings=[{"section": "session", "code": "LEGACY_ROUTE"}],
            saved_sections=["seances", "submission_inputs"],
            skipped_sections=[],
        )

    monkeypatch.setattr(ingest_service, "persist_structured_submission", _fake_persist_structured_submission)

    result = persist_raw_submission_current_schema(
        db,
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        current_user=current_user,
        source="pwa",
        payload=payload,
        analysis_result=analysis_result,
        id_seance=id_seance,
        captured_at=captured_at,
    )

    assert result.status == "saved"
    assert result.submission_input_id == 777
    assert result.saved_sections == ["seances", "submission_inputs"]
    assert called["kwargs"]["submission"] == submission
    assert called["kwargs"]["current_user"] == current_user


def test_raw_persistence_preserves_wheelbase_when_alignment_is_also_present():
    db = _FakeSession()
    raw_text = "s3 30min nico gt4 Y-S3 pf 26/26/27/27 c -3.2/-3.1/-2.8/-2.8 wb 2450"
    submission, event, run_group, driver, vehicle, current_user, payload, analysis_result, id_seance, captured_at = _build_submission(raw_text)

    result = persist_raw_submission_current_schema(
        db,
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        current_user=current_user,
        source="pwa",
        payload=payload,
        analysis_result=analysis_result,
        id_seance=id_seance,
        captured_at=captured_at,
    )

    assert result.status == "saved"
    assert "alignment" in result.saved_sections

    alignment_insert = next(params for sql, params in db.executed if "insert into sm2racing.alignment" in sql.lower())
    assert alignment_insert["camber_fl"] == -3.2
    assert alignment_insert["wheelbase_mm"] == 2450.0


def test_raw_duplicate_lookup_uses_current_schema_session_identity():
    db = _FakeSession()
    db.duplicate_id_seance = "20260430-NG-S02"

    duplicate = lookup_raw_duplicate_current_schema(
        db,
        id_seance="20260430-NG-S02",
        raw_text="s2 25min nico gt4 Y-S3 pf 26/26/27/27 pc 31/31/32/32",
    )

    assert duplicate == "20260430-NG-S02"


def test_raw_audit_log_uses_current_schema_columns():
    db = _FakeSession()
    actor_id = uuid4()

    write_raw_audit_log_current_schema(
        db,
        action="submission.ingest.raw",
        status="SUCCESS",
        entity_type="seance",
        entity_id="20260430-NG-S02",
        message="Raw submission stored successfully for 20260430-NG-S02",
        payload={"id_seance": "20260430-NG-S02"},
        actor_user_id=actor_id,
        correlation_id=str(uuid4()),
    )

    log_insert = next(params for sql, params in db.executed if "insert into sm2racing.logs" in sql.lower())
    log_payload = json.loads(log_insert["payload"])
    assert log_insert["actor_user_id"] == actor_id
    assert log_insert["entity_type"] == "seance"
    assert log_insert["entity_id"] == "20260430-NG-S02"
    assert log_insert["status"] == "SUCCESS"
    assert log_payload["id_seance"] == "20260430-NG-S02"


def test_raw_persistence_requires_vehicle_assignment():
    db = _FakeSession()
    raw_text = "s1 30min nico gt4 Y-S3 pf 27 wb 2450"
    submission, event, run_group, driver, vehicle, current_user, payload, analysis_result, id_seance, captured_at = _build_submission(raw_text)

    original_execute = db.execute

    def _missing_assignment(statement, params=None):
        sql = " ".join(str(statement).split()).lower()
        if "select vehicle_assignment_id" in sql and "from sm2racing.vehicle_assignments" in sql:
            db.executed.append((sql, params or {}))
            return _FakeResult(row=None)
        return original_execute(statement, params)

    db.execute = _missing_assignment  # type: ignore[method-assign]

    with pytest.raises(RawSubmissionValidationError) as exc_info:
        persist_raw_submission_current_schema(
            db,
            submission=submission,
            event=event,
            run_group=run_group,
            driver=driver,
            vehicle=vehicle,
            current_user=current_user,
            source="pwa",
            payload=payload,
            analysis_result=analysis_result,
            id_seance=id_seance,
            captured_at=captured_at,
        )

    assert exc_info.value.errors[0]["message"] == "vehicle_id does not belong to driver_id"
