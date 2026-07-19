from __future__ import annotations

import base64
import json
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.api.v1.endpoints import submissions as submissions_endpoints
from app.core import config as config_module
from app.core.enums import RunGroupCode, SubmissionStatus, TireInventoryStatus
from app.models.driver import Driver
from app.models.event import Event
from app.models.run_group import RunGroup
from app.models.structured_notes import TireInventory
from app.models.vehicle import Vehicle
from app.services import image_analysis_service
from app.services import ocr_service
from app.services import submission_delivery_service as delivery_service
from app.services import make_webhook_service as make_service
from app.services import submission_ingest_service as ingest_service
from app.services import submission_payload_service as payload_service
from app.schemas.submission import OcrPreviewCreate, SubmissionCreate, SubmissionUpdate

PNG_SIGNATURE_BASE64 = "iVBORw0KGgo="
JPEG_SIGNATURE_BASE64 = "/9j/AA=="


def _dt(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    # Keep the OCR preview event window open while remaining independent of the calendar.
    now = datetime.now(timezone.utc)
    if (year, month, day) == (2026, 5, 10):
        return now - timedelta(days=1)
    if (year, month, day) == (2026, 5, 20):
        return now + timedelta(days=30)
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def _session_data(*, tire_status: str = "DISCARDED") -> dict:
    return {
        "date": "2026-04-23",
        "time": "15:31",
        "track": "Sebring International Raceway",
        "driver_id": "NG",
        "vehicle_id": "NG-GT4-2025",
        "session_type": "Practice",
        "session_number": 3,
        "duration_min": 10,
        "tire_set": "Y-S3",
        "wheelbase_mm": 2550,
        "pressures": {
            "cold": {"fl": 22, "fr": 21, "rl": 22, "rr": 23},
            "hot": {"fl": 24, "fr": 23, "rl": 24, "rr": 25},
        },
        "suspension": {
            "rebound_fl": 12,
            "rebound_fr": 12,
            "rebound_rl": 11,
            "rebound_rr": 11,
            "bump_fl": 5,
            "bump_fr": 5,
            "bump_rl": 4,
            "bump_rr": 4,
            "sway_bar_f": "1",
            "sway_bar_r": "2",
            "wing_angle_deg": 15,
        },
        "alignment": {
            "camber_fl": -1.5,
            "camber_fr": -1.4,
            "camber_rl": -2.0,
            "camber_rr": -2.0,
            "toe_front": "0.05",
            "toe_rear": "0.10",
            "caster_l": 6.5,
            "caster_r": 6.4,
            "ride_height_f": 65,
            "ride_height_r": 68,
            "corner_weight_fl": 310,
            "corner_weight_fr": 315,
            "corner_weight_rl": 320,
            "corner_weight_rr": 322,
            "cross_weight_pct": 50.5,
            "rake_mm": 3.0,
            "wheelbase_mm": 2550,
        },
        "tire_temperatures": {
            "fl_in": 78.5,
            "fl_mid": 80.0,
            "fl_out": 82.1,
            "fr_in": 77.2,
            "fr_mid": 79.0,
            "fr_out": 81.3,
            "rl_in": 74.0,
            "rl_mid": 75.1,
            "rl_out": 76.8,
            "rr_in": 73.8,
            "rr_mid": 75.0,
            "rr_out": 76.5,
        },
        "tire_inventory": {
            "tire_id": "Y-S3",
            "manufacturer": "Yokohama",
            "model": "S3",
            "size": "S3",
            "purchase_date": "2026-04-14",
            "heat_cycles": 2,
            "track_time_min": 15,
            "status": tire_status,
        },
    }


def _submission_payload(*, tire_status: str = "DISCARDED") -> dict:
    return {"data": _session_data(tire_status=tire_status)}


def _make_submission(
    *,
    submission_ref: str,
    payload: dict,
    raw_text: str = "",
    image_url: str | None = None,
    analysis_result: dict | None = None,
    correlation_id: str | None = None,
):
    return SimpleNamespace(
        submission_ref=submission_ref,
        correlation_id=correlation_id or f"{submission_ref}-CORR",
        raw_text=raw_text,
        image_url=image_url,
        payload=payload,
        analysis_result=analysis_result or {},
    )


def _make_actor_context(
    submission_ref: str,
    payload: dict,
    *,
    raw_text: str | None = "Driver reported the car was stable.",
    image_url: str | None = "data:image/png;base64,AAAA",
    analysis_result: dict | None = None,
):
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 4, 20),
        end_date=_dt(2026, 5, 1),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        raw_text="BLUE",
        normalized="BLUE",
    )
    driver = SimpleNamespace(
        id=uuid4(),
        driver_id="NG",
        driver_name="Nicolas GuigÃ¨re",
        first_name="Nicolas",
        last_name="GuigÃ¨re",
        aliases=["Nicolas GuigÃ¨re"],
        team_name="Blue",
        license_number="L-123",
        notes="Lead mechanic driver",
        created_by_id=uuid4(),
    )
    vehicle = SimpleNamespace(
        id=uuid4(),
        vehicle_id="NG-GT4-2025",
        driver_id="NG",
        make="Porsche",
        model="GT4 RS Clubsport",
        year=2025,
        vin="WP0ZZZ99ZTS123456",
        registration_number="NG",
        vehicle_class="GT4",
        notes="Primary race car",
    )
    current_user = SimpleNamespace(
        id=uuid4(),
        name="Mechanic One",
        email="mechanic@example.com",
    )
    submission = _make_submission(
        submission_ref=submission_ref,
        payload=payload,
        raw_text=raw_text or "",
        image_url=image_url,
        analysis_result=
        {"confidence": 0.87, "voice_input_used": True}
        if analysis_result is None
        else analysis_result,
    )
    return submission, event, run_group, driver, vehicle, current_user


class FakeResult:
    def __init__(self, *, scalar_value=None, row=None, rows=None):
        self._scalar_value = scalar_value
        self._row = row
        self._rows = rows or []

    def scalar_one(self):
        return self._scalar_value

    def first(self):
        return self._row

    def all(self):
        return self._rows

    def mappings(self):
        return self


class FakeSession:
    def __init__(self):
        self.executed: list[tuple[str, dict]] = []
        self.storage: dict[tuple[type, object], object] = {}
        self.added: list[object] = []
        self.commits = 0
        self.submission_inputs: list[dict] = []
        self.ocr_results: list[dict] = []
        self.media_files: list[dict] = []

    def _identity_key(self, obj):
        mapper = getattr(obj.__class__, "__mapper__", None)
        if mapper is None:
            return (obj.__class__, getattr(obj, "id", id(obj)))

        pk_values = tuple(getattr(obj, column.key) for column in mapper.primary_key)
        return (obj.__class__, pk_values[0] if len(pk_values) == 1 else pk_values)

    def add(self, obj):
        self.added.append(obj)
        self.storage[self._identity_key(obj)] = obj

    def get(self, model, pk):
        return self.storage.get((model, pk))

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        normalized = sql.lower()
        params = params or {}
        self.executed.append((sql, params))

        if "insert into sm2racing.submission_inputs" in normalized:
            submission_id = 101 + len(self.submission_inputs)
            self.submission_inputs.append({"submission_id": submission_id, **params})
            return FakeResult(scalar_value=submission_id)
        if "insert into sm2racing.media_files" in normalized:
            media_id = 202 + len(self.media_files)
            self.media_files.append({"media_id": media_id, **params})
            return FakeResult(scalar_value=media_id)
        if "insert into sm2racing.logs" in normalized:
            return FakeResult()
        if "insert into sm2racing.ocr_results" in normalized:
            ocr_id = 303 + len(self.ocr_results)
            self.ocr_results.append({"ocr_id": ocr_id, **params})
            return FakeResult(scalar_value=ocr_id)
        if "select submission_id" in normalized and "from sm2racing.submission_inputs" in normalized:
            wants_many = "limit" in params

            def _row_mapping(row):
                return {
                    "submission_id": row["submission_id"],
                    "raw_payload_json": row["raw_payload_json"],
                    "created_at": row.get("created_at"),
                    "created_by": row.get("created_by"),
                    "validation_status": row.get("validation_status"),
                    "validation_message": row.get("validation_message"),
                }

            if "correlation_id" in params:
                for row in reversed(self.submission_inputs):
                    payload = json.loads(row["raw_payload_json"])
                    if payload.get("correlation_id") == params["correlation_id"]:
                        return FakeResult(row=_row_mapping(row))
                return FakeResult(row=None)

            if "event_id" in params:
                matched_rows = []
                for row in reversed(self.submission_inputs):
                    payload = json.loads(row["raw_payload_json"])
                    metadata = payload.get("metadata") or {}
                    if metadata.get("event_id") == params["event_id"]:
                        matched_rows.append(_row_mapping(row))
                        if not wants_many:
                            return FakeResult(row=matched_rows[0])
                        if len(matched_rows) >= int(params["limit"]):
                            break
                return FakeResult(rows=matched_rows) if wants_many else FakeResult(row=None)

            if wants_many:
                matched_rows = [
                    _row_mapping(row)
                    for row in reversed(self.submission_inputs)
                    if row.get("source") == "make"
                ][: int(params["limit"])]
                return FakeResult(rows=matched_rows)

            if "submission_ref" in params:
                for row in reversed(self.submission_inputs):
                    payload = json.loads(row["raw_payload_json"])
                    if payload.get("submission_ref") == params["submission_ref"]:
                        return FakeResult(row={"submission_id": row["submission_id"]})
                return FakeResult(row=None)

            return FakeResult(row=None)
        if "select ocr_id" in normalized and "from sm2racing.ocr_results" in normalized:
            submission_id = params.get("submission_id")
            for row in reversed(self.ocr_results):
                if row.get("submission_id") == submission_id:
                    return FakeResult(
                        row={
                            "ocr_id": row["ocr_id"],
                            "review_status": row.get("review_status"),
                            "extracted_json": row.get("extracted_json"),
                        }
                    )
            return FakeResult(row=None)
        if "select media_id" in normalized and "from sm2racing.media_files" in normalized:
            submission_id = params.get("submission_id")
            for row in reversed(self.media_files):
                if row.get("submission_id") == submission_id:
                    return FakeResult(row={"media_id": row["media_id"]})
            return FakeResult(row={"media_id": 202})
        if "insert into sm2racing.tire_inventory" in normalized:
            status_value = params.get("status") or TireInventoryStatus.ACTIVE
            if isinstance(status_value, str):
                status_value = TireInventoryStatus[status_value]
            tire_inventory = TireInventory(
                tire_id=params["tire_id"],
                manufacturer=params["manufacturer"],
                model=params.get("model"),
                size=params.get("size"),
                purchase_date=params.get("purchase_date"),
                heat_cycles=params.get("heat_cycles"),
                track_time_min=params.get("track_time_min"),
                status=status_value,
            )
            self.storage[(TireInventory, tire_inventory.tire_id)] = tire_inventory
            return FakeResult()
        if "insert into sm2racing.seances" in normalized:
            return FakeResult(scalar_value=params["id_seance"])

        return FakeResult()

    def flush(self):
        return None

    def commit(self):
        self.commits += 1
        return None

    def refresh(self, obj):
        self.storage[self._identity_key(obj)] = obj

    def rollback(self):
        return None

class _DeliveryResult:
    def __init__(self, *, scalar_value=None, row=None):
        self._scalar_value = scalar_value
        self._row = row

    def scalar_one(self):
        return self._scalar_value

    def first(self):
        return self._row

    def mappings(self):
        return self


class _DeliverySession:
    def __init__(self, submission):
        self.submission = submission
        self.executed: list[tuple[str, dict]] = []
        self.outbox_row: dict | None = None

    def get(self, model, pk):
        if model.__name__ == "Submission" and pk == self.submission.id:
            return self.submission
        return None

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        normalized = sql.lower()
        params = params or {}
        self.executed.append((sql, params))

        if "insert into sm2racing.submission_delivery_outbox" in normalized:
            self.outbox_row = {
                "id": params["id"],
                "submission_id": params["submission_id"],
                "submission_ref": params["submission_ref"],
                "correlation_id": params["correlation_id"],
                "submission_input_id": params.get("submission_input_id"),
                "delivery_status": "PENDING",
                "attempt_count": 0,
                "last_attempt_at": None,
                "next_attempt_at": params.get("next_attempt_at"),
                "last_error_code": None,
                "last_error_message": None,
                "delivered_at": None,
            }
            return _DeliveryResult()

        if "select * from sm2racing.submission_delivery_outbox" in normalized:
            return _DeliveryResult(row=self.outbox_row)

        if "update sm2racing.submission_delivery_outbox" in normalized:
            if self.outbox_row is not None:
                self.outbox_row.update(params)
            return _DeliveryResult()

        return _DeliveryResult()

    def flush(self):
        return None

    def commit(self):
        return None

    def refresh(self, obj):
        return None


class _PreviewSession:
    def __init__(self, *, event, run_group):
        self.event = event
        self.run_group = run_group

    def get(self, model, pk):
        if model.__name__ == "Event" and pk == self.event.id:
            return self.event
        if model.__name__ == "RunGroup" and pk == self.run_group.id:
            return self.run_group
        return None

    def scalar(self, _statement):
        return None


def test_submission_stage_records_raw_media_and_audit_log():
    db = FakeSession()
    submission_ref = "SEB-20260423-1531-PRACTICE-3-NG-NG-GT4-2025"
    submission, event, run_group, driver, vehicle, current_user = _make_actor_context(
        submission_ref,
        _submission_payload(tire_status="DISCARDED"),
    )

    submission_input_id = ingest_service.stage_submission_input(
        db,
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        current_user=current_user,
    )

    assert submission_input_id == 101

    insert_submission = next(
        params for sql, params in db.executed if "insert into sm2racing.submission_inputs" in sql.lower()
    )
    raw_snapshot = json.loads(insert_submission["raw_payload_json"])
    assert raw_snapshot["submission_ref"] == submission_ref
    assert raw_snapshot["correlation_id"] == f"{submission_ref}-CORR"
    assert raw_snapshot["submission_type"] == "detail"
    assert raw_snapshot["analysis_result"]["voice_input_used"] is True
    assert raw_snapshot["metadata"]["event_id"] == str(event.id)
    assert raw_snapshot["metadata"]["track"] == "Sebring International Raceway"
    assert raw_snapshot["metadata"]["driver_id"] == "NG"
    assert raw_snapshot["metadata"]["driver_name"] == "Nicolas GuigÃ¨re"
    assert raw_snapshot["metadata"]["vehicle_id"] == "NG-GT4-2025"
    assert raw_snapshot["data"]["driver_id"] == "NG"
    assert raw_snapshot["data"]["vehicle_id"] == "NG-GT4-2025"
    assert insert_submission["confidence"] == pytest.approx(0.87)

    insert_media = next(
        params for sql, params in db.executed if "insert into sm2racing.media_files" in sql.lower()
    )
    assert insert_media["mime_type"] == "image/png"
    assert insert_media["file_name"] == f"{submission_ref}.img"

    insert_log = next(params for sql, params in db.executed if "insert into sm2racing.logs" in sql.lower())
    audit_payload = json.loads(insert_log["payload"])
    assert audit_payload["submission_ref"] == submission_ref
    assert audit_payload["correlation_id"] == f"{submission_ref}-CORR"
    assert audit_payload["submission_input_id"] == 101
    assert audit_payload["source"] == "pwa"


@pytest.mark.parametrize(
    "name,raw_text,image_url,analysis_result,expect_media,expected_voice_value",
    [
        ("raw", "rear pressures felt stable", None, {}, False, None),
        (
            "voice",
            "voice transcript note",
            None,
            {"voice_input_used": True},
            False,
            True,
        ),
        ("image", "", "data:image/png;base64,AAAA", {}, True, None),
    ],
)
def test_stage_submission_input_handles_raw_voice_and_image_variants(
    name,
    raw_text,
    image_url,
    analysis_result,
    expect_media,
    expected_voice_value,
):
    db = FakeSession()
    submission_ref = f"SEB-20260423-1531-{name.upper()}-ONLY"
    submission, event, run_group, driver, vehicle, current_user = _make_actor_context(
        submission_ref,
        {},
        raw_text=raw_text,
        image_url=image_url,
        analysis_result=analysis_result,
    )

    submission_input_id = ingest_service.stage_submission_input(
        db,
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        current_user=current_user,
    )

    assert submission_input_id == 101

    insert_submission = next(
        params for sql, params in db.executed if "insert into sm2racing.submission_inputs" in sql.lower()
    )
    raw_snapshot = json.loads(insert_submission["raw_payload_json"])
    assert raw_snapshot["submission_ref"] == submission_ref
    assert raw_snapshot["correlation_id"] == f"{submission_ref}-CORR"
    assert raw_snapshot["submission_type"] == "quick"
    assert raw_snapshot["raw_text"] == raw_text
    assert raw_snapshot["image_url"] == image_url
    assert raw_snapshot["analysis_result"].get("voice_input_used") == expected_voice_value

    insert_log = next(params for sql, params in db.executed if "insert into sm2racing.logs" in sql.lower())
    audit_payload = json.loads(insert_log["payload"])
    assert audit_payload["submission_ref"] == submission_ref
    assert audit_payload["correlation_id"] == f"{submission_ref}-CORR"
    assert audit_payload["submission_type"] == "quick"
    assert audit_payload["source"] == "pwa"

    if expect_media:
        insert_media = next(
            params for sql, params in db.executed if "insert into sm2racing.media_files" in sql.lower()
        )
        assert insert_media["mime_type"] == "image/png"
        assert insert_media["file_name"] == f"{submission_ref}.img"
    else:
        assert not any("insert into sm2racing.media_files" in sql.lower() for sql, _ in db.executed)


def test_ocr_result_normalizes_invalid_review_status():
    db = FakeSession()

    ocr_id = ingest_service._insert_ocr_result(
        db,
        submission_input_id=101,
        raw_ocr_text="PF 27",
        cleaned_ocr_text="PF 27",
        extracted_json={"pressure": 27},
        ocr_confidence=0.93,
        parser_version="ocr-v1",
        review_status="unknown",
    )

    assert ocr_id == 303
    insert_ocr = next(params for sql, params in db.executed if "insert into sm2racing.ocr_results" in sql.lower())
    assert insert_ocr["review_status"] == "PENDING"
    assert insert_ocr["media_id"] == 202


def test_persist_structured_submission_links_session_tables_and_history():
    db = FakeSession()
    submission_ref = "SEB-20260423-1531-PRACTICE-3-NG-NG-GT4-2025"
    session_data = _session_data(tire_status="DISCARDED")
    submission, event, run_group, driver, vehicle, current_user = _make_actor_context(
        submission_ref,
        {"data": session_data},
    )

    result = ingest_service.persist_structured_submission(
        db,
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        current_user=current_user,
    )
    assert result.submission_input_id == 101
    assert result.status == "saved"
    assert result.warnings == []

    started_at = datetime.combine(date.fromisoformat("2026-04-23"), time.fromisoformat("15:31")).replace(
        tzinfo=timezone.utc
    )
    expected_seance_id = ingest_service._seance_business_id(
        track_name="Sebring International Raceway",
        session_started_at=started_at,
        driver_code="NG",
        vehicle_code="NG-GT4-2025",
        session_type="Practice",
        session_number=3,
    )

    tire_inventory_insert = next(
        params for sql, params in db.executed if "insert into sm2racing.tire_inventory" in sql.lower()
    )
    assert tire_inventory_insert["status"] == "DISCARDED"
    raw_snapshot = json.loads(
        next(params for sql, params in db.executed if "insert into sm2racing.submission_inputs" in sql.lower())[
            "raw_payload_json"
        ]
    )
    assert raw_snapshot["correlation_id"] == f"{submission_ref}-CORR"

    tire_inventory_row = db.get(TireInventory, "Y-S3")
    assert tire_inventory_row is not None
    assert tire_inventory_row.status == TireInventoryStatus.DISCARDED

    seance_insert = next(params for sql, params in db.executed if "insert into sm2racing.seances" in sql.lower())
    assert seance_insert["id_seance"] == expected_seance_id
    assert seance_insert["track"] == "Sebring International Raceway"

    pressure_insert = next(params for sql, params in db.executed if "insert into sm2racing.pressures" in sql.lower())
    assert pressure_insert["id_seance"] == expected_seance_id
    assert pressure_insert["cold_fl"] == 22.0

    alignment_insert = next(params for sql, params in db.executed if "insert into sm2racing.alignment" in sql.lower())
    assert alignment_insert["id_seance"] == expected_seance_id
    assert alignment_insert["wheelbase_mm"] == 2550.0

    tire_history_insert = next(
        params for sql, params in db.executed if "insert into sm2racing.tire_history" in sql.lower()
    )
    assert tire_history_insert["tire_id"] == "Y-S3"
    assert tire_history_insert["id_seance"] == expected_seance_id
    assert tire_history_insert["track"] == "Sebring International Raceway"
    assert tire_history_insert["duration_min"] == 10


def test_persist_structured_submission_preserves_note_when_pressure_is_out_of_range():
    db = FakeSession()
    submission_ref = "SEB-20260423-1531-WARNING-3-NG-NG-GT4-2025"
    session_data = _session_data(tire_status="DISCARDED")
    session_data["pressures"]["cold"]["fl"] = 112
    submission, event, run_group, driver, vehicle, current_user = _make_actor_context(
        submission_ref,
        {"data": session_data},
    )

    result = ingest_service.persist_structured_submission(
        db,
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        current_user=current_user,
    )

    assert result.submission_input_id == 101
    assert result.status == "saved_with_warnings"
    assert any(warning["field"] == "cold_fl" for warning in result.warnings)

    pressure_insert = next(params for sql, params in db.executed if "insert into sm2racing.pressures" in sql.lower())
    assert pressure_insert["cold_fl"] is None
    assert pressure_insert["cold_fr"] == 21.0

    validation_update = next(
        params for sql, params in db.executed if "update sm2racing.submission_inputs" in sql.lower()
    )
    assert "cold_fl must be at most 60.0" in (validation_update["validation_message"] or "")

@pytest.mark.parametrize(
    "name,raw_text,image_url,analysis_result,expected_mode,expected_has_voice,expected_has_image,expected_voice_value",
    [
        ("raw", "manual note", None, {}, "manual", False, False, None),
        (
            "voice",
            "voice transcript note",
            None,
            {"voice_input_used": True},
            "voice",
            True,
            False,
            True,
        ),
        ("image", "", "data:image/png;base64,AAAA", {}, "image", False, True, None),
    ],
)
def test_make_webhook_payload_includes_raw_staging_and_structured_data(
    name,
    raw_text,
    image_url,
    analysis_result,
    expected_mode,
    expected_has_voice,
    expected_has_image,
    expected_voice_value,
):
    event_id = uuid4()
    run_group_id = uuid4()
    driver_id = uuid4()
    vehicle_id = uuid4()
    created_by_id = uuid4()
    submission = SimpleNamespace(
        submission_ref=f"SEB-20260423-1531-PRACTICE-3-NG-NG-GT4-2025-{name.upper()}",
        correlation_id=f"corr-{name}",
        status="SENT",
        created_at=_dt(2026, 4, 23, 15, 31),
        updated_at=_dt(2026, 4, 23, 15, 33),
        event_id=event_id,
        run_group_id=run_group_id,
        driver_id=driver_id,
        vehicle_id=vehicle_id,
        created_by_id=created_by_id,
        raw_text=raw_text,
        image_url=image_url,
        payload=_submission_payload(tire_status="ACTIVE"),
        analysis_result={"confidence": 0.85, **analysis_result, "submission_mode": "quick"},
            event=SimpleNamespace(
                id=event_id,
                name="Sebring",
                track="Sebring International Raceway",
                start_date=_dt(2026, 4, 20),
                end_date=_dt(2026, 5, 1),
            ),
            run_group=SimpleNamespace(id=run_group_id, normalized="BLUE", raw_text="BLUE", locked=False),
            driver=SimpleNamespace(
                id=driver_id,
                driver_id="NG",
                driver_name="Nicolas GuigÃ¨re",
                first_name="Nicolas",
                last_name="GuigÃ¨re",
                team_name="Blue",
            ),
            vehicle=SimpleNamespace(
                id=vehicle_id,
                vehicle_id="NG-GT4-2025",
                make="Porsche",
                model="GT4 RS Clubsport",
                year=2025,
                registration_number="NG",
                vehicle_class="GT4",
            ),
        )

    payload = make_service.build_make_payload(submission, submission_input_id=42)

    assert payload["correlationId"] == f"corr-{name}"
    assert payload["submissionInputId"] == 42
    assert payload["raw_text"] == raw_text
    assert payload["image"] == image_url
    assert payload["rawInput"]["rawText"] == raw_text
    assert payload["rawInput"]["imageUrl"] == image_url
    assert payload["rawInput"]["analysisResult"].get("voice_input_used") == expected_voice_value
    assert payload["rawInput"]["correlationId"] == f"corr-{name}"
    assert payload["staging"]["submissionInputId"] == 42
    assert payload["staging"]["validationStatus"] == "PENDING"
    assert payload["staging"]["correlationId"] == f"corr-{name}"
    assert payload["data"]["tire_inventory"]["status"] == "ACTIVE"
    assert payload["analysis_result"]["submission_mode"] == "quick"
    assert payload["analysis_result"]["raw_input_mode"] == expected_mode
    assert payload["hasVoiceNotes"] is expected_has_voice
    assert payload["hasImage"] is expected_has_image
    assert payload["rawInputMode"] == expected_mode


def test_submission_delivery_outbox_enqueues_and_completes(monkeypatch):
    submission = SimpleNamespace(
        id=uuid4(),
        submission_ref="SEB-20260423-1531-PRACTICE-3-NG-NG-GT4-2025-ASYNC",
        correlation_id="corr-async-1",
        status=SubmissionStatus.PENDING,
        error_message=None,
        created_at=_dt(2026, 4, 23, 15, 31),
        updated_at=_dt(2026, 4, 23, 15, 33),
        event=SimpleNamespace(id=uuid4(), name="Sebring", track="Sebring International Raceway"),
        event_id=uuid4(),
        run_group=SimpleNamespace(id=uuid4(), normalized="BLUE", raw_text="BLUE", locked=False),
        run_group_id=uuid4(),
        driver=SimpleNamespace(id=uuid4(), driver_id="NG", driver_name="Nicolas GuigÃƒÂ¨re"),
        driver_id=uuid4(),
        vehicle=SimpleNamespace(id=uuid4(), vehicle_id="NG-GT4-2025", make="Porsche", model="GT4 RS Clubsport"),
        vehicle_id=uuid4(),
        created_by_id=uuid4(),
        raw_text="rear pressures were stable",
        image_url=None,
        payload=_submission_payload(tire_status="ACTIVE"),
        analysis_result={"confidence": 0.85, "submission_mode": "detail"},
    )
    db = _DeliverySession(submission)
    sent_calls: list[tuple[str, int | None]] = []

    monkeypatch.setattr(delivery_service.settings, "make_webhook_url", "https://make.example")
    monkeypatch.setattr(
        delivery_service,
        "send_submission_to_make",
        lambda sent_submission, submission_input_id=None: sent_calls.append(
            (sent_submission.submission_ref, submission_input_id)
        ),
    )

    correlation_id = delivery_service.enqueue_submission_delivery(db, submission, submission_input_id=77)
    assert correlation_id == "corr-async-1"
    assert db.outbox_row is not None
    assert db.outbox_row["delivery_status"] == "PENDING"

    result = delivery_service.process_submission_delivery(db, submission.id, submission_input_id=77)

    assert result is submission
    assert submission.status == SubmissionStatus.SENT
    assert submission.error_message is None
    assert sent_calls == [(submission.submission_ref, 77)]
    assert db.outbox_row["delivery_status"] == "DELIVERED"


def test_submission_delivery_marks_sent_without_outbox_when_webhook_disabled(monkeypatch):
    submission = SimpleNamespace(
        id=uuid4(),
        submission_ref="SEB-20260719-0549-JFB-S1-NO-WEBHOOK",
        correlation_id="corr-no-webhook",
        status=SubmissionStatus.PENDING,
        error_message=None,
    )
    db = _DeliverySession(submission)

    monkeypatch.setattr(delivery_service.settings, "make_webhook_url", None)
    monkeypatch.setattr(
        delivery_service,
        "_fetch_outbox",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("disabled webhook delivery should not read the outbox")
        ),
    )

    result = delivery_service.process_submission_delivery(db, submission.id)

    assert result is submission
    assert submission.status == SubmissionStatus.SENT
    assert submission.error_message is None
    assert not any("submission_delivery_outbox" in sql.lower() for sql, _params in db.executed)


def test_create_submission_saves_note_when_delivery_enqueue_fails(monkeypatch):
    created_by_id = uuid4()
    event = Event(
        id=uuid4(),
        name="Sebring Race Weekend - Client Demo",
        track="Sebring International Raceway",
        start_date=_dt(2026, 6, 30),
        end_date=_dt(2027, 7, 3),
        created_by_id=created_by_id,
        is_active=True,
    )
    run_group = RunGroup(
        id=uuid4(),
        event_id=event.id,
        raw_text="RED",
        normalized=RunGroupCode.RED,
        created_by_id=created_by_id,
        locked=False,
    )
    driver = Driver(
        id=uuid4(),
        driver_id="JFB",
        driver_name="J-F Breton",
        aliases=["J-F Breton"],
        first_name="J-F",
        last_name="Breton",
        is_active=True,
        created_by_id=created_by_id,
    )
    vehicle = Vehicle(
        id=uuid4(),
        vehicle_id="JFB-GT4-2025",
        driver_id="JFB",
        make="Porsche",
        model="GT4 RS Clubsport",
        year=2025,
        registration_number="JFB",
        vehicle_class="GT4",
        is_active=True,
    )
    current_user = SimpleNamespace(
        id=uuid4(),
        name="Alex",
        email="alex@example.com",
        role=SimpleNamespace(value="DRIVER"),
    )
    db = FakeSession()
    db.storage[(Event, event.id)] = event
    db.storage[(RunGroup, run_group.id)] = run_group
    background_tasks = BackgroundTasks()

    monkeypatch.setattr(submissions_endpoints.settings, "make_webhook_url", "https://make.example/webhook")
    monkeypatch.setattr(submissions_endpoints, "_ensure_unique_submission_ref", lambda _db, value: value)
    monkeypatch.setattr(submissions_endpoints, "_ensure_unique_correlation_id", lambda _db, value: value)
    monkeypatch.setattr(submissions_endpoints, "_validate_submission_relations", lambda *_args, **_kwargs: (driver, vehicle))
    monkeypatch.setattr(submissions_endpoints, "should_persist_structured_submission", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(
        submissions_endpoints,
        "enqueue_submission_delivery",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("outbox table missing")),
    )
    monkeypatch.setattr(
        submissions_endpoints,
        "_load_submission",
        lambda loaded_db, _submission_id: loaded_db.added[-1],
    )

    result = submissions_endpoints.create_submission(
        SubmissionCreate(
            submission_ref="20260719-0549-JFB-S1",
            correlation_id=str(uuid4()),
            event_id=event.id,
            run_group_id=run_group.id,
            driver_id="JFB",
            vehicle_id="JFB-GT4-2025",
            raw_text="1st lap is Good.",
            payload={
                "data": {
                    "date": "2026-07-19",
                    "time": "05:49",
                    "session_id": "20260719-0549-JFB-S1",
                    "track": "Sebring International Raceway",
                    "run_group": "RED",
                    "driver_id": "JFB",
                    "vehicle_id": "JFB-GT4-2025",
                    "session_type": "Practice",
                    "session_number": 1,
                    "duration_min": 30,
                    "tire_set": "Y-S3",
                    "wheelbase_mm": 2450,
                    "pressures": {
                        "unit": "psi",
                        "cold": {"fl": 22, "fr": 23, "rl": 24, "rr": 56},
                        "hot": {"fl": None, "fr": None, "rl": None, "rr": None},
                    },
                }
            },
            analysis_result={
                "action": "ADD_SEANCE",
                "confidence": 0.85,
                "run_group": "RED",
                "submission_mode": "quick",
            },
        ),
        background_tasks,
        db,
        current_user,
    )

    assert result.raw_text == "1st lap is Good."
    assert result.status == SubmissionStatus.PENDING
    assert db.commits == 1
    assert background_tasks.tasks == []
    assert any(
        warning["code"] == "MAKE_WEBHOOK_ENQUEUE_FAILED"
        for warning in result.structured_ingest_warnings
    )


@pytest.mark.parametrize(
    "raw_text,image_url,analysis_result,expected_mode",
    [
        ("manual note", None, {}, "manual"),
        ("voice transcript note", None, {"voice_input_used": True}, "voice"),
        ("", "data:image/png;base64,AAAA", {}, "image"),
    ],
)
def test_submission_analysis_classifies_raw_voice_and_image_inputs(
    raw_text,
    image_url,
    analysis_result,
    expected_mode,
):
    analysis = payload_service.merge_submission_analysis(
        {},
        raw_text=raw_text,
        image_url=image_url,
        analysis_result=analysis_result,
    )

    assert analysis["submission_mode"] == "quick"
    assert analysis["raw_input_mode"] == expected_mode
    assert analysis["has_raw_text"] == bool(raw_text)
    assert analysis["has_image"] == bool(image_url)


def test_quick_hybrid_notes_still_persist_structured_data():
    analysis = payload_service.merge_submission_analysis(
        _submission_payload(),
        raw_text="manual note with structured fields",
        image_url=None,
        analysis_result={"submission_mode": "quick"},
    )

    assert analysis["source_type"] == "quick_hybrid"
    assert analysis["has_structured_data"] is True
    assert payload_service.should_persist_structured_submission(analysis) is True


def test_review_required_ocr_submissions_skip_immediate_structured_persist():
    analysis = payload_service.merge_submission_analysis(
        _submission_payload(),
        raw_text="reviewed OCR note",
        image_url="data:image/png;base64,AAAA",
        analysis_result={
            "submission_mode": "detail",
            "ocr_review_required": True,
            "force_review_staging": True,
        },
    )

    assert analysis["has_structured_data"] is True
    assert payload_service.should_persist_structured_submission(analysis) is False


def test_preview_ocr_submission_reports_disabled_config(monkeypatch):
    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=False,
            openai_api_key=None,
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
        ),
    )

    response = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=uuid4(),
            run_group_id=uuid4(),
            image_url="data:image/png;base64,AAAA",
        ),
        db=SimpleNamespace(),
        current_user=SimpleNamespace(),
    )

    payload = json.loads(response.body.decode("utf-8"))
    assert response.status_code == 503
    assert payload["error"] == "OCR_EXTRACTION_DISABLED"
    assert payload["message"] == "OCR extraction is disabled because the Make OCR webhook is not configured."
    assert payload["missing_requirements"] == ["MAKE_OCR_WEBHOOK_URL"]


def test_preview_ocr_submission_reports_missing_make_webhook_even_with_openai_settings(monkeypatch):
    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key=None,
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
        ),
    )

    response = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=uuid4(),
            run_group_id=uuid4(),
            image_url="data:image/png;base64,AAAA",
        ),
        db=SimpleNamespace(),
        current_user=SimpleNamespace(),
    )

    payload = json.loads(response.body.decode("utf-8"))
    assert response.status_code == 503
    assert payload["error"] == "OCR_EXTRACTION_DISABLED"
    assert payload["missing_requirements"] == ["MAKE_OCR_WEBHOOK_URL"]


def test_ocr_config_status_reports_missing_make_webhook_even_with_openai_settings():
    status = config_module.get_ocr_config_status(
        SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
        )
    )

    assert status["enabled"] is False
    assert status["provider"] is None
    assert status["has_api_key"] is True
    assert status["primary_model"] == "gpt-5.4"
    assert status["fallback_model"] == "gpt-5.5"
    assert status["missing_requirements"] == ["MAKE_OCR_WEBHOOK_URL"]


def test_ocr_config_status_accepts_make_webhook_without_openai_key():
    status = config_module.get_ocr_config_status(
        SimpleNamespace(
            chatbot_image_analysis_enabled=False,
            openai_api_key=None,
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
        )
    )

    assert status["enabled"] is True
    assert status["provider"] == "make_webhook"
    assert status["has_make_webhook"] is True
    assert status["has_api_key"] is False
    assert status["missing_requirements"] == []


def test_ocr_service_prefers_make_webhook_provider(monkeypatch):
    submission, event, run_group, driver, vehicle, _current_user = _make_actor_context(
        "OCR-MAKE-PROVIDER",
        _submission_payload(),
    )
    make_calls: list[dict] = []
    openai_calls: list[dict] = []

    monkeypatch.setattr(
        ocr_service,
        "get_settings",
        lambda: SimpleNamespace(
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
            chatbot_image_analysis_enabled=False,
            openai_api_key=None,
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
        ),
    )
    monkeypatch.setattr(
        ocr_service,
        "_analyze_submission_image_via_make",
        lambda **kwargs: make_calls.append(kwargs) or {"document_type": "printed_form_with_values"},
    )
    monkeypatch.setattr(
        ocr_service.image_analysis_service,
        "analyze_submission_image",
        lambda **kwargs: openai_calls.append(kwargs) or {"document_type": "unknown"},
    )

    result = ocr_service.analyze_submission_image(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
    )

    assert result["document_type"] == "printed_form_with_values"
    assert len(make_calls) == 1
    assert openai_calls == []


def test_ocr_service_returns_none_without_make_webhook(monkeypatch):
    submission, event, run_group, driver, vehicle, _current_user = _make_actor_context(
        "OCR-NO-MAKE-WEBHOOK",
        _submission_payload(),
    )
    openai_calls: list[dict] = []

    monkeypatch.setattr(
        ocr_service,
        "get_settings",
        lambda: SimpleNamespace(
            make_ocr_webhook_url=None,
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
        ),
    )
    monkeypatch.setattr(
        ocr_service.image_analysis_service,
        "analyze_submission_image",
        lambda **kwargs: openai_calls.append(kwargs) or {"document_type": "unknown"},
    )

    result = ocr_service.analyze_submission_image(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
    )

    assert result is None
    assert openai_calls == []


def test_build_make_ocr_request_uses_json_base64_payload():
    submission, event, run_group, driver, vehicle, _current_user = _make_actor_context(
        "OCR-MAKE-JSON",
        _submission_payload(),
    )
    preprocessing_info = {
        "selected_image_url": f"data:image/png;base64,{PNG_SIGNATURE_BASE64}",
        "selected_variant": "high_contrast_grayscale",
        "mime_type": "image/png",
        "size_bytes": len(base64.b64decode(PNG_SIGNATURE_BASE64)),
        "width": 1,
        "height": 1,
    }
    payload = ocr_service._build_make_ocr_payload(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        preprocessing_info=preprocessing_info,
    )

    req = ocr_service._build_make_ocr_request(
        webhook_url="https://hook.make.com/example",
        payload=payload,
        submission=submission,
    )

    request_body = json.loads(req.data.decode("utf-8"))
    parsed_payload = json.loads(request_body["payload_json"])

    assert req.headers["Content-type"] == "application/json"
    assert request_body["correlation_id"] == submission.correlation_id
    assert request_body["submission_ref"] == submission.submission_ref
    assert request_body["ocr_preview"] is True
    assert "image_file" not in request_body
    assert parsed_payload["image"]["transport"] == "base64_json"
    assert parsed_payload["image"]["filename"] == "high_contrast_grayscale.png"
    assert parsed_payload["image"]["mime_type"] == "image/png"
    assert parsed_payload["image"]["base64"] == PNG_SIGNATURE_BASE64
    assert len(parsed_payload["source_documents"]) == 1
    assert parsed_payload["source_documents"][0]["index"] == 0
    assert parsed_payload["source_documents"][0]["filename"] == "high_contrast_grayscale.png"
    assert parsed_payload["image"]["base64"].startswith("iVBOR")
    assert not parsed_payload["image"]["base64"].startswith("IMTString")
    assert not parsed_payload["image"]["base64"].startswith("data:")
    assert "field_name" not in parsed_payload["image"]


def test_build_make_ocr_image_payload_uses_selected_variant_bytes():
    image_payload = ocr_service._build_make_ocr_image_payload(
        {
            "selected_image_url": f"data:image/png;base64,{PNG_SIGNATURE_BASE64}",
            "selected_variant": "cropped paper",
        }
    )

    assert image_payload is not None
    assert image_payload["transport"] == "base64_json"
    assert image_payload["filename"] == "cropped_paper.png"
    assert image_payload["mime_type"] == "image/png"
    assert image_payload["size_bytes"] == len(base64.b64decode(PNG_SIGNATURE_BASE64))
    assert image_payload["selected_variant"] == "cropped paper"
    assert image_payload["base64"] == PNG_SIGNATURE_BASE64
    assert image_payload["base64"].startswith("iVBOR")
    assert not image_payload["base64"].startswith("IMTString")
    assert "data:image/png;base64," not in image_payload["base64"]


def test_build_make_ocr_payload_uses_actual_file_extension_for_non_png_variants():
    submission, event, run_group, driver, vehicle, _current_user = _make_actor_context(
        "OCR-MAKE-JPEG",
        _submission_payload(),
    )
    payload = ocr_service._build_make_ocr_payload(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        preprocessing_info={
            "selected_image_url": f"data:image/jpeg;base64,{JPEG_SIGNATURE_BASE64}",
            "selected_variant": "deskewed",
            "mime_type": "image/jpeg",
            "size_bytes": 123,
            "width": 1600,
            "height": 900,
        },
    )

    assert payload is not None
    assert payload["image"]["transport"] == "base64_json"
    assert payload["image"]["filename"] == "deskewed.jpg"
    assert payload["image"]["mime_type"] == "image/jpeg"
    assert payload["image"]["base64"] == JPEG_SIGNATURE_BASE64
    assert payload["image"]["base64"].startswith("/9j/")


def test_build_make_ocr_payload_includes_multiple_source_documents():
    submission, event, run_group, driver, vehicle, _current_user = _make_actor_context(
        "OCR-MAKE-MULTI",
        _submission_payload(),
    )
    submission.payload = {
        **submission.payload,
        "image_urls": [
            f"data:image/png;base64,{PNG_SIGNATURE_BASE64}",
            f"data:image/jpeg;base64,{JPEG_SIGNATURE_BASE64}",
        ],
    }

    payload = ocr_service._build_make_ocr_payload(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        preprocessing_info=[
            {
                "selected_image_url": f"data:image/png;base64,{PNG_SIGNATURE_BASE64}",
                "selected_variant": "high_contrast_grayscale",
                "mime_type": "image/png",
                "size_bytes": len(base64.b64decode(PNG_SIGNATURE_BASE64)),
                "width": 1,
                "height": 1,
            },
            {
                "selected_image_url": f"data:image/jpeg;base64,{JPEG_SIGNATURE_BASE64}",
                "selected_variant": "deskewed",
                "mime_type": "image/jpeg",
                "size_bytes": len(base64.b64decode(JPEG_SIGNATURE_BASE64)),
                "width": 2,
                "height": 2,
            },
        ],
    )

    assert payload is not None
    assert payload["image"]["filename"] == "high_contrast_grayscale.png"
    assert len(payload["source_documents"]) == 2
    assert payload["source_documents"][0]["index"] == 0
    assert payload["source_documents"][1]["index"] == 1
    assert payload["source_documents"][1]["filename"] == "deskewed.jpg"
    assert payload["source_documents"][1]["mime_type"] == "image/jpeg"
    assert payload["source_documents"][1]["base64"] == JPEG_SIGNATURE_BASE64


def test_validate_make_ocr_base64_string_rejects_imt_wrappers_and_data_urls():
    assert not ocr_service._validate_make_ocr_base64_string(
        "IMTString(1182064): iVBORw0KGgoAAAANSUhEUg",
        "image/png",
    )
    assert not ocr_service._validate_make_ocr_base64_string(
        "label: iVBORw0KGgoAAAANSUhEUg",
        "image/png",
    )
    assert not ocr_service._validate_make_ocr_base64_string(
        f"data:image/png;base64,{PNG_SIGNATURE_BASE64}",
        "image/png",
    )
    assert not ocr_service._validate_make_ocr_base64_string(
        f"prefix data:image/png;base64,{PNG_SIGNATURE_BASE64}",
        "image/png",
    )
    assert ocr_service._validate_make_ocr_base64_string(PNG_SIGNATURE_BASE64, "image/png")


def test_extract_analysis_candidate_accepts_wrapped_make_setup_schema():
    candidate = ocr_service._extract_analysis_candidate(
        {
            "data": {
                "schema_version": "smr_ocr_setup_v1.2",
                "document_type": "race_setup_packet",
                "session": {},
                "setup": {},
                "shocks": {},
                "post_session": {},
                "quality_control": {},
            }
        }
    )

    assert candidate is not None
    assert candidate["schema_version"] == "smr_ocr_setup_v1.2"


def test_extract_analysis_candidate_accepts_flat_flexible_setup_list_payload():
    candidate = ocr_service._extract_analysis_candidate(
        [
            {
                "sheet_type": "alignment_sheet",
                "date": "04/18/26",
                "time": "10:15 AM",
                "driver": "Alex G",
                "track": "Sebring",
                "camber": {
                    "front_left": 3.8,
                    "front_right": 4.0,
                    "rear_left": 3.3,
                    "rear_right": 3.7,
                },
                "toe": {
                    "front_left": "0.10 out",
                    "front_right": "0.12 out",
                    "rear_left": "0.05 in",
                    "rear_right": "0.06 in",
                },
                "fuel_liters": 42,
                "weight": {
                    "front_left": 531,
                    "front_right": 536,
                    "rear_left": 848,
                    "rear_right": 853,
                },
            }
        ]
    )

    assert candidate is not None
    assert candidate["sheet_type"] == "alignment_sheet"


def test_adapt_make_setup_payload_maps_make_schema_into_review_draft():
    adapted = ocr_service._adapt_make_setup_payload(
        {
            "schema_version": "smr_ocr_setup_v1.2",
            "document_type": "race_setup_packet",
            "session": {
                "team": "SM Racing",
                "series": "GT4",
                "car_number": "27",
                "date_raw": "05/15/2026",
                "time_raw": "2:30 PM",
                "driver": "Alex Driver",
                "track": "Sebring",
            },
            "source_documents": [{"index": 0}, {"index": 1}],
            "reference_setup": {
                "toe_slots": {
                    "slot_1": "A1",
                    "slot_2": "A2",
                    "meaning_confirmed": False,
                },
                "camber": {"LF": "-3.1", "RF": "-3.0", "LR": "-2.2", "RR": "-2.1"},
            },
            "setup": {
                "fuel_liters": 42,
                "driver_weight_lbs": 178,
                "camber": {"LF": "-3.2", "RF": "-3.1", "LR": "-2.3", "RR": "-2.2"},
                "toe": {
                    "front_left": {"value": "0.10", "direction": "OUT"},
                    "front_right": {"value": "0.09", "direction": "OUT"},
                    "rear_left": {"value": "0.03", "direction": "IN"},
                    "rear_right": {"value": "0.04", "direction": "IN"},
                },
                "tire_pressure": {"LF": 22.5, "RF": 22.8, "LR": 21.7, "RR": 22.0},
                "ride_height": {"unit": "mm", "LF": 80, "RF": 81, "LR": 120, "RR": 121},
                "static_ride_height": {"unit": "mm", "left": 80.5, "right": 81.0},
                "corner_weight": {"LF": 520, "RF": 525, "LR": 840, "RR": 845},
                "cross_weight_percent": 50.4,
                "total_weight_lbs": 2730,
                "springs": {"front": 900, "rear": 1050},
                "roll_bar": {"front": "3", "rear": "2"},
                "anti_roll_bar": {"front": "soft", "rear": "medium"},
                "wheel_base": {"unit": "mm", "left": 2790, "right": 2792},
                "aero": {"rake_deg": 2.5, "wing_deg": 7, "gurney_mm": 12, "wicker_mm": 4},
                "bump_stops": {"front": 6, "rear": 8},
                "bump_stop_height": {"unit": "mm", "left": 4.5, "right": 4.7},
                "spacer_mm": 8,
                "main_bump_rebound": {"bump": 6, "rebound": 9},
            },
            "shocks": {
                "LF": {"compression": 6, "rebound": 9, "HSR": 4, "LSR": 3, "HBS": 2, "LSB": 1, "setup_total": 10},
                "RF": {"compression": 6, "rebound": 9, "HSR": 4, "LSR": 3, "HBS": 2, "LSB": 1, "setup_total": 10},
                "LR": {"compression": 5, "rebound": 8, "HSR": 3, "LSR": 2, "HBS": 2, "LSB": 1, "setup_total": 8},
                "RR": {"compression": 5, "rebound": 8, "HSR": 3, "LSR": 2, "HBS": 2, "LSB": 1, "setup_total": 8},
            },
            "baseline_shocks": {
                "package_name": "Road Course A",
                "LF": {"HSR": 3, "LSR": 2, "HBS": 1, "LSB": 1, "setup_total": 7},
            },
            "post_session": {
                "fuel_pumped_out_liters": 8,
                "camber": {"LF": "-3.1", "RF": "-3.0", "LR": "-2.2", "RR": "-2.1"},
                "toe": {
                    "front_left": {"value": "0.08", "direction": "OUT"},
                    "front_right": {"value": "0.09", "direction": "OUT"},
                    "rear_left": {"value": "0.03", "direction": "IN"},
                    "rear_right": {"value": "0.04", "direction": "IN"},
                },
                "ride_height": {"unit": "mm", "LF": 80.2, "RF": 81.1, "LR": 120.8, "RR": 121.0},
                "corner_weight": {"LF": 521, "RF": 526, "LR": 839, "RR": 844},
                "shocks": {
                    "front": {"bump": 6, "rebound": 9},
                    "rear": {"bump": 5, "rebound": 8},
                },
            },
            "notes": ["Entry push mid-corner."],
            "quality_control": {
                "confidence": 0.86,
                "needs_review": True,
                "mapping_inferred": True,
                "warnings": ["verify toe direction"],
                "unresolved_fields": ["team"],
            },
        }
    )
    normalized = image_analysis_service.normalize_image_analysis_result(adapted)

    assert normalized["document_type"] == "printed_form_with_values"
    assert normalized["template_name"] == "race_setup_packet"
    assert normalized["status"] == "review_required"
    assert normalized["parser_version"] == "smr_ocr_setup_v1.2"
    assert normalized["setup"]["alignment"]["camber_fl"] == "-3.2"
    assert normalized["setup"]["alignment"]["toe_fl"] == "0.10 out"
    assert normalized["setup"]["pressures"]["cold_fl"] == "22.5"
    assert normalized["setup"]["sheet_fields"]["fuel_liters"] == "42"
    assert normalized["setup"]["sheet_fields"]["fuel_pumped_out_liters"] == "8"
    assert normalized["setup"]["sheet_fields"]["corner_weight_text"] == "520 / 525 / 840 / 845"
    assert normalized["setup"]["post_session"]["toe_text"] == "0.08 out / 0.09 out / 0.03 in / 0.04 in"
    assert normalized["setup"]["post_session"]["shocks_text"] == "front 6 / 9 | rear 5 / 8"
    assert normalized["setup"]["suspension"]["hsr_fl"] == "4"
    assert normalized["setup"]["shock_setup"]["lf"]["total_setup"] == "10"
    assert "Reference setup preserved in notes for manual review" in normalized["warnings"]
    assert "Baseline shocks preserved in notes for manual review" in normalized["warnings"]
    assert any(note.startswith("Baseline shocks package: Road Course A") for note in normalized["setup"]["notes"])


def test_adapt_flexible_setup_payload_maps_flat_schema_into_review_draft():
    adapted = ocr_service._adapt_flexible_setup_payload(
        {
            "sheet_type": "alignment_sheet",
            "team_name": "Farnbacher-Loles Racing",
            "series": "Grand-Am Rolex Series",
            "car_number": "86",
            "date": "04/18/26",
            "time": "10:15 AM",
            "driver": "Alex G",
            "track": "Sebring",
            "camber": {
                "front_left": 3.8,
                "front_right": 4.0,
                "rear_left": 3.3,
                "rear_right": 3.7,
            },
            "toe": {
                "front_left": "0.10 out",
                "front_right": "0.12 out",
                "rear_left": "0.05 in",
                "rear_right": "0.06 in",
            },
            "roll_bar": {"front": 3, "rear": 2},
            "spacer_mm": 8,
            "bump": 6,
            "rebound": 9,
            "fuel_liters": 42,
            "driver_weight_lbs": 178,
            "tire_pressure": {
                "front_left": 22.8,
                "front_right": 23.1,
                "rear_left": 21.9,
                "rear_right": 22.2,
            },
            "height": {
                "front_left": 80,
                "front_right": 81.1,
                "rear_left": 121,
                "rear_right": 120.8,
            },
            "weight": {
                "front_left": 531,
                "front_right": 536,
                "rear_left": 848,
                "rear_right": 853,
            },
            "percentage": 50.2,
            "percentage_box_weight_lbs": 1278,
            "wing": {"rake_degrees": 2.5, "wing_degrees": 7, "gurney_mm": 12},
            "springs": {"front": 900, "rear": 1050},
            "bump_stops": {"front": 6, "rear": 8},
            "wheel_base": {"left": 109.8, "right": 109.9},
            "notes": [
                "1. Good overall balance, slight push on entry.",
                "2. Entry stability improved with more front bar.",
            ],
            "after_session_set_down": {
                "camber": {
                    "front_left": 3.6,
                    "front_right": 3.8,
                    "rear_left": 3.1,
                    "rear_right": 3.5,
                },
                "toe": {
                    "front_left": "0.08 out",
                    "front_right": "0.10 out",
                    "rear_left": "0.04 in",
                    "rear_right": "0.05 in",
                },
                "weight": {
                    "front_left": 528,
                    "front_right": 533,
                    "rear_left": 842,
                    "rear_right": 846,
                },
                "height": {
                    "front_left": 80.2,
                    "front_right": 81.3,
                    "rear_left": 121.1,
                    "rear_right": 120.9,
                },
                "shocks": {
                    "front_left": 6,
                    "front_right": 9,
                    "rear_left": 6,
                    "rear_right": 9,
                },
            },
            "fuel_pumped_out_liters": None,
        }
    )
    normalized = image_analysis_service.normalize_image_analysis_result(adapted)

    assert normalized["document_type"] == "printed_form_with_values"
    assert normalized["template_name"] == "alignment_sheet"
    assert normalized["status"] == "review_required"
    assert normalized["parser_version"] == "smr_flexible_ocr_v1"
    assert normalized["setup"]["alignment"]["camber_fl"] == "3.8"
    assert normalized["setup"]["alignment"]["toe_fr"] == "0.12 out"
    assert normalized["setup"]["pressures"]["cold_rr"] == "22.2"
    assert normalized["setup"]["sheet_fields"]["fuel_liters"] == "42"
    assert normalized["setup"]["sheet_fields"]["scale_weight_lbs"] == ""
    assert normalized["setup"]["sheet_fields"]["percentage_box_weight_lbs"] == "1278"
    assert normalized["setup"]["sheet_fields"]["cross_weight_percent"] == "50.2"
    assert normalized["setup"]["sheet_fields"]["corner_weight_text"] == "531 / 536 / 848 / 853"
    assert normalized["setup"]["post_session"]["toe_text"] == "0.08 out / 0.10 out / 0.04 in / 0.05 in"
    assert normalized["setup"]["post_session"]["shocks_text"] == "front 6 / 9 | rear 6 / 9"
    assert "Percentage box weight preserved only in raw payload to avoid mislabeling scale weight" not in normalized["warnings"]


def test_adapt_flexible_setup_payload_leaves_missing_short_template_fields_blank():
    adapted = ocr_service._adapt_flexible_setup_payload(
        {
            "sheet_type": "alignment_sheet",
            "driver": "Alex G",
            "track": "Sebring",
            "setup": {
                "fuel": 40,
                "camber": {
                    "front_left": 3.1,
                    "front_right": 3.2,
                },
                "toe": {
                    "front_left": "0.10 out",
                },
            },
        }
    )
    normalized = image_analysis_service.normalize_image_analysis_result(adapted)

    assert normalized["setup"]["alignment"]["camber_fl"] == "3.1"
    assert normalized["setup"]["alignment"]["camber_rr"] == ""
    assert normalized["setup"]["alignment"]["toe_fl"] == "0.10 out"
    assert normalized["setup"]["alignment"]["toe_rr"] == ""
    assert normalized["setup"]["pressures"]["cold_fl"] == ""
    assert normalized["setup"]["sheet_fields"]["fuel_liters"] == "40"
    assert normalized["setup"]["sheet_fields"]["driver_weight_lbs"] == ""
    assert normalized["setup"]["post_session"]["toe_text"] == ""


def test_extract_analysis_candidate_accepts_compact_shock_setup_list_payload():
    candidate = ocr_service._extract_analysis_candidate(
        [
            {
                "type": "shock_setup_sheet",
                "RR": {"HSR": 7, "LSR": 6, "HBS": 9, "LSB": 8, "SETUP": 30},
                "LR": {"HSR": 7, "LSR": 5, "HBS": 8, "LSB": 8, "SETUP": 28},
                "LF": {"HSR": 6, "LSR": 5, "HBS": 8, "LSB": 7, "SETUP": 26},
                "RF": {"HSR": 6, "LSR": 6, "HBS": 9, "LSB": 7, "SETUP": 28},
            }
        ]
    )

    assert candidate is not None
    adapted = ocr_service._adapt_compact_shock_setup_payload(candidate)
    normalized = image_analysis_service.normalize_image_analysis_result(adapted)

    assert normalized["document_type"] == "shock_setup_sheet"
    assert normalized["template_name"] == "shock_setup"
    assert normalized["status"] == "review_required"
    assert normalized["setup"]["shock_setup"]["rr"]["position"] == "RR"
    assert normalized["setup"]["shock_setup"]["rr"]["hsr"] == "7"
    assert normalized["setup"]["shock_setup"]["rr"]["hsb"] == "9"
    assert normalized["setup"]["shock_setup"]["lr"]["total_setup"] == "28"
    assert normalized["setup"]["shock_setup"]["lf"]["total_setup"] == "26"
    assert normalized["setup"]["shock_setup"]["rf"]["lsb"] == "7"


def test_ingest_ocr_webhook_payload_accepts_direct_compact_shock_list(monkeypatch):
    db = FakeSession()
    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(make_inbound_webhook_secret="top-secret"),
    )

    result = submissions_endpoints.ingest_ocr_webhook_payload(
        [
            {
                "type": "shock_setup_sheet",
                "RR": {"HSR": 7, "LSR": 6, "HBS": 9, "LSB": 8, "SETUP": 30},
                "LR": {"HSR": 7, "LSR": 5, "HBS": 8, "LSB": 8, "SETUP": 28},
                "LF": {"HSR": 6, "LSR": 5, "HBS": 8, "LSB": 7, "SETUP": 26},
                "RF": {"HSR": 6, "LSR": 6, "HBS": 9, "LSB": 7, "SETUP": 28},
            }
        ],
        x_sm2_webhook_secret="top-secret",
        db=db,
    )

    assert result.status == "success"
    assert result.normalized is True
    assert result.payload_shape == "list"
    assert result.template_type == "shock_setup_sheet"
    assert result.submission_input_id == 101
    assert result.ocr_id == 303
    assert db.commits == 1

    insert_submission = next(
        params for sql, params in db.executed if "insert into sm2racing.submission_inputs" in sql.lower()
    )
    snapshot = json.loads(insert_submission["raw_payload_json"])
    assert insert_submission["source"] == "make"
    assert snapshot["payload_shape"] == "list"
    assert snapshot["normalized_analysis"]["document_type"] == "shock_setup_sheet"
    assert snapshot["ocr_payload"][0]["RR"]["HSR"] == 7


def test_ingest_ocr_webhook_payload_accepts_flat_flexible_setup_list(monkeypatch):
    db = FakeSession()
    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(make_inbound_webhook_secret="top-secret"),
    )

    result = submissions_endpoints.ingest_ocr_webhook_payload(
        [
            {
                "sheet_type": "alignment_sheet",
                "date": "04/18/26",
                "time": "10:15 AM",
                "driver": "Alex G",
                "track": "Sebring",
                "camber": {
                    "front_left": 3.8,
                    "front_right": 4.0,
                    "rear_left": 3.3,
                    "rear_right": 3.7,
                },
                "toe": {
                    "front_left": "0.10 out",
                    "front_right": "0.12 out",
                    "rear_left": "0.05 in",
                    "rear_right": "0.06 in",
                },
                "fuel_liters": 42,
                "weight": {
                    "front_left": 531,
                    "front_right": 536,
                    "rear_left": 848,
                    "rear_right": 853,
                },
            }
        ],
        x_sm2_webhook_secret="top-secret",
        db=db,
    )

    assert result.status == "success"
    assert result.normalized is True
    assert result.payload_shape == "list"
    assert result.template_type == "printed_form_with_values"
    assert result.submission_input_id == 101
    assert result.ocr_id == 303

    insert_submission = next(
        params for sql, params in db.executed if "insert into sm2racing.submission_inputs" in sql.lower()
    )
    snapshot = json.loads(insert_submission["raw_payload_json"])
    assert insert_submission["source"] == "make"
    assert snapshot["normalized_analysis"]["template_name"] == "alignment_sheet"
    assert snapshot["normalized_analysis"]["setup"]["alignment"]["camber_fl"] == "3.8"


def test_ingest_ocr_webhook_payload_stores_wrapped_payload_metadata_and_image(monkeypatch):
    db = FakeSession()
    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(make_inbound_webhook_secret="top-secret"),
    )

    result = submissions_endpoints.ingest_ocr_webhook_payload(
        {
            "submission_ref": "MAKE-OCR-WRAPPED-001",
            "source": "make-http",
            "template_type": "shock_setup_sheet",
            "image_url": "data:image/png;base64,AAAA",
            "metadata": {"event_id": "evt-1"},
            "payload": [
                {
                    "type": "shock_setup_sheet",
                    "RR": {"HSR": 7, "LSR": 6, "HBS": 9, "LSB": 8, "SETUP": 30},
                }
            ],
        },
        x_sm2_webhook_secret="top-secret",
        db=db,
    )

    assert result.normalized is True
    assert result.template_type == "shock_setup_sheet"

    insert_submission = next(
        params for sql, params in db.executed if "insert into sm2racing.submission_inputs" in sql.lower()
    )
    snapshot = json.loads(insert_submission["raw_payload_json"])
    assert insert_submission["source"] == "make"
    assert snapshot["submission_ref"] == "MAKE-OCR-WRAPPED-001"
    assert snapshot["metadata"]["event_id"] == "evt-1"
    assert snapshot["image_url"] == "data:image/png;base64,AAAA"

    insert_media = next(
        params for sql, params in db.executed if "insert into sm2racing.media_files" in sql.lower()
    )
    assert insert_media["storage_url"] == "data:image/png;base64,AAAA"
    assert insert_media["file_name"] == "MAKE-OCR-WRAPPED-001.img"


def test_ingest_ocr_webhook_payload_stores_unknown_templates_as_raw_only(monkeypatch):
    db = FakeSession()
    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(make_inbound_webhook_secret="top-secret"),
    )

    result = submissions_endpoints.ingest_ocr_webhook_payload(
        {
            "template_type": "custom_tire_sheet_v2",
            "payload": {
                "type": "custom_tire_sheet_v2",
                "fields": {"lf_hot": 23.1, "rf_hot": 23.0},
            },
        },
        x_sm2_webhook_secret="top-secret",
        db=db,
    )

    assert result.status == "success"
    assert result.normalized is False
    assert result.ocr_id is None
    assert result.template_type == "custom_tire_sheet_v2"

    insert_submission = next(
        params for sql, params in db.executed if "insert into sm2racing.submission_inputs" in sql.lower()
    )
    snapshot = json.loads(insert_submission["raw_payload_json"])
    assert snapshot["template_type"] == "custom_tire_sheet_v2"
    assert snapshot["normalized_analysis"] is None


def test_ingest_ocr_webhook_payload_rejects_invalid_secret(monkeypatch):
    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(make_inbound_webhook_secret="top-secret"),
    )

    with pytest.raises(HTTPException) as exc_info:
        submissions_endpoints.ingest_ocr_webhook_payload(
            {"payload": {"type": "shock_setup_sheet"}},
            x_sm2_webhook_secret="wrong-secret",
            db=FakeSession(),
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail["code"] == "INVALID_WEBHOOK_SECRET"


def test_get_ocr_preview_status_returns_waiting_when_callback_not_received():
    result = submissions_endpoints.get_ocr_preview_status(
        "corr-waiting-123",
        db=FakeSession(),
        current_user=SimpleNamespace(id=uuid4()),
    )

    assert result.status == "submitted_to_make"
    assert result.correlation_id == "corr-waiting-123"
    assert result.source == "make.com"


def test_get_ocr_preview_status_returns_normalized_draft_from_callback(monkeypatch):
    db = FakeSession()
    current_user = SimpleNamespace(id=uuid4())
    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(make_inbound_webhook_secret="top-secret"),
    )

    ingest_result = submissions_endpoints.ingest_ocr_webhook_payload(
        {
            "submission_ref": "MAKE-OCR-ASYNC-001",
            "correlation_id": "corr-async-001",
            "source": "make-http",
            "metadata": {"track": "Sebring", "session_type": "Practice", "session_number": "1"},
            "payload": [
                {
                    "sheet_type": "alignment_sheet",
                    "date": "04/18/26",
                    "time": "10:15 AM",
                    "driver": "Alex G",
                    "track": "Sebring",
                    "camber": {
                        "front_left": 3.8,
                        "front_right": 4.0,
                        "rear_left": 3.3,
                        "rear_right": 3.7,
                    },
                    "toe": {
                        "front_left": "0.10 out",
                        "front_right": "0.12 out",
                        "rear_left": "0.05 in",
                        "rear_right": "0.06 in",
                    },
                }
            ],
        },
        x_sm2_webhook_secret="top-secret",
        db=db,
    )

    result = submissions_endpoints.get_ocr_preview_status(
        "corr-async-001",
        db=db,
        current_user=current_user,
    )

    assert ingest_result.normalized is True
    assert result.status == "review_required"
    assert result.submission_ref == "MAKE-OCR-ASYNC-001"
    assert result.correlation_id == "corr-async-001"
    assert result.source == "make-http"
    assert result.metadata["track_text"] == "Sebring"
    assert result.structured_data["alignment"]["camber_fl"] == "3.8"
    assert result.structured_data["alignment"]["toe_fr"] == "0.12 out"


def test_get_latest_ocr_preview_for_event_returns_latest_staged_draft(monkeypatch):
    db = FakeSession()
    current_user = SimpleNamespace(id=uuid4())
    event_id = str(uuid4())
    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(make_inbound_webhook_secret="top-secret"),
    )

    submissions_endpoints.ingest_ocr_webhook_payload(
        {
            "submission_ref": "MAKE-OCR-EVT-001",
            "correlation_id": "corr-evt-001",
            "source": "make-http",
            "image_url": "data:image/png;base64,AAAA",
            "metadata": {
                "event_id": event_id,
                "track": "Road Atlanta",
                "session_type": "Practice",
                "session_number": "1",
            },
            "payload": {
                "sheet_type": "general_setup_note",
                "date": "04/18/26",
                "time": "2:40 AM",
                "driver": "N. Green",
                "track": "Road Atlanta",
                "camber": {
                    "front_left": 3.6,
                    "front_right": None,
                    "rear_left": None,
                    "rear_right": None,
                },
                "toe": {
                    "front_left": "0.08 OUT",
                    "front_right": None,
                    "rear_left": "0.09 OUT",
                    "rear_right": None,
                },
            },
        },
        x_sm2_webhook_secret="top-secret",
        db=db,
    )

    result = submissions_endpoints.get_latest_ocr_preview_for_event(
        event_id,
        db=db,
        current_user=current_user,
    )

    assert result.status == "review_required"
    assert result.submission_ref == "MAKE-OCR-EVT-001"
    assert result.correlation_id == "corr-evt-001"
    assert result.image_url == "data:image/png;base64,AAAA"
    assert result.source == "make-http"
    assert result.metadata["track_text"] == "Road Atlanta"
    assert result.metadata["driver_text"] == "N. Green"
    assert result.structured_data["alignment"]["camber_fl"] == "3.6"


def test_list_ocr_intake_drafts_by_event_returns_staged_drafts(monkeypatch):
    db = FakeSession()
    current_user = SimpleNamespace(id=uuid4())
    target_event_id = uuid4()
    other_event_id = uuid4()
    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(make_inbound_webhook_secret="top-secret"),
    )

    submissions_endpoints.ingest_ocr_webhook_payload(
        {
            "submission_ref": "MAKE-OCR-EVT-LIST-001",
            "correlation_id": "corr-evt-list-001",
            "source": "make-http",
            "metadata": {
                "event_id": str(target_event_id),
                "event_name": "Sebring Test",
                "run_group": "BLUE",
                "track": "Sebring",
                "session_type": "Practice",
                "session_number": "1",
                "driver_id": "NG",
                "vehicle_id": "NG-GT4-2025",
            },
            "payload": {
                "sheet_type": "general_setup_note",
                "driver": "N. Green",
                "track": "Sebring",
                "notes": ["Entry oversteer."],
            },
        },
        x_sm2_webhook_secret="top-secret",
        db=db,
    )
    submissions_endpoints.ingest_ocr_webhook_payload(
        {
            "submission_ref": "MAKE-OCR-EVT-LIST-002",
            "correlation_id": "corr-evt-list-002",
            "source": "make-http",
            "metadata": {
                "event_id": str(other_event_id),
                "track": "Road Atlanta",
            },
            "payload": {
                "sheet_type": "general_setup_note",
                "driver": "Other Driver",
                "track": "Road Atlanta",
                "notes": ["Ignore this draft."],
            },
        },
        x_sm2_webhook_secret="top-secret",
        db=db,
    )

    result = submissions_endpoints.list_ocr_intake_drafts_by_event(
        target_event_id,
        db=db,
        current_user=current_user,
    )

    assert len(result) == 1
    assert result[0].submission_ref == "MAKE-OCR-EVT-LIST-001"
    assert result[0].event_id == str(target_event_id)
    assert result[0].run_group == "BLUE"
    assert result[0].track == "Sebring"
    assert result[0].normalized is True


def test_list_ocr_intake_drafts_returns_all_staged_make_drafts(monkeypatch):
    db = FakeSession()
    current_user = SimpleNamespace(id=uuid4(), role="OWNER")
    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(make_inbound_webhook_secret="top-secret"),
    )

    submissions_endpoints.ingest_ocr_webhook_payload(
        {
            "submission_ref": "MAKE-OCR-ADMIN-001",
            "correlation_id": "corr-admin-001",
            "source": "make-http",
            "metadata": {"event_id": str(uuid4()), "track": "Sebring"},
            "payload": {
                "sheet_type": "general_setup_note",
                "driver": "N. Green",
                "track": "Sebring",
            },
        },
        x_sm2_webhook_secret="top-secret",
        db=db,
    )
    submissions_endpoints.ingest_ocr_webhook_payload(
        {
            "submission_ref": "MAKE-OCR-ADMIN-002",
            "correlation_id": "corr-admin-002",
            "source": "make-http",
            "metadata": {"event_id": str(uuid4()), "track": "Road Atlanta"},
            "payload": {
                "template_type": "custom_tire_sheet_v2",
                "payload": {"type": "custom_tire_sheet_v2"},
            },
        },
        x_sm2_webhook_secret="top-secret",
        db=db,
    )

    result = submissions_endpoints.list_ocr_intake_drafts(
        db=db,
        current_user=current_user,
    )

    assert len(result) == 2
    assert result[0].submission_ref == "MAKE-OCR-ADMIN-002"
    assert result[1].submission_ref == "MAKE-OCR-ADMIN-001"
    assert result[0].normalized is False
    assert result[1].normalized is True


def test_preview_ocr_submission_allows_make_webhook_without_openai_key(monkeypatch):
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 5, 10),
        end_date=_dt(2026, 5, 20),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        event_id=event.id,
        raw_text="BLUE",
        normalized="BLUE",
    )
    session = _PreviewSession(event=event, run_group=run_group)
    current_user = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")

    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=False,
            openai_api_key=None,
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
        ),
    )
    monkeypatch.setattr(
        submissions_endpoints,
        "analyze_submission_image",
        lambda **_kwargs: {
            "document_type": "printed_form_with_values",
            "template_name": "generic_setup",
            "confidence": 0.77,
            "summary": "Structured review draft",
            "extracted_text": "toe 0.10",
            "setup": {},
            "warnings": [],
            "recommended_review_status": "PENDING",
            "model": "make.com",
        },
    )

    result = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=event.id,
            run_group_id=run_group.id,
            image_url="data:image/png;base64,AAAA",
        ),
        session,
        current_user,
    )

    assert result.status == "partial_extracted"
    assert result.model_used == "make.com"


def test_preview_ocr_submission_returns_tracking_fields_for_make_polling(monkeypatch):
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 5, 10),
        end_date=_dt(2026, 5, 20),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        event_id=event.id,
        raw_text="BLUE",
        normalized="BLUE",
    )
    session = _PreviewSession(event=event, run_group=run_group)
    current_user = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")

    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=False,
            openai_api_key=None,
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
        ),
    )
    monkeypatch.setattr(
        submissions_endpoints,
        "analyze_submission_image",
        lambda **_kwargs: submissions_endpoints._build_ocr_waiting_analysis(),
    )

    result = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=event.id,
            run_group_id=run_group.id,
            image_url="data:image/png;base64,AAAA",
        ),
        session,
        current_user,
    )

    assert result.status == "submitted_to_make"
    assert result.submission_ref.startswith("OCR-PREVIEW-")
    assert result.correlation_id
    assert result.source == "make.com"


def test_preview_ocr_submission_stages_waiting_make_draft_with_selected_context(monkeypatch):
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 5, 10),
        end_date=_dt(2026, 5, 20),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        event_id=event.id,
        raw_text="BLUE",
        normalized="BLUE",
    )
    session = _PreviewSession(event=event, run_group=run_group)
    current_user = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")
    driver = SimpleNamespace(id=uuid4(), driver_id="NG", driver_name="Nicolas Guigere")
    vehicle = SimpleNamespace(id=uuid4(), vehicle_id="NG-GT4-2025", driver_id="NG")
    staged: dict[str, object] = {}

    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=False,
            openai_api_key=None,
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
        ),
    )
    monkeypatch.setattr(
        submissions_endpoints,
        "analyze_submission_image",
        lambda **_kwargs: submissions_endpoints._build_ocr_waiting_analysis(),
    )
    monkeypatch.setattr(
        submissions_endpoints,
        "_validate_ocr_preview_relations",
        lambda _db, _preview_in: (driver, vehicle),
    )

    def capture_stage_submission_input(
        _db,
        *,
        submission,
        event,
        run_group,
        driver,
        vehicle,
        current_user,
        source="pwa",
    ):
        staged["submission"] = submission
        staged["event"] = event
        staged["run_group"] = run_group
        staged["driver"] = driver
        staged["vehicle"] = vehicle
        staged["current_user"] = current_user
        staged["source"] = source
        return 101

    monkeypatch.setattr(
        submissions_endpoints,
        "stage_submission_input",
        capture_stage_submission_input,
    )

    result = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=event.id,
            run_group_id=run_group.id,
            driver_id="NG",
            vehicle_id="NG-GT4-2025",
            image_url="data:image/png;base64,AAAA",
            context={
                "date": "04/18/26",
                "time": "2:40 AM",
                "track": "N. Green",
                "session_type": "Practice",
                "session_number": "1",
            },
        ),
        session,
        current_user,
    )

    assert result.status == "submitted_to_make"
    assert staged["source"] == "pwa"
    assert staged["driver"] is driver
    assert staged["vehicle"] is vehicle
    assert staged["submission"].payload["context"]["track"] == "N. Green"
    assert staged["submission"].analysis_result["has_image_analysis"] is True
    assert staged["submission"].analysis_result["image_analysis"]["status"] == "submitted_to_make"


def test_get_latest_ocr_preview_for_event_returns_waiting_staged_context_before_callback():
    db = FakeSession()
    current_user = SimpleNamespace(id=uuid4())
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 5, 10),
        end_date=_dt(2026, 5, 20),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        event_id=event.id,
        raw_text="BLUE",
        normalized="BLUE",
    )
    driver = SimpleNamespace(
        id=uuid4(),
        driver_id="NG",
        driver_name="Nicolas Guigere",
    )
    vehicle = SimpleNamespace(
        id=uuid4(),
        vehicle_id="NG-GT4-2025",
        driver_id="NG",
        make="Porsche",
        model="GT4 RS Clubsport",
    )
    submitter = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")
    submission = _make_submission(
        submission_ref="OCR-PREVIEW-STAGED-1",
        correlation_id="corr-staged-1",
        raw_text="Brake marker note",
        image_url="data:image/png;base64,AAAA",
        payload={
            "context": {
                "date": "04/18/26",
                "time": "2:40 AM",
                "track": "N. Green",
                "session_type": "Practice",
                "session_number": "1",
                "duration_min": "30",
                "notes": "Brake marker note",
            },
            "image_urls": ["data:image/png;base64,AAAA"],
        },
        analysis_result={
            "ocr_preview": True,
            "force_review_staging": True,
            "has_image_analysis": True,
            "image_analysis_review_status": "PENDING",
            "image_analysis": submissions_endpoints._build_ocr_waiting_analysis(),
        },
    )

    ingest_service.stage_submission_input(
        db,
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        current_user=submitter,
        source="pwa",
    )

    result = submissions_endpoints.get_latest_ocr_preview_for_event(
        str(event.id),
        db=db,
        current_user=current_user,
    )

    assert result.status == "submitted_to_make"
    assert result.source == "make.com"
    assert result.correlation_id == "corr-staged-1"
    assert result.structured_data["session"]["date"] == "04/18/26"
    assert result.structured_data["session"]["time"] == "2:40 AM"
    assert result.structured_data["session"]["track"] == "N. Green"
    assert result.structured_data["session"]["session_type"] == "Practice"
    assert result.structured_data["session"]["session_number"] == "1"
    assert result.structured_data["session"]["duration_min"] == "30"
    assert result.structured_data["session"]["driver_id"] == "NG"
    assert result.structured_data["session"]["vehicle_id"] == "NG-GT4-2025"
    assert result.metadata["driver_text"] == "Nicolas Guigere"
    assert result.metadata["vehicle_text"] == "NG-GT4-2025"
    assert result.structured_data["notes"] == ["Brake marker note"]


def test_preview_ocr_submission_preserves_multiple_source_images(monkeypatch):
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 5, 10),
        end_date=_dt(2026, 5, 20),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        event_id=event.id,
        raw_text="BLUE",
        normalized="BLUE",
    )
    session = _PreviewSession(event=event, run_group=run_group)
    current_user = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")
    captured_submission = {}
    image_urls = [
        "data:image/png;base64,AAAA",
        "data:image/png;base64,BBBB",
        "data:image/png;base64,CCCC",
    ]

    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=False,
            openai_api_key=None,
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
        ),
    )

    def capture_submission(**kwargs):
        submission = kwargs["submission"]
        captured_submission["image_url"] = submission.image_url
        captured_submission["image_urls"] = submission.payload.get("image_urls")
        return submissions_endpoints._build_ocr_waiting_analysis()

    monkeypatch.setattr(submissions_endpoints, "analyze_submission_image", capture_submission)

    result = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=event.id,
            run_group_id=run_group.id,
            image_url=image_urls[0],
            image_urls=image_urls,
        ),
        session,
        current_user,
    )

    assert captured_submission["image_url"] == image_urls[0]
    assert captured_submission["image_urls"] == image_urls
    assert result.image_url == image_urls[0]
    assert result.image_urls == image_urls
    assert result.status == "submitted_to_make"


def test_preview_ocr_submission_returns_editable_draft(monkeypatch):
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 5, 10),
        end_date=_dt(2026, 5, 20),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        event_id=event.id,
        raw_text="BLUE",
        normalized="BLUE",
    )
    session = _PreviewSession(event=event, run_group=run_group)
    current_user = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")

    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
        ),
    )
    monkeypatch.setattr(
        submissions_endpoints,
        "analyze_submission_image",
        lambda **_kwargs: {
            "document_type": "handwritten_setup_grid",
            "template_name": "farnbacher_86_setup_sheet",
            "confidence": 0.84,
            "summary": "Front geometry sheet",
            "extracted_text": "RH front 65, rear 68",
            "raw_text": "RH front 65, rear 68",
            "metadata": {
                "driver_text": "NG",
                "track_text": "Sebring International Raceway",
                "session_text": "Practice S3",
            },
            "setup": {
                "pressures": {
                    "cold_fl": "22.0",
                    "cold_fr": "22.1",
                    "cold_rl": "22.4",
                    "cold_rr": "22.5",
                    "hot_fl": "",
                    "hot_fr": "",
                    "hot_rl": "",
                    "hot_rr": "",
                },
                "suspension": {
                    "rebound_fl": "12",
                    "rebound_fr": "12",
                    "rebound_rl": "11",
                    "rebound_rr": "11",
                    "bump_fl": "",
                    "bump_fr": "",
                    "bump_rl": "",
                    "bump_rr": "",
                    "hsr_fl": "7",
                    "hsr_fr": "7",
                    "hsr_rl": "6",
                    "hsr_rr": "6",
                    "lsr_fl": "4",
                    "lsr_fr": "4",
                    "lsr_rl": "3",
                    "lsr_rr": "3",
                    "hsb_fl": "8",
                    "hsb_fr": "8",
                    "hsb_rl": "7",
                    "hsb_rr": "7",
                    "lsb_fl": "5",
                    "lsb_fr": "5",
                    "lsb_rl": "4",
                    "lsb_rr": "4",
                    "sway_bar_f": "",
                    "sway_bar_r": "",
                    "wing_angle_deg": "",
                },
                "alignment": {
                    "rh_fl": "65",
                    "rh_fr": "65",
                    "rh_rl": "68",
                    "rh_rr": "68",
                    "camber_fl": "-1.5",
                    "camber_fr": "-1.4",
                    "camber_rl": "-2.0",
                    "camber_rr": "-2.0",
                    "toe_fl": "0.05",
                    "toe_fr": "0.05",
                    "toe_rl": "0.10",
                    "toe_rr": "0.10",
                    "toe_front": "0.05",
                    "toe_rear": "0.10",
                    "caster_l": "6.5",
                    "caster_r": "6.4",
                    "ride_height_f": "65",
                    "ride_height_r": "68",
                    "rake_mm": "3",
                    "wheelbase_mm": "2550",
                },
                "sheet_fields": {
                    "fuel_liters": "22.5",
                    "driver_weight_lbs": "180",
                    "scale_weight_lbs": "1280",
                    "cross_weight_percent": "50.0",
                    "roll_bar_text": "3",
                    "spacer_text": "2",
                    "bump_text": "12",
                    "rebound_text": "14",
                    "springs_front": "900",
                    "springs_rear": "1000",
                    "bump_stops_front": "10",
                    "bump_stops_rear": "12",
                    "wheelbase_left_mm": "2550",
                    "wheelbase_right_mm": "2552",
                    "wing_rake_deg": "1.5",
                    "wing_angle_deg": "4",
                    "wing_gurney_mm": "2",
                    "fuel_pumped_out_liters": "3.0",
                    "notes_block": "Out with 15g fuel",
                },
                "post_session": {
                    "camber_text": "front tech values",
                    "toe_text": "1 out / 2.5 in",
                    "weight_text": "1280",
                    "height_text": "80 / 121",
                    "shocks_text": "pending",
                },
                "shock_setup": {
                    "rr": {
                        "position": "RR",
                        "hsr": "7",
                        "lsr": "6",
                        "hsb": "9",
                        "lsb": "8",
                        "total_setup": "30",
                    },
                    "lr": {
                        "position": "LR",
                        "hsr": "",
                        "lsr": "",
                        "hsb": "",
                        "lsb": "",
                        "total_setup": "",
                    },
                    "lf": {
                        "position": "LF",
                        "hsr": "",
                        "lsr": "",
                        "hsb": "",
                        "lsb": "",
                        "total_setup": "",
                    },
                    "rf": {
                        "position": "RF",
                        "hsr": "",
                        "lsr": "",
                        "hsb": "",
                        "lsb": "",
                        "total_setup": "",
                    },
                },
                "tire_temperatures": {},
                "notes": ["Rear ride height looks uncertain"],
            },
            "warnings": ["ambiguous handwriting", "crossed-out value on wheelbase"],
            "recommended_review_status": "PENDING",
            "parser_version": "ocr-v1",
            "model": "gpt-5.4",
            "fallback_model_used": False,
        },
    )

    result = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=event.id,
            run_group_id=run_group.id,
            image_url="data:image/png;base64,AAAA",
            context={"track": "Sebring International Raceway"},
        ),
        session,
        current_user,
    )

    assert result.status == "partial_extracted"
    assert result.doc_type == "handwritten_setup_grid"
    assert result.template_name == "farnbacher_86_setup_sheet"
    assert result.metadata["track_text"] == "Sebring International Raceway"
    assert result.model_used == "gpt-5.4"
    assert result.fallback_used is False
    assert result.raw_text == "RH front 65, rear 68"
    assert result.structured_data["alignment"]["rh_fl"] == "65"
    assert result.structured_data["alignment"]["toe_rl"] == "0.10"
    assert result.structured_data["pressures"]["cold"]["fl"] == "22.0"
    assert result.structured_data["sheet_fields"]["fuel_liters"] == "22.5"
    assert result.structured_data["post_session"]["toe_text"] == "1 out / 2.5 in"
    assert result.structured_data["shock_setup"]["rr"]["hsr"] == "7"
    assert "ambiguous handwriting" in result.review_flags
    assert "crossed-out value on wheelbase" in result.review_flags
    assert "Manual review required" in result.review_flags
    assert result.recommended_review_status == "PENDING"


def test_preview_ocr_submission_tolerates_partial_analysis(monkeypatch):
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 5, 10),
        end_date=_dt(2026, 5, 20),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        event_id=event.id,
        raw_text="BLUE",
        normalized="BLUE",
    )
    session = _PreviewSession(event=event, run_group=run_group)
    current_user = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")

    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
        ),
    )
    monkeypatch.setattr(
        submissions_endpoints,
        "analyze_submission_image",
        lambda **_kwargs: {
            "document_type": "mixed_session_notes",
            "confidence": 0.41,
            "summary": "",
            "extracted_text": "",
            "setup": {},
            "warnings": [],
            "recommended_review_status": "PENDING",
        },
    )

    result = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=event.id,
            run_group_id=run_group.id,
            image_url="data:image/png;base64,AAAA",
        ),
        session,
        current_user,
    )

    assert result.status == "low_quality_review_required"
    assert result.doc_type == "low_quality_review_required"
    assert result.structured_data["alignment"]["rh_fl"] == ""
    assert result.structured_data["pressures"]["cold"]["fl"] == ""
    assert result.structured_data["notes"] == []
    assert "low confidence extraction" in result.review_flags
    assert "Manual review required" in result.review_flags


def test_preview_ocr_submission_reports_service_failure(monkeypatch):
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 5, 10),
        end_date=_dt(2026, 5, 20),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        event_id=event.id,
        raw_text="BLUE",
        normalized="BLUE",
    )
    session = _PreviewSession(event=event, run_group=run_group)
    current_user = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")

    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
        ),
    )
    monkeypatch.setattr(submissions_endpoints, "analyze_submission_image", lambda **_kwargs: None)

    result = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=event.id,
            run_group_id=run_group.id,
            image_url="data:image/png;base64,AAAA",
        ),
        session,
        current_user,
    )

    assert result.status == "extraction_failed"
    assert result.doc_type == "unknown"
    assert result.message == "OCR extraction failed before a safe draft could be created. Retry with a clearer image or use manual correction."
    assert "Manual review required" in result.review_flags


def test_preview_ocr_submission_calls_ocr_service_with_structured_context(monkeypatch):
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 5, 10),
        end_date=_dt(2026, 5, 20),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        event_id=event.id,
        raw_text="BLUE",
        normalized="BLUE",
    )
    session = _PreviewSession(event=event, run_group=run_group)
    current_user = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")
    analyze_calls: list[dict] = []

    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
        ),
    )

    def fake_analyze(**kwargs):
        analyze_calls.append(kwargs)
        return {
            "document_type": "printed_form_with_values",
            "template_name": "generic_setup",
            "confidence": 0.77,
            "summary": "Structured metadata should not bypass OCR extraction",
            "extracted_text": "toe 0.10",
            "setup": {},
            "warnings": [],
            "recommended_review_status": "PENDING",
        }

    monkeypatch.setattr(submissions_endpoints, "analyze_submission_image", fake_analyze)

    result = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=event.id,
            run_group_id=run_group.id,
            image_url="data:image/png;base64,AAAA",
            context={
                "track": "Sebring International Raceway",
                "session_type": "Practice",
                "session_number": "3",
                "duration_min": "30",
                "alignment": {"camber_fl": "-1.5"},
            },
        ),
        session,
        current_user,
    )

    assert len(analyze_calls) == 1
    assert analyze_calls[0]["submission"].analysis_result["ocr_preview"] is True
    assert analyze_calls[0]["submission"].analysis_result["force_review_staging"] is True
    assert analyze_calls[0]["submission"].status == SubmissionStatus.PENDING
    assert analyze_calls[0]["submission"].payload["context"]["alignment"]["camber_fl"] == "-1.5"
    assert result.status == "partial_extracted"


def test_analyze_submission_image_uses_gpt_54_primary_model(monkeypatch):
    submission, event, run_group, driver, vehicle, _current_user = _make_actor_context(
        "OCR-PRIMARY-MODEL",
        _submission_payload(),
    )
    captured_requests: list[dict] = []

    class _FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return json.dumps(
                {
                    "output_text": json.dumps(
                        {
                            "document_type": "setup_sheet",
                            "template_name": "generic_setup",
                            "confidence": 0.88,
                            "summary": "Detected setup values",
                            "extracted_text": "camber 3.8",
                            "events": [],
                            "sessions": [],
                            "setup": {
                                "pressures": {
                                    "cold_fl": "",
                                    "cold_fr": "",
                                    "cold_rl": "",
                                    "cold_rr": "",
                                    "hot_fl": "",
                                    "hot_fr": "",
                                    "hot_rl": "",
                                    "hot_rr": "",
                                },
                                "suspension": {
                                    "rebound_fl": "",
                                    "rebound_fr": "",
                                    "rebound_rl": "",
                                    "rebound_rr": "",
                                    "bump_fl": "",
                                    "bump_fr": "",
                                    "bump_rl": "",
                                    "bump_rr": "",
                                    "sway_bar_f": "",
                                    "sway_bar_r": "",
                                    "wing_angle_deg": "",
                                },
                                "alignment": {
                                    "camber_fl": "3.8",
                                    "camber_fr": "4.0",
                                    "camber_rl": "",
                                    "camber_rr": "",
                                    "toe_front": "",
                                    "toe_rear": "",
                                    "caster_l": "",
                                    "caster_r": "",
                                    "ride_height_f": "",
                                    "ride_height_r": "",
                                    "rake_mm": "",
                                    "wheelbase_mm": "",
                                },
                                "tire_temperatures": {
                                    "fl_in": "",
                                    "fl_mid": "",
                                    "fl_out": "",
                                    "fr_in": "",
                                    "fr_mid": "",
                                    "fr_out": "",
                                    "rl_in": "",
                                    "rl_mid": "",
                                    "rl_out": "",
                                    "rr_in": "",
                                    "rr_mid": "",
                                    "rr_out": "",
                                },
                                "sheet_fields": {
                                    "fuel_liters": "",
                                    "driver_weight_lbs": "",
                                    "scale_weight_lbs": "",
                                    "cross_weight_percent": "",
                                    "roll_bar_text": "",
                                    "spacer_text": "",
                                    "bump_text": "",
                                    "rebound_text": "",
                                    "springs_front": "",
                                    "springs_rear": "",
                                    "bump_stops_front": "",
                                    "bump_stops_rear": "",
                                    "wheelbase_left_mm": "",
                                    "wheelbase_right_mm": "",
                                    "wing_rake_deg": "",
                                    "wing_angle_deg": "",
                                    "wing_gurney_mm": "",
                                    "wicker_text": "",
                                    "specs_toe_text": "",
                                    "corner_weight_text": "",
                                    "static_ride_height_text": "",
                                    "bump_stop_height_text": "",
                                    "arb_front_text": "",
                                    "arb_rear_text": "",
                                    "fuel_pumped_out_liters": "",
                                    "notes_block": "",
                                },
                                "post_session": {
                                    "camber_text": "",
                                    "toe_text": "",
                                    "weight_text": "",
                                    "height_text": "",
                                    "shocks_text": "",
                                },
                                "shock_setup": {
                                    "rr_hsr": "",
                                    "rr_lsr": "",
                                    "rr_hsb": "",
                                    "rr_lsb": "",
                                    "rr_total_setup": "",
                                    "lr_hsr": "",
                                    "lr_lsr": "",
                                    "lr_hsb": "",
                                    "lr_lsb": "",
                                    "lr_total_setup": "",
                                    "lf_hsr": "",
                                    "lf_lsr": "",
                                    "lf_hsb": "",
                                    "lf_lsb": "",
                                    "lf_total_setup": "",
                                    "rf_hsr": "",
                                    "rf_lsr": "",
                                    "rf_hsb": "",
                                    "rf_lsb": "",
                                    "rf_total_setup": "",
                                },
                            },
                            "warnings": [],
                            "recommended_review_status": "PENDING",
                        }
                    )
                }
            ).encode("utf-8")

    monkeypatch.setattr(
        image_analysis_service,
        "get_settings",
        lambda: SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
            openai_request_timeout_seconds=8.0,
        ),
    )

    def fake_urlopen(request, timeout):
        captured_requests.append(
            {
                "payload": json.loads(request.data.decode("utf-8")),
                "timeout": timeout,
            }
        )
        return _FakeResponse()

    monkeypatch.setattr(image_analysis_service.urllib.request, "urlopen", fake_urlopen)

    result = image_analysis_service.analyze_submission_image(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
    )

    assert captured_requests[0]["payload"]["model"] == "gpt-5.4"
    assert result["model"] == "gpt-5.4"
    assert result["fallback_model_used"] is False


def test_analyze_submission_image_uses_fallback_model_when_primary_fails(monkeypatch):
    submission, event, run_group, driver, vehicle, _current_user = _make_actor_context(
        "OCR-FALLBACK-MODEL",
        _submission_payload(),
    )
    attempted_models: list[str] = []

    class _FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return json.dumps(
                {
                    "output_text": json.dumps(
                        {
                            "document_type": "shock_setup_sheet",
                            "template_name": "shock_setup",
                            "confidence": 0.91,
                            "summary": "Shock setup values detected",
                            "extracted_text": "RR 7/6/9/8",
                            "metadata": {
                                "driver_text": "NG",
                                "track_text": "Sebring International Raceway",
                                "session_text": "Practice S3",
                            },
                            "setup": {
                                "pressures": {},
                                "suspension": {},
                                "alignment": {},
                                "tire_temperatures": {},
                                "sheet_fields": {},
                                "post_session": {},
                                "shock_setup": {
                                    "rr": {
                                        "position": "RR",
                                        "hsr": "7",
                                        "lsr": "6",
                                        "hsb": "9",
                                        "lsb": "8",
                                        "total_setup": "30",
                                    },
                                    "lr": {
                                        "position": "LR",
                                        "hsr": "",
                                        "lsr": "",
                                        "hsb": "",
                                        "lsb": "",
                                        "total_setup": "",
                                    },
                                    "lf": {
                                        "position": "LF",
                                        "hsr": "",
                                        "lsr": "",
                                        "hsb": "",
                                        "lsb": "",
                                        "total_setup": "",
                                    },
                                    "rf": {
                                        "position": "RF",
                                        "hsr": "",
                                        "lsr": "",
                                        "hsb": "",
                                        "lsb": "",
                                        "total_setup": "",
                                    },
                                },
                                "notes": [],
                            },
                            "warnings": [],
                            "recommended_review_status": "PENDING",
                        }
                    )
                }
            ).encode("utf-8")

    monkeypatch.setattr(
        image_analysis_service,
        "get_settings",
        lambda: SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
            openai_request_timeout_seconds=8.0,
        ),
    )
    monkeypatch.setattr(
        image_analysis_service,
        "_request_image_classifier",
        lambda **_kwargs: {
            "document_type": "shock_setup_sheet",
            "template_name": "shock_setup",
            "confidence": 0.92,
            "has_values": True,
            "blocked_by_hand": False,
            "quality_flags": [],
            "warnings": [],
            "visible_text_hint": "RR HSR LSR HSB LSB",
        },
    )

    def fake_urlopen(request, timeout):
        payload = json.loads(request.data.decode("utf-8"))
        attempted_models.append(payload["model"])
        if len(attempted_models) == 1:
            raise image_analysis_service.urllib.error.URLError("primary unavailable")
        return _FakeResponse()

    monkeypatch.setattr(image_analysis_service.urllib.request, "urlopen", fake_urlopen)

    result = image_analysis_service.analyze_submission_image(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
    )

    assert attempted_models == ["gpt-5.4", "gpt-5.5"]
    assert result is not None
    assert result["model"] == "gpt-5.5"
    assert result["fallback_model_used"] is True
    assert result["document_type"] == "shock_setup_sheet"


def test_analyze_submission_image_handles_malformed_json_without_crashing(monkeypatch):
    submission, event, run_group, driver, vehicle, _current_user = _make_actor_context(
        "OCR-MALFORMED-JSON",
        _submission_payload(),
    )

    class _FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return json.dumps({"output_text": "{this is not valid json"}).encode("utf-8")

    monkeypatch.setattr(
        image_analysis_service,
        "get_settings",
        lambda: SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model=None,
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
            openai_request_timeout_seconds=8.0,
        ),
    )
    monkeypatch.setattr(
        image_analysis_service,
        "_request_image_classifier",
        lambda **_kwargs: {
            "document_type": "mixed_session_notes",
            "template_name": "alex_notes",
            "confidence": 0.54,
            "has_values": True,
            "blocked_by_hand": False,
            "quality_flags": [],
            "warnings": [],
            "visible_text_hint": "Sebring notes",
        },
    )
    monkeypatch.setattr(image_analysis_service.urllib.request, "urlopen", lambda *_args, **_kwargs: _FakeResponse())

    result = image_analysis_service.analyze_submission_image(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
    )

    assert result is not None
    assert result["status"] == "parser_failed_but_raw_text_available"
    assert result["document_type"] == "low_quality_review_required"
    assert result["raw_text"] == "{this is not valid json"
    assert result["model"] == "gpt-5.4"
    assert "Structured OCR mapping could not be parsed; raw OCR text preserved." in result["warnings"]


def test_analyze_submission_image_uses_relaxed_salvage_when_strict_schema_fails(monkeypatch):
    submission, event, run_group, driver, vehicle, _current_user = _make_actor_context(
        "OCR-RELAXED-SALVAGE",
        _submission_payload(),
    )
    attempted_requests: list[tuple[str, str]] = []

    class _FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return json.dumps({"output_text": json.dumps(self.payload)}).encode("utf-8")

    relaxed_payload = {
        "document_type": "handwritten_setup_grid",
        "confidence": 0.31,
        "summary": "Partial handwritten setup grid recovered",
        "extracted_text": "RH 102 101 100 99",
        "raw_evidence": {
            "visible_text": ["RH", "102", "101", "100", "99"],
            "detected_grids": [
                {
                    "label": "RH",
                    "top_left": "102",
                    "top_right": "101",
                    "bottom_left": "100",
                    "bottom_right": "99",
                }
            ],
            "detected_labels": [{"label": "RH"}],
            "unmapped_values": ["faint handwritten note"],
        },
        "setup": {},
        "warnings": ["Manual review required"],
        "recommended_review_status": "PENDING",
    }

    monkeypatch.setattr(
        image_analysis_service,
        "get_settings",
        lambda: SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model=None,
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
            openai_request_timeout_seconds=8.0,
        ),
    )
    monkeypatch.setattr(
        image_analysis_service,
        "_request_image_classifier",
        lambda **_kwargs: {
            "document_type": "handwritten_setup_grid",
            "template_name": "alex_grid",
            "confidence": 0.78,
            "has_values": True,
            "blocked_by_hand": False,
            "quality_flags": [],
            "warnings": [],
            "visible_text_hint": "RH 102 101 100 99",
        },
    )

    def fake_urlopen(request, timeout):
        payload = json.loads(request.data.decode("utf-8"))
        format_type = payload["text"]["format"]["type"]
        attempted_requests.append((payload["model"], format_type))
        if format_type == "json_schema":
            raise image_analysis_service.urllib.error.URLError("strict schema rejected")
        return _FakeResponse(relaxed_payload)

    monkeypatch.setattr(image_analysis_service.urllib.request, "urlopen", fake_urlopen)

    result = image_analysis_service.analyze_submission_image(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
    )

    assert attempted_requests == [("gpt-5.4", "json_schema"), ("gpt-5.4", "json_object")]
    assert result is not None
    assert result["status"] == "low_quality_review_required"
    assert result["document_type"] == "low_quality_review_required"
    assert result["setup"]["alignment"]["rh_fl"] == "102"
    assert result["setup"]["alignment"]["rh_fr"] == "101"
    assert result["setup"]["alignment"]["rh_rl"] == "100"
    assert result["setup"]["alignment"]["rh_rr"] == "99"
    assert result["model"] == "gpt-5.4"


def test_normalize_image_analysis_marks_low_confidence_results_for_review():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "handwritten_setup_grid",
            "confidence": 0.22,
            "summary": "One camber value is visible",
            "extracted_text": "camber 3.8",
            "setup": {
                "alignment": {
                    "camber_fl": "3.8",
                }
            },
            "warnings": [],
            "recommended_review_status": "APPROVED",
        }
    )

    assert normalized["document_type"] == "low_quality_review_required"
    assert "low confidence extraction" in normalized["warnings"]
    assert normalized["recommended_review_status"] == "PENDING"


def test_normalize_image_analysis_accepts_nested_shock_setup():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "shock_setup_sheet",
            "confidence": 0.9,
            "summary": "Shock page",
            "extracted_text": "RR 7/6/9/8",
            "setup": {
                "shock_setup": {
                    "rr": {
                        "position": "RR",
                        "hsr": "7",
                        "lsr": "6",
                        "hsb": "9",
                        "lsb": "8",
                        "total_setup": "30",
                    }
                }
            },
            "warnings": [],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["setup"]["shock_setup"]["rr"]["hsr"] == "7"
    assert normalized["setup"]["shock_setup"]["rr"]["total_setup"] == "30"


def test_normalize_image_analysis_maps_abbreviation_grids_and_after_values():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "handwritten_setup_grid",
            "confidence": 0.76,
            "summary": "Handwritten setup sheet",
            "raw_text": "RH RH2 C C2 TOE WB",
            "raw_evidence": {
                "visible_text": ["RH", "RH2", "C", "C2", "TOE", "WB"],
                "detected_grids": [
                    {
                        "label": "RH",
                        "top_left": "102",
                        "top_right": "101",
                        "bottom_left": "100",
                        "bottom_right": "99",
                    },
                    {
                        "label": "RH2",
                        "top_left": "98",
                        "top_right": "97",
                        "bottom_left": "96",
                        "bottom_right": "95",
                    },
                    {
                        "label": "C",
                        "top_left": "3.9",
                        "top_right": "3.8",
                        "bottom_left": "3.5",
                        "bottom_right": "3.5",
                    },
                    {
                        "label": "C2",
                        "top_left": "4.0",
                        "top_right": "3.9",
                        "bottom_left": "3.55",
                        "bottom_right": "3.5",
                    },
                    {
                        "label": "TOE",
                        "top_left": "1.0 out",
                        "top_right": "1.0 out",
                        "bottom_left": "2.5 in",
                        "bottom_right": "2.5 in",
                    },
                    {
                        "label": "WB",
                        "top_left": "2475",
                        "top_right": "2475",
                    },
                ],
                "detected_labels": [],
                "unmapped_values": [],
            },
            "setup": {},
            "warnings": [],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["status"] == "partial_extracted"
    assert normalized["setup"]["alignment"]["rh_fl"] == "98"
    assert normalized["setup"]["alignment"]["rh_fr"] == "97"
    assert normalized["setup"]["alignment"]["rh_rl"] == "96"
    assert normalized["setup"]["alignment"]["rh_rr"] == "95"
    assert normalized["setup"]["alignment"]["camber_fl"] == "4.0"
    assert normalized["setup"]["alignment"]["camber_fr"] == "3.9"
    assert normalized["setup"]["alignment"]["camber_rl"] == "3.55"
    assert normalized["setup"]["alignment"]["camber_rr"] == "3.5"
    assert normalized["setup"]["alignment"]["toe_fl"] == "1.0 out"
    assert normalized["setup"]["alignment"]["toe_fr"] == "1.0 out"
    assert normalized["setup"]["alignment"]["toe_rl"] == "2.5 in"
    assert normalized["setup"]["alignment"]["toe_rr"] == "2.5 in"
    assert normalized["setup"]["alignment"]["wheelbase_mm"] == "2475"
    assert normalized["setup"]["sheet_fields"]["wheelbase_left_mm"] == "2475"
    assert normalized["setup"]["sheet_fields"]["wheelbase_right_mm"] == "2475"
    assert "Before and after values detected; after value used." in normalized["warnings"]


def test_normalize_image_analysis_accepts_hbs_alias_in_shock_setup():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "shock_setup_sheet",
            "confidence": 0.9,
            "summary": "Shock page",
            "extracted_text": "RR 7/6/9/8",
            "setup": {
                "shock_setup": {
                    "rr": {
                        "position": "RR",
                        "hsr": "7",
                        "lsr": "6",
                        "hbs": "9",
                        "lsb": "8",
                        "total_setup": "30",
                    }
                }
            },
            "warnings": [],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["setup"]["shock_setup"]["rr"]["position"] == "RR"
    assert normalized["setup"]["shock_setup"]["rr"]["hsb"] == "9"
    assert normalized["setup"]["shock_setup"]["rr"]["lsb"] == "8"


def test_analyze_submission_image_uses_fallback_when_primary_result_is_too_sparse(monkeypatch):
    submission, event, run_group, driver, vehicle, _current_user = _make_actor_context(
        "OCR-SPARSE-PRIMARY",
        _submission_payload(),
    )
    attempted_models: list[str] = []

    class _FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return json.dumps({"output_text": json.dumps(self.payload)}).encode("utf-8")

    primary_payload = {
        "document_type": "unknown",
        "confidence": 0.18,
        "summary": "",
        "extracted_text": "",
        "setup": {},
        "warnings": ["ambiguous handwriting"],
        "recommended_review_status": "PENDING",
    }
    fallback_payload = {
        "document_type": "handwritten_setup_grid",
        "confidence": 0.82,
        "summary": "Mapped handwritten setup grid",
        "extracted_text": "RH 102 101 100 99",
        "raw_evidence": {
            "visible_text": ["RH", "102", "101", "100", "99"],
            "detected_grids": [
                {
                    "label": "RH",
                    "top_left": "102",
                    "top_right": "101",
                    "bottom_left": "100",
                    "bottom_right": "99",
                }
            ],
            "detected_labels": [{"label": "RH"}],
            "unmapped_values": [],
        },
        "setup": {},
        "warnings": [],
        "recommended_review_status": "PENDING",
    }

    monkeypatch.setattr(
        image_analysis_service,
        "get_settings",
        lambda: SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
            openai_request_timeout_seconds=8.0,
        ),
    )
    monkeypatch.setattr(
        image_analysis_service,
        "_request_image_classifier",
        lambda **_kwargs: {
            "document_type": "handwritten_setup_grid",
            "template_name": "alex_grid",
            "confidence": 0.77,
            "has_values": True,
            "blocked_by_hand": False,
            "quality_flags": [],
            "warnings": [],
            "visible_text_hint": "RH 102 101 100 99",
        },
    )
    monkeypatch.setattr(
        image_analysis_service,
        "_should_retry_with_fallback",
        lambda image_analysis, fallback_model: (
            image_analysis.get("model") == "gpt-5.4" and bool(fallback_model),
            "primary_sparse_result",
        ),
    )

    def fake_urlopen(request, timeout):
        payload = json.loads(request.data.decode("utf-8"))
        attempted_models.append(payload["model"])
        if payload["model"] == "gpt-5.4":
            return _FakeResponse(primary_payload)
        return _FakeResponse(fallback_payload)

    monkeypatch.setattr(image_analysis_service.urllib.request, "urlopen", fake_urlopen)

    result = image_analysis_service.analyze_submission_image(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
    )

    assert attempted_models == ["gpt-5.4", "gpt-5.5"]
    assert result is not None
    assert result["status"] == "success"
    assert result["model"] == "gpt-5.5"
    assert result["fallback_model_used"] is True
    assert result["document_type"] == "handwritten_setup_grid"
    assert result["setup"]["alignment"]["rh_fl"] == "102"


def test_should_retry_with_fallback_for_low_confidence_sparse_result():
    should_retry, reason = image_analysis_service._should_retry_with_fallback(
        {
            "status": "partial_extracted",
            "document_type": "handwritten_setup_grid",
            "confidence": 0.18,
            "warnings": ["ambiguous handwriting"],
            "_field_count": 1,
            "raw_text": "RH 102",
            "has_values": True,
        },
        "gpt-5.5",
    )

    assert should_retry is True
    assert reason == "primary_low_confidence"


def test_preview_ocr_submission_unknown_document_returns_review_required(monkeypatch):
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 5, 10),
        end_date=_dt(2026, 5, 20),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        event_id=event.id,
        raw_text="BLUE",
        normalized="BLUE",
    )
    session = _PreviewSession(event=event, run_group=run_group)
    current_user = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")

    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
        ),
    )
    monkeypatch.setattr(
        submissions_endpoints,
        "analyze_submission_image",
        lambda **_kwargs: {
            "document_type": "unknown",
            "confidence": 0.35,
            "summary": "Notebook page with a few visible values",
            "extracted_text": "Sebring Daniel initial setup 22.5 psi",
            "setup": {},
            "warnings": ["label-to-grid mapping uncertain"],
            "recommended_review_status": "PENDING",
            "model": "gpt-5.4",
        },
    )

    result = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=event.id,
            run_group_id=run_group.id,
            image_url="data:image/png;base64,AAAA",
        ),
        session,
        current_user,
    )

    assert result.status == "low_quality_review_required"
    assert result.doc_type == "low_quality_review_required"
    assert "label-to-grid mapping uncertain" in result.review_flags
    assert "Manual review required" in result.review_flags


def test_normalize_image_analysis_result_maps_sequential_data_blocks():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "handwritten_setup_grid",
            "confidence": 0.88,
            "summary": "Alex-style handwritten sheet",
            "extracted_text": "",
            "metadata": {
                "driver_text": "Jeff Sebring",
                "track_text": "Sebring",
                "session_text": "",
                "session_notes": "Spring medium",
            },
            "raw_evidence": {
                "visible_text": [],
                "detected_grids": [],
                "detected_labels": [],
                "unmapped_values": [],
            },
            "data_blocks": [
                {
                    "sequence_id": 1,
                    "label": "RH",
                    "coordinates_context": "top-left",
                    "data": {"fl": "102", "fr": "101", "rl": "100", "rr": "99"},
                    "raw_text_found": {"fl": "102", "fr": "101", "rl": "100", "rr": "99"},
                    "adjustments_applied": "",
                },
                {
                    "sequence_id": 2,
                    "label": "RH2",
                    "coordinates_context": "upper-right",
                    "data": {"fl": "98", "fr": "97", "rl": "100", "rr": "95"},
                    "raw_text_found": {"fl": "98", "fr": "97", "rl": "100", "rr": "95"},
                    "adjustments_applied": "after-session values supersede the first grid",
                },
                {
                    "sequence_id": 3,
                    "label": "C",
                    "coordinates_context": "mid-left",
                    "data": {"fl": "3.9", "fr": "3.8", "rl": "3.7", "rr": "3.5"},
                    "raw_text_found": {"fl": "3.9", "fr": "3.8", "rl": "3.7", "rr": "3.5"},
                    "adjustments_applied": "",
                },
                {
                    "sequence_id": 4,
                    "label": "C2",
                    "coordinates_context": "mid-right",
                    "data": {"fl": "4.0", "fr": "3.9", "rl": "3.55", "rr": "3.5"},
                    "raw_text_found": {"fl": "4.0", "fr": "3.9", "rl": "3.55", "rr": "3.5"},
                    "adjustments_applied": "",
                },
                {
                    "sequence_id": 5,
                    "label": "WB",
                    "coordinates_context": "bottom",
                    "data": {"fl": "2475", "fr": "2475", "rl": "", "rr": ""},
                    "raw_text_found": {"fl": "2475", "fr": "2475", "rl": "", "rr": ""},
                    "adjustments_applied": "",
                },
            ],
            "unstructured_elements": ["50.4%", "Sebring Daniel initial setup"],
            "warnings": [],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["document_type"] == "handwritten_setup_grid"
    assert normalized["metadata"]["session_text"] == "Spring medium"
    assert normalized["setup"]["alignment"]["rh_fl"] == "98"
    assert normalized["setup"]["alignment"]["rh_fr"] == "97"
    assert normalized["setup"]["alignment"]["rh_rr"] == "95"
    assert normalized["setup"]["alignment"]["camber_fl"] == "4.0"
    assert normalized["setup"]["alignment"]["camber_rl"] == "3.55"
    assert normalized["setup"]["alignment"]["wheelbase_mm"] == "2475"
    assert "Before and after values detected; after value used." in normalized["warnings"]
    assert any(grid["label"] == "RH2" for grid in normalized["raw_evidence"]["detected_grids"])
    assert "50.4%" in normalized["setup"]["notes"]


def test_preview_ocr_submission_accepts_blank_setup_sheet(monkeypatch):
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 5, 10),
        end_date=_dt(2026, 5, 20),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        event_id=event.id,
        raw_text="BLUE",
        normalized="BLUE",
    )
    session = _PreviewSession(event=event, run_group=run_group)
    current_user = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")

    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
        ),
    )
    monkeypatch.setattr(
        submissions_endpoints,
        "analyze_submission_image",
        lambda **_kwargs: {
            "document_type": "blank_setup_sheet",
            "confidence": 0.96,
            "summary": "Blank printed setup sheet",
            "extracted_text": "",
            "setup": {},
            "warnings": ["no readable setup values detected"],
            "recommended_review_status": "PENDING",
            "model": "gpt-5.4",
        },
    )

    result = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=event.id,
            run_group_id=run_group.id,
            image_url="data:image/png;base64,AAAA",
        ),
        session,
        current_user,
    )

    assert result.status == "blank_template_detected"
    assert result.doc_type == "blank_setup_sheet"
    assert result.structured_data["alignment"]["rh_fl"] == ""
    assert "no readable setup values detected" in result.review_flags


def test_preview_ocr_submission_builds_review_draft_from_data_blocks(monkeypatch):
    event = SimpleNamespace(
        id=uuid4(),
        name="Sebring",
        track="Sebring International Raceway",
        start_date=_dt(2026, 5, 10),
        end_date=_dt(2026, 5, 20),
        is_active=True,
    )
    run_group = SimpleNamespace(
        id=uuid4(),
        event_id=event.id,
        raw_text="BLUE",
        normalized="BLUE",
    )
    session = _PreviewSession(event=event, run_group=run_group)
    current_user = SimpleNamespace(id=uuid4(), name="Mechanic One", email="mechanic@example.com")

    monkeypatch.setattr(
        submissions_endpoints,
        "settings",
        SimpleNamespace(
            chatbot_image_analysis_enabled=True,
            openai_api_key="test-key",
            openai_vision_model="gpt-5.4",
            openai_fallback_model="gpt-5.5",
            make_ocr_webhook_url="https://hook.make.com/ocr-preview",
        ),
    )
    monkeypatch.setattr(
        submissions_endpoints,
        "analyze_submission_image",
        lambda **_kwargs: {
            "document_type": "handwritten_setup_grid",
            "confidence": 0.73,
            "summary": "Verified grid blocks extracted",
            "extracted_text": "",
            "metadata": {
                "driver_text": "Jeff Sebring",
                "track_text": "Sebring",
                "session_text": "",
                "session_notes": "Spring medium",
            },
            "raw_evidence": {
                "visible_text": [],
                "detected_grids": [],
                "detected_labels": [],
                "unmapped_values": [],
            },
            "data_blocks": [
                {
                    "sequence_id": 1,
                    "label": "RH",
                    "coordinates_context": "top-left",
                    "data": {"fl": "102", "fr": "101", "rl": "100", "rr": "99"},
                    "raw_text_found": {"fl": "102", "fr": "101", "rl": "100", "rr": "99"},
                    "adjustments_applied": "",
                },
                {
                    "sequence_id": 2,
                    "label": "C",
                    "coordinates_context": "middle",
                    "data": {"fl": "3.9", "fr": "3.8", "rl": "3.7", "rr": "3.5"},
                    "raw_text_found": {"fl": "3.9", "fr": "3.8", "rl": "3.7", "rr": "3.5"},
                    "adjustments_applied": "",
                },
            ],
            "unstructured_elements": ["50.4%", "margin note: Sebring medium"],
            "warnings": ["manual verification recommended"],
            "recommended_review_status": "PENDING",
            "model": "gpt-5.4",
        },
    )

    result = submissions_endpoints.preview_ocr_submission(
        OcrPreviewCreate(
            event_id=event.id,
            run_group_id=run_group.id,
            image_url="data:image/png;base64,AAAA",
        ),
        session,
        current_user,
    )

    assert result.status == "partial_extracted"
    assert result.doc_type == "handwritten_setup_grid"
    assert result.model_used == "gpt-5.4"
    assert result.structured_data["alignment"]["rh_fl"] == "102"
    assert result.structured_data["alignment"]["camber_rr"] == "3.5"
    assert "50.4%" in result.structured_data["notes"]
    assert "manual verification recommended" in result.review_flags


def test_normalize_image_analysis_detects_blank_farnbacher_loles_template():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "blank_setup_sheet",
            "has_values": False,
            "confidence": 0.96,
            "summary": "Blank Farnbacher-Loles setup template",
            "extracted_text": "",
            "raw_evidence": {
                "visible_text": ["DATE", "DRIVER", "TRACK", "CAMBER", "TOE"],
                "detected_grids": [],
                "detected_labels": [{"label": "CAMBER"}, {"label": "TOE"}],
                "unmapped_values": [],
                "template_labels": ["CAMBER", "TOE"],
                "quality_flags": [],
            },
            "setup": {},
            "warnings": [],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["status"] == "blank_template_detected"
    assert normalized["document_type"] == "blank_setup_sheet"
    assert normalized["raw_evidence"]["template_labels"] == ["CAMBER", "TOE"]


def test_normalize_image_analysis_marks_hand_blocked_printed_sheet_as_partial():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "printed_form_with_values",
            "has_values": True,
            "confidence": 0.72,
            "summary": "Printed sheet with hand blocking the header",
            "extracted_text": "camber 4.1 4.1 3.7 3.7",
            "classifier": {
                "document_type": "printed_form_with_values",
                "template_name": "alex_form",
                "confidence": 0.81,
                "has_values": True,
                "blocked_by_hand": True,
                "quality_flags": ["hand partially blocks header"],
                "warnings": [],
                "visible_text_hint": "CAMBER",
            },
            "setup": {
                "alignment": {
                    "camber_fl": "4.1",
                    "camber_fr": "4.1",
                    "camber_rl": "3.7",
                    "camber_rr": "3.7",
                }
            },
            "warnings": ["top header partially occluded"],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["status"] == "partial_extracted"
    assert "blocked_by_hand" in normalized["warnings"]
    assert normalized["blocked_by_hand"] is True


def test_normalize_image_analysis_extracts_handwritten_sebring_candidates():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "handwritten_setup_grid",
            "has_values": True,
            "confidence": 0.68,
            "summary": "Sebring handwritten notes",
            "extracted_text": "Sebring Daniel initial setup 22.5 psi",
            "metadata": {
                "driver_text": "Daniel",
                "track_text": "Sebring",
                "session_text": "Initial setup",
            },
            "setup": {
                "pressures": {
                    "cold_fl": "22.5",
                    "cold_fr": "22.5",
                },
                "alignment": {
                    "camber_fl": "4.1",
                    "camber_fr": "4.3",
                    "toe_fl": "1 out",
                    "toe_fr": "1 out",
                },
                "sheet_fields": {
                    "corner_weight_text": "553 / 559 / 843 / 887",
                    "fuel_liters": "10",
                },
            },
            "warnings": ["manual verification recommended"],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["normalized_sections"]["session_context"]["track_text"] == "Sebring"
    assert normalized["normalized_sections"]["tire_pressure"]["cold_fl"] == "22.5"
    assert normalized["normalized_sections"]["camber"]["camber_fl"] == "4.1"
    assert normalized["normalized_sections"]["toe"]["toe_fl"] == "1 out"
    assert normalized["normalized_sections"]["corner_weight"]["corner_weight_text"] == "553 / 559 / 843 / 887"


def test_normalize_image_analysis_extracts_chicago_imsa_mixed_note_candidates():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "mixed_session_notes",
            "has_values": True,
            "confidence": 0.64,
            "summary": "Chicago IMSA mixed notes",
            "extracted_text": "Chicago IMSA test day 45 min",
            "metadata": {
                "driver_text": "",
                "track_text": "Chicago",
                "session_text": "IMSA test day",
            },
            "setup": {
                "pressures": {
                    "cold_fl": "15g fuel",
                },
                "alignment": {
                    "camber_fl": "3.8",
                    "camber_fr": "4.0",
                    "rh_fl": "80.0",
                    "rh_fr": "81.16",
                    "toe_fl": "1.0 out",
                    "toe_fr": "1.0 out",
                },
                "suspension": {
                    "lsr_fl": "6",
                    "hsr_fl": "7",
                    "sway_bar_f": "3",
                },
                "sheet_fields": {
                    "cross_weight_percent": "50.02%",
                    "scale_weight_lbs": "1280",
                    "fuel_liters": "15g",
                },
                "notes": ["Sunny", "1st session", "45 min"],
            },
            "warnings": ["duplicate evidence detected"],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["normalized_sections"]["session_context"]["track_text"] == "Chicago"
    assert normalized["normalized_sections"]["ride_height"]["rh_fl"] == "80.0"
    assert normalized["normalized_sections"]["camber"]["camber_fr"] == "4.0"
    assert normalized["normalized_sections"]["toe"]["toe_fl"] == "1.0 out"
    assert normalized["normalized_sections"]["corner_weight"]["scale_weight_lbs"] == "1280"
    assert normalized["normalized_sections"]["shocks"]["sway_bar_f"] == "3"


def test_classifier_only_blank_shock_sheet_is_not_extraction_failed():
    normalized = image_analysis_service.normalize_image_analysis_result(
        image_analysis_service._build_classifier_only_analysis(
            classifier={
                "document_type": "shock_setup_sheet",
                "template_name": "shock_setup",
                "confidence": 0.94,
                "has_values": False,
                "blocked_by_hand": False,
                "quality_flags": [],
                "warnings": [],
                "visible_text_hint": "Shocks setup",
            },
            model="gpt-5.4",
            preprocessing_info={},
        )
    )

    assert normalized["document_type"] == "shock_setup_sheet"
    assert normalized["status"] == "blank_template_detected"
    assert normalized["status"] != "extraction_failed"


def test_normalize_image_analysis_tolerates_null_racing_fields():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "printed_form_with_values",
            "has_values": True,
            "confidence": 0.61,
            "summary": "Null-friendly parser payload",
            "extracted_text": "camber",
            "setup": {
                "alignment": {
                    "camber_fl": None,
                    "camber_fr": None,
                    "toe_fl": None,
                },
                "pressures": {
                    "cold_fl": None,
                    "hot_fl": None,
                },
            },
            "warnings": [],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["status"] in {"review_required", "partial_extracted", "low_quality_review_required"}
    assert normalized["setup"]["alignment"]["camber_fl"] == ""
    assert normalized["setup"]["pressures"]["cold_fl"] == ""


def test_normalize_image_analysis_keeps_sparse_corner_values_blank_on_the_missing_side():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "printed_form_with_values",
            "has_values": True,
            "confidence": 0.72,
            "summary": "Sparse left-side toe capture",
            "extracted_text": "toe 0.08 out 0.09 out",
            "setup": {
                "alignment": {
                    "rh_fl": "79.7",
                    "rh_fr": "80.8",
                    "rh_rl": "120.6",
                    "rh_rr": "120.3",
                    "ride_height_f": "",
                    "ride_height_r": "",
                    "camber_fl": "3.6",
                    "camber_fr": "",
                    "camber_rl": "",
                    "camber_rr": "",
                    "toe_fl": "0.08 OUT",
                    "toe_fr": "",
                    "toe_rl": "0.09 OUT",
                    "toe_rr": "",
                    "toe_front": "",
                    "toe_rear": "",
                },
                "pressures": {
                    "cold_fl": "23",
                    "cold_fr": "23.4",
                    "cold_rl": "22",
                    "cold_rr": "22.3",
                },
            },
            "warnings": ["Manual review required"],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["setup"]["alignment"]["toe_fl"] == "0.08 OUT"
    assert normalized["setup"]["alignment"]["toe_fr"] == ""
    assert normalized["setup"]["alignment"]["toe_rl"] == "0.09 OUT"
    assert normalized["setup"]["alignment"]["toe_rr"] == ""
    assert normalized["setup"]["alignment"]["toe_front"] == ""
    assert normalized["setup"]["alignment"]["toe_rear"] == ""
    assert normalized["setup"]["alignment"]["rh_fl"] == "79.7"
    assert normalized["setup"]["alignment"]["rh_fr"] == "80.8"
    assert normalized["setup"]["alignment"]["ride_height_f"] == ""
    assert normalized["setup"]["alignment"]["ride_height_r"] == ""


def test_low_quality_image_keeps_raw_evidence_for_review():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "low_quality_review_required",
            "has_values": False,
            "confidence": 0.18,
            "summary": "Low quality but some text visible",
            "extracted_text": "",
            "raw_evidence": {
                "visible_text": ["Sebring", "22.5 psi", "camber"],
                "detected_grids": [],
                "detected_labels": [],
                "unmapped_values": ["22.5 psi"],
            },
            "warnings": [],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["status"] == "low_quality_review_required"
    assert normalized["raw_text"] == "Sebring\n22.5 psi\ncamber"
    assert "22.5 psi" in normalized["raw_evidence"]["unmapped_values"]


def test_normalize_image_analysis_keeps_clean_printed_form_primary_and_after_session_separate():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "printed_form_with_values",
            "template_name": "farnbacher_loles_setup_sheet",
            "has_values": True,
            "confidence": 0.74,
            "summary": "Printed setup form with upper and lower sections",
            "extracted_text": "Alex G Sebring 42 liters 3.8 4.0",
            "classifier": {
                "document_type": "printed_form_with_values",
                "template_name": "farnbacher_loles_setup_sheet",
                "confidence": 0.92,
                "has_values": True,
                "blocked_by_hand": False,
                "quality_flags": [],
                "warnings": [],
                "visible_text_hint": "CAMBER",
            },
            "metadata": {
                "driver_text": "Alex G",
                "track_text": "Sebring",
                "session_text": "04/18/26 10:15 AM",
            },
            "setup": {
                "alignment": {
                    "camber_fl": "3.8",
                    "camber_fr": "4.0",
                    "camber_rl": "3.3",
                    "camber_rr": "3.7",
                    "toe_fl": "0.10 out",
                    "toe_fr": "0.12 out",
                    "toe_rl": "0.05 in",
                    "toe_rr": "0.06 in",
                    "rh_fl": "80.0",
                    "rh_fr": "81.1",
                    "rh_rl": "121.0",
                    "rh_rr": "120.8",
                },
                "pressures": {
                    "cold_fl": "22.8",
                    "cold_fr": "23.1",
                    "cold_rl": "21.9",
                    "cold_rr": "22.2",
                },
                "sheet_fields": {
                    "fuel_liters": "42",
                    "driver_weight_lbs": "178",
                    "scale_weight_lbs": "1278",
                    "cross_weight_percent": "50.2%",
                    "roll_bar_text": "3 front / 2 rear",
                    "spacer_text": "8",
                    "bump_text": "6",
                    "rebound_text": "9",
                    "springs_front": "900",
                    "springs_rear": "1050",
                    "bump_stops_front": "6",
                    "bump_stops_rear": "8",
                    "wheelbase_left_mm": "109.8",
                    "wheelbase_right_mm": "109.9",
                    "wing_rake_deg": "2.5",
                    "wing_angle_deg": "7",
                    "wing_gurney_mm": "12",
                    "notes_block": "Good overall balance; slight push on entry.",
                    "fuel_pumped_out_liters": "",
                },
                "post_session": {
                    "camber_text": "3.6 / 3.8 / 3.1 / 3.5",
                    "toe_text": "0.08 out / 0.10 out / 0.04 in / 0.05 in",
                    "weight_text": "528 / 533 / 842 / 846",
                    "height_text": "80.2 / 81.3 / 121.1 / 120.9",
                    "shocks_text": "6 / 9 / 6 / 9",
                },
                "notes": ["Entry stability improved with more front bar."],
            },
            "warnings": [],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["document_type"] == "printed_form_with_values"
    assert normalized["status"] in {"success", "partial_extracted"}
    assert normalized["status"] != "low_quality_review_required"
    assert normalized["setup"]["alignment"]["camber_fl"] == "3.8"
    assert normalized["setup"]["alignment"]["rh_fl"] == "80.0"
    assert normalized["setup"]["post_session"]["camber_text"] == "3.6 / 3.8 / 3.1 / 3.5"
    assert normalized["normalized_sections"]["post_session"]["height_text"] == "80.2 / 81.3 / 121.1 / 120.9"
    assert normalized["normalized_sections"]["post_session"]["fuel_pumped_out_liters"] == ""
    assert any(
        entry["category"] == "post_session" and entry["key"] == "camber_text"
        for entry in normalized["field_evidence"]
    )


def test_normalize_image_analysis_preserves_printed_form_layout_when_confidence_is_soft():
    normalized = image_analysis_service.normalize_image_analysis_result(
        {
            "document_type": "printed_form_with_values",
            "template_name": "farnbacher_loles_setup_sheet",
            "has_values": True,
            "confidence": 0.41,
            "summary": "Printed setup form with sparse lower section",
            "extracted_text": "Alex G Sebring camber 3.8 4.0 toe 0.10 out",
            "classifier": {
                "document_type": "printed_form_with_values",
                "template_name": "farnbacher_loles_setup_sheet",
                "confidence": 0.9,
                "has_values": True,
                "blocked_by_hand": False,
                "quality_flags": [],
                "warnings": [],
                "visible_text_hint": "CAMBER",
            },
            "setup": {
                "alignment": {
                    "camber_fl": "3.8",
                    "camber_fr": "4.0",
                    "camber_rl": "3.3",
                    "camber_rr": "3.7",
                    "toe_fl": "0.10 out",
                    "toe_fr": "0.12 out",
                    "toe_rl": "0.05 in",
                    "toe_rr": "0.06 in",
                    "rh_fl": "80.0",
                    "rh_fr": "81.1",
                },
                "pressures": {
                    "cold_fl": "22.8",
                    "cold_fr": "23.1",
                },
                "sheet_fields": {
                    "fuel_liters": "42",
                    "driver_weight_lbs": "178",
                    "roll_bar_text": "3 front / 2 rear",
                    "spacer_text": "8",
                    "bump_text": "6",
                    "rebound_text": "9",
                },
                "post_session": {
                    "camber_text": "",
                    "toe_text": "",
                    "weight_text": "",
                    "height_text": "",
                    "shocks_text": "",
                },
            },
            "warnings": ["lower block not fully populated"],
            "recommended_review_status": "PENDING",
        }
    )

    assert normalized["document_type"] == "printed_form_with_values"
    assert normalized["status"] == "partial_extracted"
    assert normalized["status"] != "low_quality_review_required"
    assert normalized["_printed_form_primary_field_count"] >= 8


def test_submission_update_allows_creator_to_overwrite_notes(monkeypatch):
    current_user = SimpleNamespace(
        id=uuid4(),
        name="Mechanic One",
        email="mechanic@example.com",
        role=SimpleNamespace(value="MECHANIC"),
    )
    submission = SimpleNamespace(
        id=uuid4(),
        submission_ref="SUB-123",
        correlation_id="corr-123",
        created_by_id=current_user.id,
        driver_id=None,
        vehicle_id=None,
        raw_text="original note",
        image_url=None,
        payload={"data": {"session_id": "SEB-1", "track": "Sebring International Raceway"}},
        analysis_result={"submission_mode": "quick", "has_structured_data": False},
        status=SubmissionStatus.SENT,
        error_message=None,
        structured_ingest_status="skipped",
        structured_ingest_warnings=[],
        event=SimpleNamespace(id=uuid4()),
        run_group=SimpleNamespace(id=uuid4()),
        driver=None,
        vehicle=None,
    )
    session = FakeSession()

    monkeypatch.setattr(submissions_endpoints, "_load_submission", lambda _db, _submission_id: submission)
    monkeypatch.setattr(submissions_endpoints, "_finalize_delivery", lambda _db, loaded_submission, **_kwargs: loaded_submission)
    monkeypatch.setattr(submissions_endpoints, "_write_audit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(submissions_endpoints, "should_persist_structured_submission", lambda *_args, **_kwargs: False)

    result = submissions_endpoints.update_submission(
        submission.id,
        SubmissionUpdate(
            raw_text="updated short note",
            image_url="data:image/png;base64,AAAA",
            payload={"session_id": "SEB-1", "track": "Sebring International Raceway"},
            analysis_result={"submission_mode": "quick", "has_structured_data": False},
        ),
        BackgroundTasks(),
        session,
        current_user,
    )

    assert result.raw_text == "updated short note"
    assert result.image_url == "data:image/png;base64,AAAA"
    assert result.payload["session_id"] == "SEB-1"
    assert submission.raw_text == "updated short note"
    assert session.commits == 2


def test_submission_update_blocks_non_creator_non_admin(monkeypatch):
    current_user = SimpleNamespace(
        id=uuid4(),
        name="Mechanic Two",
        email="mechanic2@example.com",
        role=SimpleNamespace(value="MECHANIC"),
    )
    submission = SimpleNamespace(
        id=uuid4(),
        submission_ref="SUB-456",
        correlation_id="corr-456",
        created_by_id=uuid4(),
        driver_id=None,
        vehicle_id=None,
        raw_text="original note",
        image_url=None,
        payload={"data": {"session_id": "SEB-2"}},
        analysis_result={"submission_mode": "quick", "has_structured_data": False},
        status=SubmissionStatus.SENT,
        error_message=None,
        structured_ingest_status="skipped",
        structured_ingest_warnings=[],
        event=SimpleNamespace(id=uuid4()),
        run_group=SimpleNamespace(id=uuid4()),
        driver=None,
        vehicle=None,
    )
    session = FakeSession()

    monkeypatch.setattr(submissions_endpoints, "_load_submission", lambda _db, _submission_id: submission)

    with pytest.raises(HTTPException) as exc_info:
        submissions_endpoints.update_submission(
            submission.id,
            SubmissionUpdate(raw_text="should not save"),
            BackgroundTasks(),
            session,
            current_user,
        )

    assert exc_info.value.status_code == 403
    assert session.commits == 0
