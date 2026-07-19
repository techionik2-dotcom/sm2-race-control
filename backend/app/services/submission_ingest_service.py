from __future__ import annotations

import logging
import json
import re
import uuid
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import TireInventoryStatus
from app.models.driver import Driver
from app.models.event import Event
from app.models.run_group import RunGroup
from app.models.structured_notes import TireHistory, TireInventory
from app.models.submission import Submission
from app.models.user import User
from app.models.vehicle import Vehicle
from app.services.submission_payload_service import get_session_payload


DB_SCHEMA = get_settings().database_schema
# Accept both the legacy UI-generated format (YYYYMMDD-HHMM-DRIVERID-S1)
# and the backend-owned raw-ingest format (YYYYMMDD-DRIVERID-S01).
SESSION_ID_PATTERN = re.compile(r"^\d{8}-(?:\d{4}-)?[A-Z0-9]+-S\d+$")
PRESSURE_LIMITS = {
    "cold": (5.0, 60.0),
    "hot": (5.0, 80.0),
}
logger = logging.getLogger(__name__)


@dataclass
class StructuredPersistResult:
    submission_input_id: int | None = None
    status: str = "skipped"
    warnings: list[dict[str, Any]] = field(default_factory=list)
    saved_sections: list[str] = field(default_factory=list)
    skipped_sections: list[str] = field(default_factory=list)

    def finalize(self) -> StructuredPersistResult:
        if self.saved_sections and self.warnings:
            self.status = "saved_with_warnings"
        elif self.saved_sections:
            self.status = "saved"
        else:
            self.status = "skipped"
        return self


def _table(name: str) -> str:
    return f"{DB_SCHEMA}.{name}"


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text_value = str(value)
    return text_value if text_value else None


def _clean_blank(value: Any) -> str | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None
    stripped = cleaned.strip()
    return stripped or None


def _to_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


def _to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


def _normalize_tire_inventory_status(value: Any) -> str | None:
    cleaned = _clean_blank(value)
    if cleaned is None:
        return None

    normalized = cleaned.upper()
    if normalized not in {member.value for member in TireInventoryStatus}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tire_inventory.status must be ACTIVE or DISCARDED",
        )
    return normalized


def _to_positive_float(value: Any, field_name: str) -> float | None:
    parsed = _to_float(value)
    if parsed is None:
        return None
    if parsed <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must be greater than 0",
        )
    return parsed


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _normalize_confidence(value: Any) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    if numeric < 0:
        return None
    if numeric > 1:
        if numeric <= 100:
            numeric = numeric / 100.0
        else:
            return None
    return round(numeric, 4)


def _slugify(value: str | None) -> str:
    tokens = re.findall(r"[A-Za-z0-9]+", _clean_blank(value) or "")
    if not tokens:
        return "SESSION"
    return "-".join(token.upper() for token in tokens)


def _session_started_at(session_data: dict[str, Any]) -> tuple[datetime, date, time]:
    session_date_raw = _clean_blank(session_data.get("date"))
    session_time_raw = _clean_blank(session_data.get("time"))

    if not session_date_raw or not session_time_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session date and time are required",
        )

    try:
        session_date = date.fromisoformat(session_date_raw)
        session_time = time.fromisoformat(session_time_raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session date or time is invalid",
        ) from exc

    started_at = datetime.combine(session_date, session_time).replace(tzinfo=timezone.utc)
    return started_at, session_date, session_time


def _seance_business_id(
    *,
    track_name: str,
    session_started_at: datetime,
    driver_code: str,
    vehicle_code: str,
    session_type: str,
    session_number: int,
) -> str:
    timestamp_code = session_started_at.strftime("%Y%m%d-%H%M")
    return (
        f"{_slugify(track_name)}-{timestamp_code}-"
        f"{_slugify(session_type)}-{session_number}-"
        f"{_slugify(driver_code)}-{_slugify(vehicle_code)}"
    )


def _driver_aliases(driver: Driver) -> list[str]:
    aliases = [alias for alias in driver.aliases if _clean_blank(alias)]
    return aliases or [driver.driver_name]


def _created_by_value(user: User) -> str:
    return _clean_blank(user.name) or _clean_blank(user.email) or str(user.id)


def _submission_correlation_id(submission: Submission) -> str:
    return _clean_blank(getattr(submission, "correlation_id", None)) or submission.submission_ref


def _has_meaningful_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        return any(_has_meaningful_value(item) for item in value.values())
    if isinstance(value, (list, tuple, set)):
        return any(_has_meaningful_value(item) for item in value)
    return True


def _record_structured_warning(
    result: StructuredPersistResult,
    *,
    section: str,
    code: str,
    message: str,
    field_name: str | None = None,
    value: Any | None = None,
    exception: Exception | None = None,
) -> None:
    warning: dict[str, Any] = {
        "section": section,
        "code": code,
        "message": message,
    }
    if field_name:
        warning["field"] = field_name
    if value not in (None, ""):
        warning["value"] = value
    if exception is not None:
        warning["detail"] = str(exception)
    result.warnings.append(warning)
    logger.warning("Structured ingest warning: %s", warning)


def _parse_int_field(
    value: Any,
    *,
    result: StructuredPersistResult,
    section: str,
    field_name: str,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int | None:
    cleaned = _clean_blank(value)
    if cleaned is None:
        return None
    try:
        numeric = int(cleaned)
    except (TypeError, ValueError):
        _record_structured_warning(
            result,
            section=section,
            code="INVALID_INTEGER",
            message=f"{field_name} must be a whole number to be normalized.",
            field_name=field_name,
            value=cleaned,
        )
        return None
    if minimum is not None and numeric < minimum:
        _record_structured_warning(
            result,
            section=section,
            code="VALUE_TOO_LOW",
            message=f"{field_name} must be at least {minimum} to be normalized.",
            field_name=field_name,
            value=numeric,
        )
        return None
    if maximum is not None and numeric > maximum:
        _record_structured_warning(
            result,
            section=section,
            code="VALUE_TOO_HIGH",
            message=f"{field_name} must be at most {maximum} to be normalized.",
            field_name=field_name,
            value=numeric,
        )
        return None
    return numeric


def _parse_float_field(
    value: Any,
    *,
    result: StructuredPersistResult,
    section: str,
    field_name: str,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float | None:
    cleaned = _clean_blank(value)
    if cleaned is None:
        return None
    try:
        numeric = float(cleaned)
    except (TypeError, ValueError):
        _record_structured_warning(
            result,
            section=section,
            code="INVALID_NUMBER",
            message=f"{field_name} must be numeric to be normalized.",
            field_name=field_name,
            value=cleaned,
        )
        return None
    if minimum is not None and numeric < minimum:
        _record_structured_warning(
            result,
            section=section,
            code="VALUE_TOO_LOW",
            message=f"{field_name} must be at least {minimum} to be normalized.",
            field_name=field_name,
            value=numeric,
        )
        return None
    if maximum is not None and numeric > maximum:
        _record_structured_warning(
            result,
            section=section,
            code="VALUE_TOO_HIGH",
            message=f"{field_name} must be at most {maximum} to be normalized.",
            field_name=field_name,
            value=numeric,
        )
        return None
    return numeric


def _parse_pressure_value(
    value: Any,
    *,
    result: StructuredPersistResult,
    phase: str,
    corner: str,
) -> float | None:
    minimum, maximum = PRESSURE_LIMITS[phase]
    return _parse_float_field(
        value,
        result=result,
        section="pressures",
        field_name=f"{phase}_{corner}",
        minimum=minimum,
        maximum=maximum,
    )


def _safe_upsert_single_row(
    db: Session,
    result: StructuredPersistResult,
    *,
    section: str,
    table_name: str,
    id_column: str,
    columns: list[str],
    values: dict[str, Any],
) -> bool:
    provided_values = [column for column in columns if values.get(column) is not None]
    if not provided_values:
        result.skipped_sections.append(section)
        return False

    nested_transaction = db.begin_nested if hasattr(db, "begin_nested") else None
    try:
        with nested_transaction() if nested_transaction is not None else nullcontext():
            _upsert_single_row(
                db,
                table_name=table_name,
                id_column=id_column,
                columns=columns,
                values=values,
            )
    except Exception as exc:
        _record_structured_warning(
            result,
            section=section,
            code="SECTION_SAVE_FAILED",
            message=f"Failed to save the {section.replace('_', ' ')} section to normalized tables.",
            exception=exc,
        )
        result.skipped_sections.append(section)
        return False

    result.saved_sections.append(section)
    return True


def _update_submission_input_validation(
    db: Session,
    *,
    submission_input_id: int | None,
    id_seance: str,
    result: StructuredPersistResult,
) -> None:
    if submission_input_id is None:
        return

    warning_message = None
    if result.warnings:
        warning_message = "; ".join(warning["message"] for warning in result.warnings)

    db.execute(
        text(
            f"""
            UPDATE {_table("submission_inputs")}
            SET id_seance = :id_seance,
                validation_status = 'APPLIED',
                validation_message = :validation_message
            WHERE submission_id = :submission_id
            """
        ),
        {
            "id_seance": id_seance,
            "submission_id": submission_input_id,
            "validation_message": warning_message,
        },
    )


def _upsert_master_driver(db: Session, driver: Driver) -> None:
    db.execute(
        text(
            f"""
            INSERT INTO {_table("drivers")} (
                id,
                driver_id,
                driver_name,
                aliases,
                first_name,
                last_name,
                license_number,
                team_name,
                notes,
                is_active,
                created_by_id,
                created_at,
                updated_at
            ) VALUES (
                :id,
                :driver_id,
                :driver_name,
                :aliases,
                :first_name,
                :last_name,
                :license_number,
                :team_name,
                :notes,
                TRUE,
                :created_by_id,
                now(),
                now()
            )
            ON CONFLICT (driver_id) DO UPDATE
            SET driver_name = EXCLUDED.driver_name,
                aliases = COALESCE(EXCLUDED.aliases, {_table("drivers")}.aliases),
                first_name = COALESCE(EXCLUDED.first_name, {_table("drivers")}.first_name),
                last_name = COALESCE(EXCLUDED.last_name, {_table("drivers")}.last_name),
                license_number = COALESCE(EXCLUDED.license_number, {_table("drivers")}.license_number),
                team_name = COALESCE(EXCLUDED.team_name, {_table("drivers")}.team_name),
                notes = COALESCE(EXCLUDED.notes, {_table("drivers")}.notes),
                is_active = TRUE,
                updated_at = now()
            """
        ),
        {
            "id": driver.id or uuid.uuid4(),
            "driver_id": driver.driver_id,
            "driver_name": driver.driver_name,
            "aliases": _driver_aliases(driver),
            "first_name": driver.first_name,
            "last_name": driver.last_name,
            "license_number": _clean_blank(driver.license_number),
            "team_name": _clean_blank(driver.team_name),
            "notes": _clean_blank(driver.notes),
            "created_by_id": driver.created_by_id,
        },
    )


def _upsert_master_vehicle(db: Session, vehicle: Vehicle) -> None:
    db.execute(
        text(
            f"""
            INSERT INTO {_table("vehicles")} (
                id,
                driver_id,
                make,
                model,
                year,
                vin,
                registration_number,
                vehicle_id,
                "class",
                notes,
                is_active,
                created_at,
                updated_at
            ) VALUES (
                :id,
                :driver_id,
                :make,
                :model,
                :year,
                :vin,
                :registration_number,
                :vehicle_id,
                :vehicle_class,
                :notes,
                TRUE,
                now(),
                now()
            )
            ON CONFLICT (vehicle_id) DO UPDATE
            SET driver_id = COALESCE(EXCLUDED.driver_id, {_table("vehicles")}.driver_id),
                make = EXCLUDED.make,
                model = EXCLUDED.model,
                year = COALESCE(EXCLUDED.year, {_table("vehicles")}.year),
                vin = COALESCE(EXCLUDED.vin, {_table("vehicles")}.vin),
                registration_number = COALESCE(EXCLUDED.registration_number, {_table("vehicles")}.registration_number),
                "class" = COALESCE(EXCLUDED."class", {_table("vehicles")}."class"),
                notes = COALESCE(EXCLUDED.notes, {_table("vehicles")}.notes),
                is_active = TRUE,
                updated_at = now()
            """
        ),
        {
            "id": vehicle.id or uuid.uuid4(),
            "driver_id": _clean_blank(vehicle.driver_id),
            "make": vehicle.make,
            "model": vehicle.model,
            "year": vehicle.year,
            "vin": _clean_blank(vehicle.vin),
            "registration_number": _clean_blank(vehicle.registration_number),
            "vehicle_id": vehicle.vehicle_id,
            "vehicle_class": _clean_blank(vehicle.vehicle_class),
            "notes": _clean_blank(vehicle.notes),
        },
    )


def _upsert_track(db: Session, track_name: str) -> None:
    db.execute(
        text(
            f"""
            INSERT INTO {_table("tracks")} (name, latitude, longitude, country, active, created_at, updated_at)
            VALUES (:name, NULL, NULL, NULL, TRUE, now(), now())
            ON CONFLICT (name) DO UPDATE
            SET active = TRUE,
                updated_at = now()
            """
        ),
        {"name": track_name},
    )


def _insert_submission_input(
    db: Session,
    *,
    id_seance: str | None,
    submission_type: str,
    source: str,
    raw_text: str | None,
    raw_payload: dict[str, Any],
    confidence: float | None,
    created_by: str,
    validation_status: str = "APPLIED",
    validation_message: str | None = None,
) -> int:
    raw_payload_json = json.dumps(raw_payload, ensure_ascii=False, sort_keys=True, default=str)
    return db.execute(
        text(
            f"""
            INSERT INTO {_table("submission_inputs")} (
                id_seance,
                submission_type,
                source,
                raw_text,
                raw_payload_json,
                confidence,
                created_by,
                created_at,
                validation_status,
                validation_message
            ) VALUES (
                :id_seance,
                :submission_type,
                :source,
                :raw_text,
                CAST(:raw_payload_json AS jsonb),
                :confidence,
                :created_by,
                now(),
                :validation_status,
                :validation_message
            )
            RETURNING submission_id
            """
        ),
        {
            "id_seance": id_seance,
            "submission_type": submission_type,
            "source": source,
            "raw_text": raw_text,
            "raw_payload_json": raw_payload_json,
            "confidence": confidence,
            "created_by": created_by,
            "validation_status": validation_status,
            "validation_message": validation_message,
        },
    ).scalar_one()


def _upsert_single_row(
    db: Session,
    *,
    table_name: str,
    id_column: str,
    columns: list[str],
    values: dict[str, Any],
) -> None:
    insert_columns = [id_column, *columns]
    assignments = ", ".join(
        f"{column} = COALESCE(EXCLUDED.{column}, {_table(table_name)}.{column})" for column in columns
    )
    db.execute(
        text(
            f"""
            INSERT INTO {_table(table_name)} ({", ".join(insert_columns)})
            VALUES ({", ".join(f":{column}" for column in insert_columns)})
            ON CONFLICT ({id_column}) DO UPDATE
            SET {assignments}
            """
        ),
        values,
    )


def _upsert_tire_inventory(db: Session, tire_inventory: dict[str, Any]) -> str | None:
    tire_id = _clean_blank(tire_inventory.get("tire_id"))
    if not tire_id or not re.match(r"^[YMP]-S[0-9]+$", tire_id):
        return None

    db.execute(
        text(
            f"""
            INSERT INTO {_table("tire_inventory")} (
                tire_id,
                manufacturer,
                model,
                size,
                purchase_date,
                heat_cycles,
                track_time_min,
                status,
                created_at,
                updated_at
            ) VALUES (
                :tire_id,
                :manufacturer,
                :model,
                :size,
                :purchase_date,
                :heat_cycles,
                :track_time_min,
                COALESCE(CAST(:status AS {_table("sm2_tire_inventory_status")}), 'ACTIVE'::{_table("sm2_tire_inventory_status")}),
                now(),
                now()
            )
            ON CONFLICT (tire_id) DO UPDATE
            SET manufacturer = COALESCE(EXCLUDED.manufacturer, {_table("tire_inventory")}.manufacturer),
                model = COALESCE(EXCLUDED.model, {_table("tire_inventory")}.model),
                size = COALESCE(EXCLUDED.size, {_table("tire_inventory")}.size),
                purchase_date = COALESCE(EXCLUDED.purchase_date, {_table("tire_inventory")}.purchase_date),
                heat_cycles = COALESCE(EXCLUDED.heat_cycles, {_table("tire_inventory")}.heat_cycles),
                track_time_min = COALESCE(EXCLUDED.track_time_min, {_table("tire_inventory")}.track_time_min),
                status = COALESCE(CAST(:status AS {_table("sm2_tire_inventory_status")}), {_table("tire_inventory")}.status),
                updated_at = now()
            """
        ),
        {
            "tire_id": tire_id,
            "manufacturer": _clean_blank(tire_inventory.get("manufacturer")) or "Unknown",
            "model": _clean_blank(tire_inventory.get("model")),
            "size": _clean_blank(tire_inventory.get("size")),
            "purchase_date": _clean_blank(tire_inventory.get("purchase_date")),
            "heat_cycles": _to_int(tire_inventory.get("heat_cycles")),
            "track_time_min": _to_int(tire_inventory.get("track_time_min")),
            "status": _normalize_tire_inventory_status(tire_inventory.get("status")),
        },
    )
    return tire_id


def _upsert_tire_history(
    db: Session,
    *,
    tire_id: str,
    id_seance: str,
    usage_date: date | None,
    track_name: str,
    duration_min: int | None,
) -> None:
    db.execute(
        text(
            f"""
            INSERT INTO {_table("tire_history")} (
                tire_id,
                id_seance,
                usage_date,
                track,
                duration_min,
                created_at
            ) VALUES (
                :tire_id,
                :id_seance,
                :usage_date,
                :track,
                :duration_min,
                now()
            )
            ON CONFLICT (tire_id, id_seance) DO UPDATE
            SET usage_date = COALESCE(EXCLUDED.usage_date, {_table("tire_history")}.usage_date),
                track = COALESCE(EXCLUDED.track, {_table("tire_history")}.track),
                duration_min = COALESCE(EXCLUDED.duration_min, {_table("tire_history")}.duration_min)
            """
        ),
        {
            "tire_id": tire_id,
            "id_seance": id_seance,
            "usage_date": usage_date,
            "track": track_name,
            "duration_min": duration_min,
        },
    )


def _insert_media_file(
    db: Session,
    *,
    submission_id: int,
    submission_ref: str,
    image_url: str | None,
    uploaded_by: str,
) -> int | None:
    if not image_url:
        return None

    mime_type = None
    if image_url.startswith("data:") and ";" in image_url:
        mime_type = image_url[5 : image_url.index(";")]

    return db.execute(
        text(
            f"""
            INSERT INTO {_table("media_files")} (
                submission_id,
                storage_url,
                mime_type,
                file_name,
                file_size,
                checksum,
                uploaded_by,
                uploaded_at
            ) VALUES (
                :submission_id,
                :storage_url,
                :mime_type,
                :file_name,
                :file_size,
                :checksum,
                :uploaded_by,
                now()
            )
            RETURNING media_id
            """
        ),
        {
            "submission_id": submission_id,
            "storage_url": image_url,
            "mime_type": mime_type,
            "file_name": f"{submission_ref}.img",
            "file_size": None,
            "checksum": None,
            "uploaded_by": uploaded_by,
        },
    ).scalar_one()


def _find_submission_input_id(db: Session, submission_ref: str) -> int | None:
    row = db.execute(
        text(
            f"""
            SELECT submission_id
            FROM {_table("submission_inputs")}
            WHERE raw_payload_json ->> 'submission_ref' = :submission_ref
            ORDER BY submission_id DESC
            LIMIT 1
            """
        ),
        {"submission_ref": submission_ref},
    ).mappings().first()
    if not row:
        return None
    return int(row["submission_id"])


def _media_file_exists(db: Session, submission_input_id: int) -> bool:
    return (
        db.execute(
            text(
                f"""
                SELECT 1
                FROM {_table("media_files")}
                WHERE submission_id = :submission_id
                LIMIT 1
                """
            ),
            {"submission_id": submission_input_id},
        ).first()
        is not None
    )


def _latest_media_file_id(db: Session, submission_input_id: int) -> int | None:
    row = db.execute(
        text(
            f"""
            SELECT media_id
            FROM {_table("media_files")}
            WHERE submission_id = :submission_id
            ORDER BY uploaded_at DESC, media_id DESC
            LIMIT 1
            """
        ),
        {"submission_id": submission_input_id},
    ).mappings().first()
    if not row:
        return None
    return int(row["media_id"])


def _write_audit_log(
    db: Session,
    *,
    action: str,
    status: str,
    message: str | None = None,
    payload: dict[str, Any] | None = None,
    user: str | None = None,
) -> None:
    nested_transaction = db.begin_nested if hasattr(db, "begin_nested") else None
    try:
        with nested_transaction() if nested_transaction is not None else nullcontext():
            db.execute(
                text(
                    f"""
                    INSERT INTO {_table("logs")} (
                        action,
                        status,
                        message,
                        payload,
                        "user",
                        logged_at
                    ) VALUES (
                        :action,
                        :status,
                        :message,
                        CAST(:payload AS jsonb),
                        :user,
                        now()
                    )
                    """
                ),
                {
                    "action": action,
                    "status": status,
                    "message": message,
                    "payload": json.dumps(payload or {}, ensure_ascii=False, sort_keys=True, default=str),
                    "user": user,
                },
            )
    except Exception:
        logger.warning("Structured audit log write skipped for action %s", action, exc_info=True)


def _submission_type_from_payload(payload: dict[str, Any]) -> str:
    session_data = get_session_payload(payload)
    if any(
        key in session_data
        for key in ("suspension", "alignment", "tire_temperatures", "tire_inventory")
    ):
        return "detail"
    return "quick"


def _build_submission_input_metadata(
    *,
    event: Event,
    run_group: RunGroup,
    driver: Driver | None,
    vehicle: Vehicle | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    session_payload = _dict_or_empty(get_session_payload(payload))
    raw_payload = _dict_or_empty(payload)
    context_payload = _dict_or_empty(raw_payload.get("context"))

    def _first_context_value(*field_names: str) -> str | None:
        for field_name in field_names:
            session_value = _clean_blank(session_payload.get(field_name))
            if session_value is not None:
                return session_value

            context_value = _clean_blank(context_payload.get(field_name))
            if context_value is not None:
                return context_value

        return None

    metadata = {
        "event_id": str(event.id),
        "event_name": _clean_blank(getattr(event, "name", None)),
        "run_group_id": str(run_group.id),
        "run_group": _clean_blank(getattr(run_group, "normalized", None))
        or _clean_blank(getattr(run_group, "raw_text", None)),
        "driver_id": _clean_blank(getattr(driver, "driver_id", None)),
        "driver_name": _clean_blank(getattr(driver, "driver_name", None)),
        "vehicle_id": _clean_blank(getattr(vehicle, "vehicle_id", None)),
        "vehicle_text": _clean_blank(getattr(vehicle, "vehicle_id", None)),
        "track": _first_context_value("track") or _clean_blank(getattr(event, "track", None)),
        "session_type": _first_context_value("session_type"),
        "session_number": _first_context_value("session_number"),
        "duration_min": _first_context_value("duration_min"),
        "date": _first_context_value("date"),
        "time": _first_context_value("time"),
        "notes": _clean_blank(context_payload.get("notes") or context_payload.get("note")),
    }

    return {
        key: value
        for key, value in metadata.items()
        if value is not None
    }


def _build_submission_input_snapshot(
    *,
    submission: Submission,
    event: Event,
    run_group: RunGroup,
    driver: Driver | None,
    vehicle: Vehicle | None,
    payload: dict[str, Any],
    source: str,
    submission_type: str,
    current_user: User | None,
) -> dict[str, Any]:
    analysis_result = _dict_or_empty(submission.analysis_result)
    session_payload = get_session_payload(payload)
    metadata = _build_submission_input_metadata(
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        payload=payload,
    )
    normalized_analysis = _dict_or_empty(
        analysis_result.get("image_analysis") or analysis_result.get("imageAnalysis")
    )
    return {
        "submission_ref": submission.submission_ref,
        "correlation_id": _submission_correlation_id(submission),
        "event_id": str(event.id),
        "event_name": event.name,
        "run_group_id": str(run_group.id),
        "run_group_raw_text": run_group.raw_text,
        "driver_id": driver.driver_id if driver is not None else None,
        "vehicle_id": vehicle.vehicle_id if vehicle is not None else None,
        "raw_text": submission.raw_text,
        "image_url": submission.image_url,
        "analysis_result": analysis_result,
        "normalized_analysis": normalized_analysis,
        "metadata": metadata,
        "payload": payload,
        "data": session_payload,
        "source": source,
        "submission_type": submission_type,
        "validation_status": "PENDING",
        "created_by": _created_by_value(current_user) if current_user is not None else "make-webhook",
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }


def stage_submission_input(
    db: Session,
    *,
    submission: Submission,
    event: Event,
    run_group: RunGroup,
    driver: Driver | None,
    vehicle: Vehicle | None,
    current_user: User,
    source: str = "pwa",
) -> int:
    payload = _dict_or_empty(submission.payload)
    submission_type = _submission_type_from_payload(payload)
    snapshot = _build_submission_input_snapshot(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        payload=payload,
        source=source,
        submission_type=submission_type,
        current_user=current_user,
    )
    confidence = _normalize_confidence(snapshot["analysis_result"].get("confidence"))
    submission_input_id = _insert_submission_input(
        db,
        id_seance=None,
        submission_type=submission_type,
        source=source,
        raw_text=submission.raw_text,
        raw_payload=snapshot,
        confidence=confidence,
        created_by=snapshot["created_by"],
        validation_status="PENDING",
        validation_message=None,
    )

    if submission.image_url:
        _insert_media_file(
            db,
            submission_id=submission_input_id,
            submission_ref=submission.submission_ref,
            image_url=submission.image_url,
            uploaded_by=snapshot["created_by"],
        )

    _write_audit_log(
        db,
        action="submission.stage.raw",
        status="SUCCESS",
        message=f"Staged raw submission {submission.submission_ref}",
        payload={
            "submission_ref": submission.submission_ref,
            "correlation_id": _submission_correlation_id(submission),
            "submission_input_id": submission_input_id,
            "source": source,
            "submission_type": submission_type,
        },
        user=snapshot["created_by"],
    )

    return submission_input_id


def _insert_ocr_result(
    db: Session,
    *,
    submission_input_id: int,
    raw_ocr_text: str | None = None,
    cleaned_ocr_text: str | None = None,
    extracted_json: dict[str, Any] | None = None,
    ocr_confidence: float | None = None,
    parser_version: str | None = None,
    review_status: str | None = None,
) -> int | None:
    if not any(
        value not in (None, "", {})
        for value in (
            raw_ocr_text,
            cleaned_ocr_text,
            extracted_json,
            ocr_confidence,
            parser_version,
            review_status,
        )
    ):
        return None

    media_id = _latest_media_file_id(db, submission_input_id)
    normalized_review_status = (review_status or "PENDING").strip().upper()
    if normalized_review_status not in {"PENDING", "APPROVED", "REJECTED", "CORRECTED"}:
        normalized_review_status = "PENDING"

    return db.execute(
        text(
            f"""
            INSERT INTO {_table("ocr_results")} (
                submission_id,
                media_id,
                raw_ocr_text,
                cleaned_ocr_text,
                extracted_json,
                ocr_confidence,
                parser_version,
                review_status,
                created_at
            ) VALUES (
                :submission_id,
                :media_id,
                :raw_ocr_text,
                :cleaned_ocr_text,
                CAST(:extracted_json AS jsonb),
                :ocr_confidence,
                :parser_version,
                :review_status,
                now()
            )
            RETURNING ocr_id
            """
        ),
        {
            "submission_id": submission_input_id,
            "media_id": media_id,
            "raw_ocr_text": raw_ocr_text,
            "cleaned_ocr_text": cleaned_ocr_text,
            "extracted_json": json.dumps(extracted_json or {}, ensure_ascii=False, sort_keys=True, default=str),
            "ocr_confidence": ocr_confidence,
            "parser_version": parser_version,
            "review_status": normalized_review_status,
        },
    ).scalar_one()


def record_image_analysis_result(
    db: Session,
    *,
    submission_input_id: int | None,
    image_analysis: dict[str, Any] | None,
) -> int | None:
    if submission_input_id is None or not image_analysis:
        return None

    return _insert_ocr_result(
        db,
        submission_input_id=submission_input_id,
        raw_ocr_text=_clean_blank(image_analysis.get("extracted_text")),
        cleaned_ocr_text=_clean_blank(image_analysis.get("extracted_text")),
        extracted_json=image_analysis,
        ocr_confidence=_normalize_confidence(image_analysis.get("confidence")),
        parser_version=_clean_blank(image_analysis.get("parser_version")),
        review_status=_clean_blank(image_analysis.get("recommended_review_status")) or "PENDING",
    )


def persist_structured_submission(
    db: Session,
    *,
    submission: Submission,
    event: Event,
    run_group: RunGroup,
    driver: Driver | None,
    vehicle: Vehicle | None,
    current_user: User | None,
) -> StructuredPersistResult:
    result = StructuredPersistResult()
    payload = _dict_or_empty(submission.payload)
    session_data = get_session_payload(payload)
    analysis_result = _dict_or_empty(submission.analysis_result)

    if not session_data:
        return result.finalize()

    if driver is None or vehicle is None:
        _record_structured_warning(
            result,
            section="session",
            code="MISSING_RELATIONS",
            message="Structured normalization was skipped because driver or vehicle data is missing.",
        )
        return result.finalize()

    track_name = _clean_blank(session_data.get("track")) or event.track
    if not track_name:
        _record_structured_warning(
            result,
            section="session",
            code="MISSING_TRACK",
            message="Structured normalization was skipped because the track is missing.",
        )
        return result.finalize()

    try:
        _upsert_master_driver(db, driver)
        _upsert_master_vehicle(db, vehicle)
        _upsert_track(db, track_name)
    except Exception as exc:  # pragma: no cover - live DB guard
        _record_structured_warning(
            result,
            section="session",
            code="MASTER_DATA_SAVE_FAILED",
            message="Structured normalization could not prepare the linked driver, vehicle, or track records.",
            exception=exc,
        )
        return result.finalize()

    try:
        started_at, session_date, session_time = _session_started_at(session_data)
    except HTTPException as exc:
        _record_structured_warning(
            result,
            section="session",
            code="INVALID_SESSION_TIMESTAMP",
            message=str(exc.detail),
        )
        return result.finalize()
    session_type = _clean_blank(session_data.get("session_type")) or "Practice"
    session_number = _parse_int_field(
        session_data.get("session_number"),
        result=result,
        section="session",
        field_name="session_number",
        minimum=1,
    )
    if session_number is None:
        _record_structured_warning(
            result,
            section="session",
            code="MISSING_SESSION_NUMBER",
            message="Structured normalization was skipped because the session number is missing or invalid.",
        )
        return result.finalize()

    tire_inventory = _dict_or_empty(session_data.get("tire_inventory"))
    tire_set = _clean_blank(session_data.get("tire_set")) or _clean_blank(tire_inventory.get("tire_id"))
    duration_min = _parse_int_field(
        session_data.get("duration_min"),
        result=result,
        section="session",
        field_name="duration_min",
        minimum=0,
    )
    raw_text = submission.raw_text
    created_by = _created_by_value(current_user) if current_user is not None else "make-webhook"
    provided_session_id = _clean_blank(session_data.get("session_id"))
    if provided_session_id is not None:
        provided_session_id = provided_session_id.upper()
        if not SESSION_ID_PATTERN.fullmatch(provided_session_id):
            _record_structured_warning(
                result,
                section="session",
                code="INVALID_SESSION_ID",
                message="session_id did not match the normalized session format, so a generated normalized session id was used instead.",
                field_name="session_id",
                value=provided_session_id,
            )
            provided_session_id = None

    id_seance = provided_session_id or _seance_business_id(
        track_name=track_name,
        session_started_at=started_at,
        driver_code=driver.driver_id,
        vehicle_code=vehicle.vehicle_id,
        session_type=session_type,
        session_number=session_number,
    )

    submission_type = "detail" if any(
        key in session_data for key in ("suspension", "alignment", "tire_temperatures", "tire_inventory")
    ) else "quick"
    confidence = _normalize_confidence(analysis_result.get("confidence"))

    raw_payload_snapshot = {
        "submission_ref": submission.submission_ref,
        "correlation_id": _submission_correlation_id(submission),
        "event_id": str(event.id),
        "event_name": event.name,
        "run_group_id": str(run_group.id),
        "run_group_raw_text": run_group.raw_text,
        "driver_id": driver.driver_id,
        "vehicle_id": vehicle.vehicle_id,
        "analysis_result": analysis_result,
        "raw_text": raw_text,
        "image_url": submission.image_url,
        "data": session_data,
    }
    submission_input_id = _find_submission_input_id(db, submission.submission_ref)
    result.submission_input_id = submission_input_id

    try:
        id_seance = db.execute(
            text(
                f"""
                INSERT INTO {_table("seances")} (
                    id_seance,
                    session_date,
                    session_time,
                    track,
                    driver_id,
                    vehicle_id,
                    session_type,
                    session_number,
                    duration_min,
                    tire_set,
                    notes,
                    created_by,
                    created_at
                ) VALUES (
                    :id_seance,
                    :session_date,
                    :session_time,
                    :track,
                    :driver_id,
                    :vehicle_id,
                    :session_type,
                    :session_number,
                    :duration_min,
                    :tire_set,
                    :notes,
                    :created_by,
                    now()
                )
                ON CONFLICT ON CONSTRAINT uq_session_identity DO UPDATE
                SET session_date = EXCLUDED.session_date,
                    session_time = COALESCE(EXCLUDED.session_time, {_table("seances")}.session_time),
                    track = EXCLUDED.track,
                    driver_id = EXCLUDED.driver_id,
                    vehicle_id = EXCLUDED.vehicle_id,
                    session_type = COALESCE(EXCLUDED.session_type, {_table("seances")}.session_type),
                    session_number = EXCLUDED.session_number,
                    duration_min = COALESCE(EXCLUDED.duration_min, {_table("seances")}.duration_min),
                    tire_set = COALESCE(EXCLUDED.tire_set, {_table("seances")}.tire_set),
                    notes = COALESCE(EXCLUDED.notes, {_table("seances")}.notes),
                    created_by = EXCLUDED.created_by
                RETURNING id_seance
                """
            ),
            {
                "id_seance": id_seance,
                "session_date": session_date,
                "session_time": session_time,
                "track": track_name,
                "driver_id": driver.driver_id,
                "vehicle_id": vehicle.vehicle_id,
                "session_type": session_type,
                "session_number": session_number,
                "duration_min": duration_min,
                "tire_set": tire_set,
                "notes": raw_text,
                "created_by": created_by,
            },
        ).scalar_one()
        result.saved_sections.append("seances")
    except Exception as exc:  # pragma: no cover - live DB guard
        _record_structured_warning(
            result,
            section="seances",
            code="SEANCE_SAVE_FAILED",
            message="Structured normalization could not save the session row.",
            exception=exc,
        )
        return result.finalize()

    if submission_input_id is None:
        try:
            result.submission_input_id = _insert_submission_input(
                db,
                id_seance=id_seance,
                submission_type=submission_type,
                source="pwa",
                raw_text=raw_text,
                raw_payload=raw_payload_snapshot,
                confidence=confidence,
                created_by=created_by,
                validation_status="APPLIED",
                validation_message=None,
            )
        except Exception as exc:  # pragma: no cover - live DB guard
            _record_structured_warning(
                result,
                section="submission_inputs",
                code="SUBMISSION_INPUT_SAVE_FAILED",
                message="Structured normalization saved the session but could not stage the normalized input snapshot.",
                exception=exc,
            )
    else:
        _update_submission_input_validation(
            db,
            submission_input_id=submission_input_id,
            id_seance=id_seance,
            result=result,
        )

    pressures = _dict_or_empty(session_data.get("pressures"))
    if pressures:
        pressure_columns = [
            "cold_fl",
            "cold_fr",
            "cold_rl",
            "cold_rr",
            "hot_fl",
            "hot_fr",
            "hot_rl",
            "hot_rr",
        ]
        pressure_values = {
            "id_seance": id_seance,
            **{
                column: _parse_pressure_value(
                    pressures.get(column),
                    result=result,
                    phase="cold" if column.startswith("cold_") else "hot",
                    corner=column.split("_", 1)[1],
                )
                for column in pressure_columns
            },
        }
        _safe_upsert_single_row(
            db,
            result,
            section="pressures",
            table_name="pressures",
            id_column="id_seance",
            columns=pressure_columns,
            values=pressure_values,
        )

    suspension = _dict_or_empty(session_data.get("suspension"))
    if suspension:
        suspension_columns = [
            "rebound_fl",
            "rebound_fr",
            "rebound_rl",
            "rebound_rr",
            "bump_fl",
            "bump_fr",
            "bump_rl",
            "bump_rr",
            "sway_bar_f",
            "sway_bar_r",
            "wing_angle_deg",
        ]
        suspension_values = {
            "id_seance": id_seance,
            "rebound_fl": _parse_int_field(
                suspension.get("rebound_fl"),
                result=result,
                section="suspension",
                field_name="rebound_fl",
                minimum=0,
            ),
            "rebound_fr": _parse_int_field(
                suspension.get("rebound_fr"),
                result=result,
                section="suspension",
                field_name="rebound_fr",
                minimum=0,
            ),
            "rebound_rl": _parse_int_field(
                suspension.get("rebound_rl"),
                result=result,
                section="suspension",
                field_name="rebound_rl",
                minimum=0,
            ),
            "rebound_rr": _parse_int_field(
                suspension.get("rebound_rr"),
                result=result,
                section="suspension",
                field_name="rebound_rr",
                minimum=0,
            ),
            "bump_fl": _parse_int_field(
                suspension.get("bump_fl"),
                result=result,
                section="suspension",
                field_name="bump_fl",
                minimum=0,
            ),
            "bump_fr": _parse_int_field(
                suspension.get("bump_fr"),
                result=result,
                section="suspension",
                field_name="bump_fr",
                minimum=0,
            ),
            "bump_rl": _parse_int_field(
                suspension.get("bump_rl"),
                result=result,
                section="suspension",
                field_name="bump_rl",
                minimum=0,
            ),
            "bump_rr": _parse_int_field(
                suspension.get("bump_rr"),
                result=result,
                section="suspension",
                field_name="bump_rr",
                minimum=0,
            ),
            "sway_bar_f": _clean_blank(suspension.get("sway_bar_f")),
            "sway_bar_r": _clean_blank(suspension.get("sway_bar_r")),
            "wing_angle_deg": _parse_float_field(
                suspension.get("wing_angle_deg"),
                result=result,
                section="suspension",
                field_name="wing_angle_deg",
            ),
        }
        _safe_upsert_single_row(
            db,
            result,
            section="suspension",
            table_name="suspensions",
            id_column="id_seance",
            columns=suspension_columns,
            values=suspension_values,
        )

    alignment = _dict_or_empty(session_data.get("alignment"))
    if alignment:
        alignment_columns = [
            "camber_fl",
            "camber_fr",
            "camber_rl",
            "camber_rr",
            "toe_front",
            "toe_rear",
            "caster_l",
            "caster_r",
            "ride_height_f",
            "ride_height_r",
            "corner_weight_fl",
            "corner_weight_fr",
            "corner_weight_rl",
            "corner_weight_rr",
            "cross_weight_pct",
            "rake_mm",
            "wheelbase_mm",
        ]
        alignment_values = {
            "id_seance": id_seance,
            "camber_fl": _parse_float_field(
                alignment.get("camber_fl"),
                result=result,
                section="alignment",
                field_name="camber_fl",
            ),
            "camber_fr": _parse_float_field(
                alignment.get("camber_fr"),
                result=result,
                section="alignment",
                field_name="camber_fr",
            ),
            "camber_rl": _parse_float_field(
                alignment.get("camber_rl"),
                result=result,
                section="alignment",
                field_name="camber_rl",
            ),
            "camber_rr": _parse_float_field(
                alignment.get("camber_rr"),
                result=result,
                section="alignment",
                field_name="camber_rr",
            ),
            "toe_front": _clean_blank(alignment.get("toe_front")),
            "toe_rear": _clean_blank(alignment.get("toe_rear")),
            "caster_l": _parse_float_field(
                alignment.get("caster_l"),
                result=result,
                section="alignment",
                field_name="caster_l",
            ),
            "caster_r": _parse_float_field(
                alignment.get("caster_r"),
                result=result,
                section="alignment",
                field_name="caster_r",
            ),
            "ride_height_f": _parse_float_field(
                alignment.get("ride_height_f"),
                result=result,
                section="alignment",
                field_name="ride_height_f",
            ),
            "ride_height_r": _parse_float_field(
                alignment.get("ride_height_r"),
                result=result,
                section="alignment",
                field_name="ride_height_r",
            ),
            "corner_weight_fl": _parse_float_field(
                alignment.get("corner_weight_fl"),
                result=result,
                section="alignment",
                field_name="corner_weight_fl",
            ),
            "corner_weight_fr": _parse_float_field(
                alignment.get("corner_weight_fr"),
                result=result,
                section="alignment",
                field_name="corner_weight_fr",
            ),
            "corner_weight_rl": _parse_float_field(
                alignment.get("corner_weight_rl"),
                result=result,
                section="alignment",
                field_name="corner_weight_rl",
            ),
            "corner_weight_rr": _parse_float_field(
                alignment.get("corner_weight_rr"),
                result=result,
                section="alignment",
                field_name="corner_weight_rr",
            ),
            "cross_weight_pct": _parse_float_field(
                alignment.get("cross_weight_pct"),
                result=result,
                section="alignment",
                field_name="cross_weight_pct",
            ),
            "rake_mm": _parse_float_field(
                alignment.get("rake_mm"),
                result=result,
                section="alignment",
                field_name="rake_mm",
            ),
            "wheelbase_mm": _parse_float_field(
                alignment.get("wheelbase_mm"),
                result=result,
                section="alignment",
                field_name="wheelbase_mm",
                minimum=0,
            ),
        }
        _safe_upsert_single_row(
            db,
            result,
            section="alignment",
            table_name="alignment",
            id_column="id_seance",
            columns=alignment_columns,
            values=alignment_values,
        )

    tire_temperatures = _dict_or_empty(session_data.get("tire_temperatures"))
    if tire_temperatures:
        tire_temperature_columns = [
            "fl_in",
            "fl_mid",
            "fl_out",
            "fr_in",
            "fr_mid",
            "fr_out",
            "rl_in",
            "rl_mid",
            "rl_out",
            "rr_in",
            "rr_mid",
            "rr_out",
            "photo_url",
        ]
        tire_temperature_values = {
            "id_seance": id_seance,
            "fl_in": _parse_float_field(
                tire_temperatures.get("fl_in"),
                result=result,
                section="tire_temperatures",
                field_name="fl_in",
            ),
            "fl_mid": _parse_float_field(
                tire_temperatures.get("fl_mid"),
                result=result,
                section="tire_temperatures",
                field_name="fl_mid",
            ),
            "fl_out": _parse_float_field(
                tire_temperatures.get("fl_out"),
                result=result,
                section="tire_temperatures",
                field_name="fl_out",
            ),
            "fr_in": _parse_float_field(
                tire_temperatures.get("fr_in"),
                result=result,
                section="tire_temperatures",
                field_name="fr_in",
            ),
            "fr_mid": _parse_float_field(
                tire_temperatures.get("fr_mid"),
                result=result,
                section="tire_temperatures",
                field_name="fr_mid",
            ),
            "fr_out": _parse_float_field(
                tire_temperatures.get("fr_out"),
                result=result,
                section="tire_temperatures",
                field_name="fr_out",
            ),
            "rl_in": _parse_float_field(
                tire_temperatures.get("rl_in"),
                result=result,
                section="tire_temperatures",
                field_name="rl_in",
            ),
            "rl_mid": _parse_float_field(
                tire_temperatures.get("rl_mid"),
                result=result,
                section="tire_temperatures",
                field_name="rl_mid",
            ),
            "rl_out": _parse_float_field(
                tire_temperatures.get("rl_out"),
                result=result,
                section="tire_temperatures",
                field_name="rl_out",
            ),
            "rr_in": _parse_float_field(
                tire_temperatures.get("rr_in"),
                result=result,
                section="tire_temperatures",
                field_name="rr_in",
            ),
            "rr_mid": _parse_float_field(
                tire_temperatures.get("rr_mid"),
                result=result,
                section="tire_temperatures",
                field_name="rr_mid",
            ),
            "rr_out": _parse_float_field(
                tire_temperatures.get("rr_out"),
                result=result,
                section="tire_temperatures",
                field_name="rr_out",
            ),
            "photo_url": _clean_blank(submission.image_url),
        }
        _safe_upsert_single_row(
            db,
            result,
            section="tire_temperatures",
            table_name="tire_temperatures",
            id_column="id_seance",
            columns=tire_temperature_columns,
            values=tire_temperature_values,
        )

    tire_id = None
    if tire_set or tire_inventory:
        tire_inventory_payload = dict(tire_inventory)
        if tire_set and not tire_inventory_payload.get("tire_id"):
            tire_inventory_payload["tire_id"] = tire_set
        if tire_set and not tire_inventory_payload.get("manufacturer"):
            tire_inventory_payload["manufacturer"] = "Unknown"
        tire_inventory_payload["heat_cycles"] = _parse_int_field(
            tire_inventory_payload.get("heat_cycles"),
            result=result,
            section="tire_inventory",
            field_name="heat_cycles",
            minimum=0,
        )
        tire_inventory_payload["track_time_min"] = _parse_int_field(
            tire_inventory_payload.get("track_time_min"),
            result=result,
            section="tire_inventory",
            field_name="track_time_min",
            minimum=0,
        )
        try:
            nested_transaction = db.begin_nested if hasattr(db, "begin_nested") else None
            with nested_transaction() if nested_transaction is not None else nullcontext():
                tire_id = _upsert_tire_inventory(db, tire_inventory_payload)
                if tire_id:
                    result.saved_sections.append("tire_inventory")
                elif _has_meaningful_value(tire_inventory_payload):
                    result.skipped_sections.append("tire_inventory")
                    _record_structured_warning(
                        result,
                        section="tire_inventory",
                        code="INVALID_TIRE_ID",
                        message="Tire inventory could not be normalized because the tire ID format is invalid.",
                        field_name="tire_id",
                        value=tire_inventory_payload.get("tire_id") or tire_set,
                    )
        except Exception as exc:  # pragma: no cover - live DB guard
            _record_structured_warning(
                result,
                section="tire_inventory",
                code="SECTION_SAVE_FAILED",
                message="Failed to save the tire inventory section to normalized tables.",
                exception=exc,
            )
            result.skipped_sections.append("tire_inventory")

    if tire_id:
        try:
            nested_transaction = db.begin_nested if hasattr(db, "begin_nested") else None
            with nested_transaction() if nested_transaction is not None else nullcontext():
                _upsert_tire_history(
                    db,
                    tire_id=tire_id,
                    id_seance=id_seance,
                    usage_date=session_date,
                    track_name=track_name,
                    duration_min=duration_min,
                )
            result.saved_sections.append("tire_history")
        except Exception as exc:  # pragma: no cover - live DB guard
            _record_structured_warning(
                result,
                section="tire_history",
                code="SECTION_SAVE_FAILED",
                message="Failed to save tire history for this session.",
                exception=exc,
            )
            result.skipped_sections.append("tire_history")

    _update_submission_input_validation(
        db,
        submission_input_id=result.submission_input_id,
        id_seance=id_seance,
        result=result,
    )

    if submission.image_url and result.submission_input_id is not None and not _media_file_exists(db, result.submission_input_id):
        try:
            _insert_media_file(
                db,
                submission_id=result.submission_input_id,
                submission_ref=submission.submission_ref,
                image_url=submission.image_url,
                uploaded_by=created_by,
            )
        except Exception as exc:  # pragma: no cover - live DB guard
            _record_structured_warning(
                result,
                section="media_files",
                code="SECTION_SAVE_FAILED",
                message="Structured normalization saved the note, but the linked media row could not be refreshed.",
                exception=exc,
            )

    finalized = result.finalize()
    _write_audit_log(
        db,
        action="submission.apply.structured",
        status="WARNING" if finalized.warnings else "SUCCESS",
        message=f"Structured submission applied for {submission.submission_ref}",
        payload={
            "submission_ref": submission.submission_ref,
            "correlation_id": _submission_correlation_id(submission),
            "submission_input_id": finalized.submission_input_id,
            "id_seance": id_seance,
            "structured_status": finalized.status,
            "structured_warnings": finalized.warnings,
        },
        user=created_by,
    )

    return finalized
