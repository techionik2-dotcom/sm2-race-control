from __future__ import annotations

import hashlib
import json
import logging
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db_schema import SM2RACING_SCHEMA
from app.models.driver import Driver
from app.models.event import Event
from app.models.run_group import RunGroup
from app.models.submission import Submission
from app.models.user import User
from app.models.vehicle import Vehicle
from app.services.raw_submission_service import RawSubmissionValidationError

logger = logging.getLogger(__name__)


def _table(name: str) -> str:
    return f"{SM2RACING_SCHEMA}.{name}"


def _table_columns(db: Session, table_name: str) -> set[str]:
    rows = db.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = :schema
              AND table_name = :table_name
            """
        ),
        {"schema": SM2RACING_SCHEMA, "table_name": table_name},
    ).mappings().all()
    return {str(row["column_name"]).lower() for row in rows}


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text_value = " ".join(str(value).split()).strip()
    return text_value or None


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _to_uuid(value: Any) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _parse_float(value: Any, *, field_name: str) -> float | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None
    try:
        return float(cleaned)
    except (TypeError, ValueError) as exc:
        raise RawSubmissionValidationError(
            f"{field_name} must be numeric",
            errors=[{"field": field_name, "message": f"{field_name} must be numeric"}],
        ) from exc


def _parse_int(value: Any, *, field_name: str) -> int | None:
    numeric = _parse_float(value, field_name=field_name)
    if numeric is None:
        return None
    if not numeric.is_integer():
        raise RawSubmissionValidationError(
            f"{field_name} must be numeric",
            errors=[{"field": field_name, "message": f"{field_name} must be numeric"}],
        )
    return int(numeric)


def _parse_corner_text(value: Any, *, field_name: str) -> tuple[float, float]:
    cleaned = _clean_text(value)
    if cleaned is None:
        raise RawSubmissionValidationError(
            f"{field_name} is required",
            errors=[{"field": field_name, "message": f"{field_name} is required"}],
        )

    parts = [segment.strip() for segment in cleaned.split("/") if segment.strip()]
    if len(parts) == 1:
        parsed = _parse_float(parts[0], field_name=field_name)
        if parsed is None:
            raise RawSubmissionValidationError(
                f"{field_name} is required",
                errors=[{"field": field_name, "message": f"{field_name} is required"}],
            )
        return parsed, parsed
    if len(parts) == 2:
        left = _parse_float(parts[0], field_name=field_name)
        right = _parse_float(parts[1], field_name=field_name)
        if left is None or right is None:
            raise RawSubmissionValidationError(
                f"{field_name} is required",
                errors=[{"field": field_name, "message": f"{field_name} is required"}],
            )
        return left, right
    if len(parts) == 4:
        front_left = _parse_float(parts[0], field_name=field_name)
        front_right = _parse_float(parts[1], field_name=field_name)
        rear_left = _parse_float(parts[2], field_name=field_name)
        rear_right = _parse_float(parts[3], field_name=field_name)
        if front_left is None or front_right is None or rear_left is None or rear_right is None:
            raise RawSubmissionValidationError(
                f"{field_name} is required",
                errors=[{"field": field_name, "message": f"{field_name} is required"}],
            )
        if front_left != front_right or rear_left != rear_right:
            raise RawSubmissionValidationError(
                f"{field_name} must use matching axle pairs when 4 values are provided",
                errors=[
                    {
                        "field": field_name,
                        "message": f"{field_name} must use matching axle pairs when 4 values are provided",
                    }
                ],
            )
        return front_left, rear_left

    raise RawSubmissionValidationError(
        f"{field_name} must provide 1, 2, or 4 values",
        errors=[{"field": field_name, "message": f"{field_name} must provide 1, 2, or 4 values"}],
    )


def _parse_sway_bar_value(value: Any, *, field_name: str) -> int | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None

    parts = [segment.strip() for segment in cleaned.split("/") if segment.strip()]
    if len(parts) == 1:
        return _parse_int(parts[0], field_name=field_name)
    if len(parts) == 2:
        left = _parse_int(parts[0], field_name=field_name)
        right = _parse_int(parts[1], field_name=field_name)
        if left != right:
            raise RawSubmissionValidationError(
                f"{field_name} must use matching axle pairs when 2 values are provided",
                errors=[
                    {
                        "field": field_name,
                        "message": f"{field_name} must use matching axle pairs when 2 values are provided",
                    }
                ],
            )
        return left
    if len(parts) == 4:
        front_left = _parse_int(parts[0], field_name=field_name)
        front_right = _parse_int(parts[1], field_name=field_name)
        rear_left = _parse_int(parts[2], field_name=field_name)
        rear_right = _parse_int(parts[3], field_name=field_name)
        if front_left != front_right or rear_left != rear_right:
            raise RawSubmissionValidationError(
                f"{field_name} must use matching axle pairs when 4 values are provided",
                errors=[
                    {
                        "field": field_name,
                        "message": f"{field_name} must use matching axle pairs when 4 values are provided",
                    }
                ],
            )
        return front_left

    raise RawSubmissionValidationError(
        f"{field_name} must provide 1, 2, or 4 values",
        errors=[{"field": field_name, "message": f"{field_name} must provide 1, 2, or 4 values"}],
    )


def _submission_type_from_session(session_data: dict[str, Any]) -> str:
    if any(
        key in session_data
        for key in ("suspension", "alignment", "tire_temperatures", "tire_inventory")
    ):
        return "detail"
    return "quick"


def _raw_payload_hash(*, raw_text: str, payload: dict[str, Any]) -> str:
    hasher = hashlib.sha256()
    hasher.update(_json_text({"raw_text": raw_text, "payload": payload}).encode("utf-8"))
    return hasher.hexdigest()


def _raw_storage_mode(db: Session) -> str:
    seance_columns = _table_columns(db, "seances")
    track_columns = _table_columns(db, "tracks")

    has_current_seance_columns = {
        "track_id",
        "vehicle_assignment_id",
        "session_started_at",
        "created_by_user_id",
    }.issubset(seance_columns)
    has_current_track_columns = any(column in track_columns for column in ("track_id", "id")) and any(
        column in track_columns for column in ("track_name", "name")
    )
    if has_current_seance_columns and has_current_track_columns:
        return "current"

    has_legacy_seance_columns = {
        "track",
        "driver_id",
        "vehicle_id",
        "session_date",
        "session_time",
        "session_number",
        "created_by",
    }.issubset(seance_columns)
    has_legacy_track_columns = "name" in track_columns
    if has_legacy_seance_columns and has_legacy_track_columns:
        return "legacy"

    raise RawSubmissionValidationError(
        "raw submission storage schema is not compatible with this database",
        errors=[
            {
                "field": "raw_text",
                "message": "raw submission storage schema is not compatible with this database",
            }
        ],
    )


def _resolve_track_id(db: Session, track_name: str) -> UUID:
    columns = _table_columns(db, "tracks")
    identifier_column = next((column for column in ("track_id", "id") if column in columns), None)
    name_column = next((column for column in ("track_name", "name") if column in columns), None)

    if identifier_column is None or name_column is None:
        raise RawSubmissionValidationError(
            "tracks table is missing the columns required for raw note persistence",
            errors=[
                {
                    "field": "track",
                    "message": "tracks table is missing the columns required for raw note persistence",
                }
            ],
        )

    row = db.execute(
        text(
            f"""
            SELECT {identifier_column} AS track_id
            FROM {_table("tracks")}
            WHERE lower({name_column}) = lower(:track_name)
              AND status = 'ACTIVE'
              AND archived_at IS NULL
            LIMIT 1
            """
        ),
        {"track_name": track_name},
    ).mappings().first()
    if row is None:
        raise RawSubmissionValidationError(
            f"track '{track_name}' was not found",
            errors=[{"field": "track", "message": f"track '{track_name}' was not found"}],
        )
    return UUID(str(row["track_id"]))


def _resolve_vehicle_assignment_id(
    db: Session,
    *,
    vehicle_id: str,
    driver_id: str,
    started_at: datetime,
) -> UUID:
    row = db.execute(
        text(
            f"""
            SELECT vehicle_assignment_id
            FROM {_table("vehicle_assignments")}
            WHERE vehicle_id = :vehicle_id
              AND driver_id = :driver_id
              AND status = 'ACTIVE'
              AND archived_at IS NULL
              AND effective_from <= :started_at
              AND (effective_to IS NULL OR effective_to > :started_at)
            ORDER BY effective_from DESC
            LIMIT 1
            """
        ),
        {
            "vehicle_id": vehicle_id,
            "driver_id": driver_id,
            "started_at": started_at,
        },
    ).mappings().first()
    if row is None:
        raise RawSubmissionValidationError(
            "vehicle_id does not belong to driver_id",
            errors=[{"field": "vehicle_id", "message": "vehicle_id does not belong to driver_id"}],
        )
    return UUID(str(row["vehicle_assignment_id"]))


def lookup_raw_duplicate_current_schema(
    db: Session,
    *,
    id_seance: str,
    raw_text: str,
) -> str | None:
    row = db.execute(
        text(
            f"""
            SELECT id_seance
            FROM {_table("seances")}
            WHERE id_seance = :id_seance
              AND notes = :raw_text
            LIMIT 1
            """
        ),
        {
            "id_seance": id_seance,
            "raw_text": raw_text,
        },
    ).mappings().first()
    if row is None:
        return None
    return str(row["id_seance"])


def write_raw_audit_log_current_schema(
    db: Session,
    *,
    action: str,
    status: str,
    entity_type: str,
    entity_id: str,
    message: str | None = None,
    payload: dict[str, Any] | None = None,
    actor_user_id: UUID | None = None,
    correlation_id: UUID | str | None = None,
) -> None:
    try:
        nested_transaction = db.begin_nested if hasattr(db, "begin_nested") else None
        with nested_transaction() if nested_transaction is not None else nullcontext():
            db.execute(
                text(
                    f"""
                    INSERT INTO {_table("logs")} (
                        action,
                        status,
                        actor_user_id,
                        entity_type,
                        entity_id,
                        message,
                        payload,
                        correlation_id
                    ) VALUES (
                        :action,
                        CAST(:status AS {_table("sm2_log_status")}),
                        :actor_user_id,
                        :entity_type,
                        :entity_id,
                        :message,
                        CAST(:payload AS jsonb),
                        :correlation_id
                    )
                    """
                ),
                {
                    "action": action,
                    "status": status,
                    "actor_user_id": actor_user_id,
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "message": message,
                    "payload": _json_text(payload or {}),
                    "correlation_id": _to_uuid(correlation_id),
                },
            )
    except Exception:
        logger.warning("Raw current-schema audit log write skipped for action %s", action, exc_info=True)


def _upsert_session_row(
    db: Session,
    *,
    id_seance: str,
    track_id: UUID,
    vehicle_assignment_id: UUID,
    started_at: datetime,
    session_date: date,
    session_type: str,
    session_number: int,
    duration_min: int | None,
    tire_set: str | None,
    raw_text: str,
    created_by_user_id: UUID,
) -> UUID:
    return UUID(
        str(
            db.execute(
                text(
                    f"""
                    INSERT INTO {_table("seances")} (
                        id_seance,
                        vehicle_assignment_id,
                        track_id,
                        session_started_at,
                        session_date,
                        session_ended_at,
                        session_type,
                        session_number,
                        tire_set,
                        duration_min,
                        notes,
                        source_submission_id,
                        created_by_user_id,
                        status,
                        created_at,
                        updated_at
                    ) VALUES (
                        :id_seance,
                        :vehicle_assignment_id,
                        :track_id,
                        :session_started_at,
                        :session_date,
                        NULL,
                        :session_type,
                        :session_number,
                        :tire_set,
                        :duration_min,
                        :notes,
                        NULL,
                        :created_by_user_id,
                        CAST(:status AS {_table("sm2_session_status")}),
                        now(),
                        now()
                    )
                    ON CONFLICT ON CONSTRAINT uq_seances_business_id DO UPDATE
                    SET vehicle_assignment_id = EXCLUDED.vehicle_assignment_id,
                        track_id = EXCLUDED.track_id,
                        session_started_at = EXCLUDED.session_started_at,
                        session_date = EXCLUDED.session_date,
                        session_ended_at = COALESCE(EXCLUDED.session_ended_at, {_table("seances")}.session_ended_at),
                        session_type = EXCLUDED.session_type,
                        session_number = EXCLUDED.session_number,
                        tire_set = COALESCE(EXCLUDED.tire_set, {_table("seances")}.tire_set),
                        duration_min = COALESCE(EXCLUDED.duration_min, {_table("seances")}.duration_min),
                        notes = EXCLUDED.notes,
                        created_by_user_id = EXCLUDED.created_by_user_id,
                        status = EXCLUDED.status,
                        updated_at = now()
                    RETURNING seance_id
                    """
                ),
                {
                    "id_seance": id_seance,
                    "vehicle_assignment_id": vehicle_assignment_id,
                    "track_id": track_id,
                    "session_started_at": started_at,
                    "session_date": session_date,
                    "session_type": session_type,
                    "session_number": session_number,
                    "tire_set": tire_set,
                    "duration_min": duration_min,
                    "notes": raw_text,
                    "created_by_user_id": created_by_user_id,
                    "status": "FINAL",
                },
            ).scalar_one()
        )
    )


def _upsert_submission_input(
    db: Session,
    *,
    seance_id: UUID,
    id_seance: str,
    submission_type: str,
    source: str,
    raw_text: str,
    payload: dict[str, Any],
    confidence: float,
    created_by_user_id: UUID,
) -> UUID:
    payload_json = _json_text(payload)
    payload_hash = _raw_payload_hash(raw_text=raw_text, payload=payload)
    return UUID(
        str(
            db.execute(
                text(
                    f"""
                    INSERT INTO {_table("submission_inputs")} (
                        source_seance_code,
                        seance_id,
                        submission_type,
                        source,
                        raw_text,
                        raw_payload_text,
                        raw_payload_jsonb,
                        raw_payload_hash,
                        confidence,
                        created_by_user_id,
                        created_at,
                        updated_at,
                        validation_status,
                        validation_message,
                        validated_at,
                        applied_at
                    ) VALUES (
                        :source_seance_code,
                        :seance_id,
                        CAST(:submission_type AS {_table("sm2_submission_type")}),
                        CAST(:source AS {_table("sm2_submission_source")}),
                        :raw_text,
                        :raw_payload_text,
                        CAST(:raw_payload_jsonb AS jsonb),
                        :raw_payload_hash,
                        :confidence,
                        :created_by_user_id,
                        now(),
                        now(),
                        CAST('APPLIED' AS {_table("sm2_validation_status")}),
                        NULL,
                        now(),
                        now()
                    )
                    ON CONFLICT (seance_id) DO UPDATE
                    SET source_seance_code = EXCLUDED.source_seance_code,
                        submission_type = EXCLUDED.submission_type,
                        source = EXCLUDED.source,
                        raw_text = EXCLUDED.raw_text,
                        raw_payload_text = EXCLUDED.raw_payload_text,
                        raw_payload_jsonb = EXCLUDED.raw_payload_jsonb,
                        raw_payload_hash = EXCLUDED.raw_payload_hash,
                        confidence = EXCLUDED.confidence,
                        created_by_user_id = EXCLUDED.created_by_user_id,
                        updated_at = now(),
                        validation_status = EXCLUDED.validation_status,
                        validation_message = EXCLUDED.validation_message,
                        validated_at = EXCLUDED.validated_at,
                        applied_at = EXCLUDED.applied_at
                    RETURNING submission_input_id
                    """
                ),
                {
                    "source_seance_code": id_seance,
                    "seance_id": seance_id,
                    "submission_type": submission_type,
                    "source": source,
                    "raw_text": raw_text,
                    "raw_payload_text": payload_json,
                    "raw_payload_jsonb": payload_json,
                    "raw_payload_hash": payload_hash,
                    "confidence": confidence,
                    "created_by_user_id": created_by_user_id,
                },
            ).scalar_one()
        )
    )


def _upsert_numeric_section(
    db: Session,
    *,
    section: str,
    table_name: str,
    seance_id: UUID,
    values: dict[str, Any],
) -> None:
    meaningful_columns = [column for column, value in values.items() if value is not None]
    if not meaningful_columns:
        return

    insert_columns = ["seance_id", *meaningful_columns]
    assignments = ", ".join(f"{column} = EXCLUDED.{column}" for column in meaningful_columns)
    params = {"seance_id": seance_id, **{column: values[column] for column in meaningful_columns}}
    db.execute(
        text(
            f"""
            INSERT INTO {_table(table_name)} (
                {", ".join(insert_columns)},
                created_at,
                updated_at
            ) VALUES (
                :seance_id,
                {", ".join(f":{column}" for column in meaningful_columns)},
                now(),
                now()
            )
            ON CONFLICT (seance_id) DO UPDATE
            SET {assignments},
                updated_at = now()
            """
        ),
        params,
    )


def _upsert_tire_inventory(
    db: Session,
    *,
    tire_id: str,
) -> None:
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
                NULL,
                NULL,
                NULL,
                CAST(:status AS {_table("sm2_lifecycle_status")}),
                now(),
                now()
            )
            ON CONFLICT (tire_id) DO UPDATE
            SET manufacturer = COALESCE(EXCLUDED.manufacturer, {_table("tire_inventory")}.manufacturer),
                model = COALESCE(EXCLUDED.model, {_table("tire_inventory")}.model),
                size = COALESCE(EXCLUDED.size, {_table("tire_inventory")}.size),
                status = COALESCE(EXCLUDED.status, {_table("tire_inventory")}.status),
                updated_at = now()
            """
        ),
        {
            "tire_id": tire_id,
            "manufacturer": "Unknown",
            "model": None,
            "size": None,
            "status": "ACTIVE",
        },
    )


@dataclass(slots=True)
class RawCurrentSchemaPersistResult:
    submission_input_id: UUID | int | None = None
    seance_id: UUID | None = None
    id_seance: str | None = None
    status: str = "skipped"
    warnings: list[dict[str, Any]] = field(default_factory=list)
    saved_sections: list[str] = field(default_factory=list)
    skipped_sections: list[str] = field(default_factory=list)


def persist_raw_submission_current_schema(
    db: Session,
    *,
    submission: Submission,
    event: Event,
    run_group: RunGroup,
    driver: Driver,
    vehicle: Vehicle,
    current_user: User,
    source: str,
    payload: dict[str, Any],
    analysis_result: dict[str, Any],
    id_seance: str,
    captured_at: datetime,
) -> RawCurrentSchemaPersistResult:
    result = RawCurrentSchemaPersistResult(id_seance=id_seance)
    session_data = _dict_or_empty(payload.get("data"))
    if not session_data:
        return result

    storage_mode = _raw_storage_mode(db)
    if storage_mode == "legacy":
        from app.services.submission_ingest_service import persist_structured_submission

        legacy_result = persist_structured_submission(
            db,
            submission=submission,
            event=event,
            run_group=run_group,
            driver=driver,
            vehicle=vehicle,
            current_user=current_user,
        )
        result.submission_input_id = legacy_result.submission_input_id
        result.status = legacy_result.status
        result.warnings.extend(legacy_result.warnings)
        result.saved_sections.extend(legacy_result.saved_sections)
        result.skipped_sections.extend(legacy_result.skipped_sections)
        return result

    track_name = _clean_text(event.track)
    if not track_name:
        raise RawSubmissionValidationError(
            "track must exist",
            errors=[{"field": "track", "message": "track must exist"}],
        )

    started_at = captured_at.astimezone(timezone.utc)
    track_id = _resolve_track_id(db, track_name)
    vehicle_assignment_id = _resolve_vehicle_assignment_id(
        db,
        vehicle_id=vehicle.vehicle_id,
        driver_id=driver.driver_id,
        started_at=started_at,
    )

    tire_set = _clean_text(session_data.get("tire_set"))
    submission_type = _submission_type_from_session(session_data)
    confidence = float(analysis_result.get("confidence") or 1.0)

    seance_id = _upsert_session_row(
        db,
        id_seance=id_seance,
        track_id=track_id,
        vehicle_assignment_id=vehicle_assignment_id,
        started_at=started_at,
        session_date=started_at.date(),
        session_type=_clean_text(session_data.get("session_type")) or "Practice",
        session_number=int(session_data["session_number"]),
        duration_min=_parse_int(session_data.get("duration_min"), field_name="duration_min"),
        tire_set=tire_set,
        raw_text=submission.raw_text or "",
        created_by_user_id=current_user.id,
    )
    result.seance_id = seance_id
    result.saved_sections.append("seances")

    submission_input_id = _upsert_submission_input(
        db,
        seance_id=seance_id,
        id_seance=id_seance,
        submission_type=submission_type,
        source=source,
        raw_text=submission.raw_text or "",
        payload=payload,
        confidence=confidence,
        created_by_user_id=current_user.id,
    )
    result.submission_input_id = submission_input_id
    result.saved_sections.append("submission_inputs")

    db.execute(
        text(
            f"""
            UPDATE {_table("seances")}
            SET source_submission_id = :submission_input_id,
                updated_at = now()
            WHERE seance_id = :seance_id
            """
        ),
        {
            "submission_input_id": submission_input_id,
            "seance_id": seance_id,
        },
    )

    pressures = session_data.get("pressures") if isinstance(session_data.get("pressures"), dict) else {}
    if isinstance(pressures, dict) and pressures:
        cold_pressures = _dict_or_empty(pressures.get("cold"))
        hot_pressures = _dict_or_empty(pressures.get("hot"))
        _upsert_numeric_section(
            db,
            section="pressures",
            table_name="pressures",
            seance_id=seance_id,
            values={
                "cold_fl": _parse_float(cold_pressures.get("fl"), field_name="pressures.cold.fl"),
                "cold_fr": _parse_float(cold_pressures.get("fr"), field_name="pressures.cold.fr"),
                "cold_rl": _parse_float(cold_pressures.get("rl"), field_name="pressures.cold.rl"),
                "cold_rr": _parse_float(cold_pressures.get("rr"), field_name="pressures.cold.rr"),
                "hot_fl": _parse_float(hot_pressures.get("fl"), field_name="pressures.hot.fl"),
                "hot_fr": _parse_float(hot_pressures.get("fr"), field_name="pressures.hot.fr"),
                "hot_rl": _parse_float(hot_pressures.get("rl"), field_name="pressures.hot.rl"),
                "hot_rr": _parse_float(hot_pressures.get("rr"), field_name="pressures.hot.rr"),
            },
        )
        result.saved_sections.append("pressures")

    suspension = _dict_or_empty(session_data.get("suspension"))
    if isinstance(suspension, dict) and suspension:
        _upsert_numeric_section(
            db,
            section="suspensions",
            table_name="suspensions",
            seance_id=seance_id,
            values={
                "rebound_fl": _parse_int(suspension.get("rebound_fl"), field_name="suspension.rebound_fl"),
                "rebound_fr": _parse_int(suspension.get("rebound_fr"), field_name="suspension.rebound_fr"),
                "rebound_rl": _parse_int(suspension.get("rebound_rl"), field_name="suspension.rebound_rl"),
                "rebound_rr": _parse_int(suspension.get("rebound_rr"), field_name="suspension.rebound_rr"),
                "bump_fl": _parse_int(suspension.get("bump_fl"), field_name="suspension.bump_fl"),
                "bump_fr": _parse_int(suspension.get("bump_fr"), field_name="suspension.bump_fr"),
                "bump_rl": _parse_int(suspension.get("bump_rl"), field_name="suspension.bump_rl"),
                "bump_rr": _parse_int(suspension.get("bump_rr"), field_name="suspension.bump_rr"),
                "sway_bar_f": _parse_sway_bar_value(suspension.get("sway_bar_f"), field_name="suspension.sway_bar_f"),
                "sway_bar_r": _parse_sway_bar_value(suspension.get("sway_bar_r"), field_name="suspension.sway_bar_r"),
                "wing_angle_deg": _parse_float(suspension.get("wing_angle_deg"), field_name="suspension.wing_angle_deg"),
            },
        )
        result.saved_sections.append("suspensions")

    alignment = _dict_or_empty(session_data.get("alignment"))
    wheelbase_mm = session_data.get("wheelbase_mm")
    if wheelbase_mm is not None:
        alignment = {**alignment, "wheelbase_mm": wheelbase_mm}
    if isinstance(alignment, dict) and alignment:
        _upsert_numeric_section(
            db,
            section="alignment",
            table_name="alignment",
            seance_id=seance_id,
            values={
                "camber_fl": _parse_float(alignment.get("camber_fl"), field_name="alignment.camber_fl"),
                "camber_fr": _parse_float(alignment.get("camber_fr"), field_name="alignment.camber_fr"),
                "camber_rl": _parse_float(alignment.get("camber_rl"), field_name="alignment.camber_rl"),
                "camber_rr": _parse_float(alignment.get("camber_rr"), field_name="alignment.camber_rr"),
                "toe_front": _parse_float(alignment.get("toe_front"), field_name="alignment.toe_front"),
                "toe_rear": _parse_float(alignment.get("toe_rear"), field_name="alignment.toe_rear"),
                "caster_l": _parse_float(alignment.get("caster_l"), field_name="alignment.caster_l"),
                "caster_r": _parse_float(alignment.get("caster_r"), field_name="alignment.caster_r"),
                "ride_height_f": _parse_float(alignment.get("ride_height_f"), field_name="alignment.ride_height_f"),
                "ride_height_r": _parse_float(alignment.get("ride_height_r"), field_name="alignment.ride_height_r"),
                "corner_weight_fl": _parse_float(
                    alignment.get("corner_weight_fl"), field_name="alignment.corner_weight_fl"
                ),
                "corner_weight_fr": _parse_float(
                    alignment.get("corner_weight_fr"), field_name="alignment.corner_weight_fr"
                ),
                "corner_weight_rl": _parse_float(
                    alignment.get("corner_weight_rl"), field_name="alignment.corner_weight_rl"
                ),
                "corner_weight_rr": _parse_float(
                    alignment.get("corner_weight_rr"), field_name="alignment.corner_weight_rr"
                ),
                "rake_mm": _parse_float(alignment.get("rake_mm"), field_name="alignment.rake_mm"),
                "wheelbase_mm": _parse_float(alignment.get("wheelbase_mm"), field_name="alignment.wheelbase_mm"),
            },
        )
        result.saved_sections.append("alignment")

    if tire_set:
        _upsert_tire_inventory(db, tire_id=tire_set)
        result.saved_sections.append("tire_inventory")

    result.status = "saved_with_warnings" if result.warnings else "saved"
    return result
