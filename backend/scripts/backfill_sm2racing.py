from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Json, Jsonb


DEFAULT_SOURCE_SCHEMAS = ("public", "sm2", "sm2racing")
DEFAULT_TARGET_SCHEMA = "sm2racing"
STRUCTURED_HINT_KEYS = {
    "date",
    "time",
    "track",
    "driver_id",
    "vehicle_id",
    "session_type",
    "session_number",
    "duration_min",
    "tire_set",
    "pressures",
    "suspension",
    "alignment",
    "tire_temperatures",
    "tire_inventory",
    "wheelbase_mm",
}

table_columns_cached: dict[str, list[str]] = {}


@dataclass
class Issue:
    severity: str
    submission_ref: str | None
    message: str
    details: dict[str, Any] = field(default_factory=dict)
    source_schema: str | None = None


@dataclass
class MigrationReport:
    source_rows: int = 0
    chosen_rows: int = 0
    processed_rows: int = 0
    applied_rows: int = 0
    skipped_rows: int = 0
    duplicate_groups: int = 0
    warnings: list[Issue] = field(default_factory=list)
    errors: list[Issue] = field(default_factory=list)
    table_counts: dict[str, int] = field(default_factory=dict)


@dataclass
class SourceSnapshot:
    submissions: list[dict[str, Any]]
    detail_rows: dict[str, dict[str, list[dict[str, Any]]]]
    reference_rows: dict[str, dict[str, list[dict[str, Any]]]]


@dataclass
class TargetCache:
    users_by_id: dict[uuid.UUID, dict[str, Any]]
    users_by_name: dict[str, dict[str, Any]]
    users_by_email: dict[str, dict[str, Any]]
    events_by_id: dict[uuid.UUID, dict[str, Any]]
    events_by_name: dict[str, dict[str, Any]]
    events_by_track: dict[str, dict[str, Any]]
    run_groups_by_id: dict[uuid.UUID, dict[str, Any]]
    run_groups_by_event_id: dict[uuid.UUID, dict[str, Any]]
    run_groups_by_code: dict[str, dict[str, Any]]
    drivers_by_id: dict[uuid.UUID, dict[str, Any]]
    drivers_by_code: dict[str, dict[str, Any]]
    vehicles_by_id: dict[uuid.UUID, dict[str, Any]]
    vehicles_by_code: dict[str, dict[str, Any]]
    tracks_by_name: dict[str, dict[str, Any]]
    tire_inventory_by_id: dict[str, dict[str, Any]]


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def is_uuid_text(value: Any) -> bool:
    text = clean_text(value)
    if not text:
        return False
    try:
        uuid.UUID(text)
        return True
    except ValueError:
        return False


def parse_uuid(value: Any) -> uuid.UUID | None:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    text = clean_text(value)
    if not text:
        return None
    try:
        return uuid.UUID(text)
    except ValueError:
        return None


def json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


def parse_date(value: Any) -> date | None:
    text = clean_text(value)
    if not text:
        return None
    for parser in (date.fromisoformat,):
        try:
            return parser(text)
        except ValueError:
            pass
    for fmt in ("%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def parse_time(value: Any) -> time | None:
    text = clean_text(value)
    if not text:
        return None
    for parser in (time.fromisoformat,):
        try:
            return parser(text)
        except ValueError:
            pass
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M:%S %p"):
        try:
            return datetime.strptime(text, fmt).time()
        except ValueError:
            pass
    return None


def parse_int(value: Any) -> int | None:
    text = clean_text(value)
    if text is None:
        return None
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


def parse_decimal(value: Any) -> Decimal | None:
    text = clean_text(value)
    if text is None:
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def value_score(value: Any) -> int:
    if value in (None, "", [], {}, ()):
        return 0
    if isinstance(value, dict):
        return sum(value_score(item) for item in value.values()) + 1
    if isinstance(value, (list, tuple, set)):
        return sum(value_score(item) for item in value) + 1
    return 1


def table_exists(conn: psycopg.Connection[Any], schema: str, table: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            select 1
            from information_schema.tables
            where table_schema = %s and table_name = %s and table_type = 'BASE TABLE'
            """,
            (schema, table),
        )
        return cur.fetchone() is not None


def table_columns(conn: psycopg.Connection[Any], schema: str, table: str) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select column_name
            from information_schema.columns
            where table_schema = %s and table_name = %s
            order by ordinal_position
            """,
            (schema, table),
        )
        return [row["column_name"] for row in cur.fetchall()]


def fetch_all_rows(conn: psycopg.Connection[Any], schema: str, table: str) -> list[dict[str, Any]]:
    if not table_exists(conn, schema, table):
        return []

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql.SQL("select * from {}.{}").format(sql.Identifier(schema), sql.Identifier(table)))
        rows = [dict(row) for row in cur.fetchall()]
    for row in rows:
        row["__source_schema"] = schema
    return rows


def key_from_row(row: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return str(value)
    return None


def row_quality(row: dict[str, Any]) -> tuple[int, float, float]:
    score = 0
    for key, value in row.items():
        if key.startswith("__"):
            continue
        score += value_score(value)

    analysis = row.get("analysis_result")
    if isinstance(analysis, dict) and analysis.get("source_type") in {"detail", "manual"}:
        score += 5

    created_at = row.get("created_at")
    updated_at = row.get("updated_at")
    created_ts = created_at.timestamp() if isinstance(created_at, datetime) else 0.0
    updated_ts = updated_at.timestamp() if isinstance(updated_at, datetime) else 0.0
    return score, created_ts, updated_ts


def choose_best_row(rows: list[dict[str, Any]], preferred_schema_order: dict[str, int] | None = None) -> dict[str, Any] | None:
    if not rows:
        return None

    preferred_schema_order = preferred_schema_order or {}

    def sort_key(row: dict[str, Any]) -> tuple[int, float, float, int]:
        quality = row_quality(row)
        schema_rank = preferred_schema_order.get(str(row.get("__source_schema")), 0)
        return quality[0], quality[1], quality[2], schema_rank

    return max(rows, key=sort_key)


def choose_submission_ref(row: dict[str, Any]) -> str | None:
    return key_from_row(row, "submission_ref", "id_seance", "submission_id", "id")


def extract_detail_key(row: dict[str, Any]) -> str | None:
    return key_from_row(row, "id_seance", "submission_ref")


def normalize_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    if any(key in payload for key in STRUCTURED_HINT_KEYS):
        return payload
    nested = payload.get("data")
    if isinstance(nested, dict):
        return nested
    return payload


def payload_has_structured_data(payload: dict[str, Any]) -> bool:
    return any(key in payload for key in STRUCTURED_HINT_KEYS)


def row_to_dict_from_keys(row: dict[str, Any], keys: Iterable[str]) -> dict[str, Any]:
    return {key: row.get(key) for key in keys if key in row}


def log_issue(
    conn: psycopg.Connection[Any],
    *,
    action: str,
    message: str,
    payload: dict[str, Any] | None = None,
    user: str | None = None,
) -> None:
    if not table_exists(conn, "sm2racing", "logs"):
        return

    columns = table_columns(conn, "sm2racing", "logs")
    values: dict[str, Any] = {"action": action, "message": message, "payload": Jsonb(json_safe(payload or {})), "user": user}
    insert_cols = [col for col in values if col in columns]
    if not insert_cols:
        return

    query = sql.SQL("insert into sm2racing.logs ({cols}) values ({vals})").format(
        cols=sql.SQL(", ").join(sql.Identifier(col) for col in insert_cols),
        vals=sql.SQL(", ").join(sql.Placeholder() for _ in insert_cols),
    )
    with conn.cursor() as cur:
        cur.execute(query, [values[col] for col in insert_cols])


def merge_section(
    target_columns: list[str],
    source_row: dict[str, Any] | None,
    payload_section: Any,
    mapping: dict[str, str] | None = None,
) -> dict[str, Any]:
    values: dict[str, Any] = {}
    source_row = source_row or {}
    mapping = mapping or {}

    section: dict[str, Any] = payload_section if isinstance(payload_section, dict) else {}
    for column in target_columns:
        source_key = mapping.get(column, column)
        candidate = source_row.get(column)
        if candidate in (None, ""):
            candidate = source_row.get(source_key)
        if candidate in (None, ""):
            candidate = section.get(source_key)
        if candidate in (None, ""):
            candidate = section.get(column)
        values[column] = candidate
    return values


def normalize_suspension_values(
    target_columns: list[str],
    source_row: dict[str, Any] | None,
    payload_section: Any,
) -> dict[str, Any]:
    source_row = source_row or {}
    section: dict[str, Any] = payload_section if isinstance(payload_section, dict) else {}
    values: dict[str, Any] = {}

    has_four_corner = any(
        column in target_columns
        for column in ("rebound_fl", "rebound_fr", "rebound_rl", "rebound_rr", "bump_fl", "bump_fr", "bump_rl", "bump_rr")
    )
    has_two_corner = any(column in source_row for column in ("rebound_f", "rebound_r", "bump_f", "bump_r"))

    if has_four_corner:
        for corner in ("fl", "fr", "rl", "rr"):
            values[f"rebound_{corner}"] = source_row.get(f"rebound_{corner}")
            if values[f"rebound_{corner}"] in (None, "") and has_two_corner:
                if corner in ("fl", "fr"):
                    values[f"rebound_{corner}"] = source_row.get("rebound_f")
                else:
                    values[f"rebound_{corner}"] = source_row.get("rebound_r")
            if values[f"rebound_{corner}"] in (None, ""):
                values[f"rebound_{corner}"] = section.get(f"rebound_{corner}")

            values[f"bump_{corner}"] = source_row.get(f"bump_{corner}")
            if values[f"bump_{corner}"] in (None, "") and has_two_corner:
                if corner in ("fl", "fr"):
                    values[f"bump_{corner}"] = source_row.get("bump_f")
                else:
                    values[f"bump_{corner}"] = source_row.get("bump_r")
            if values[f"bump_{corner}"] in (None, ""):
                values[f"bump_{corner}"] = section.get(f"bump_{corner}")

        values["sway_bar_f"] = source_row.get("sway_bar_f") or section.get("sway_bar_f")
        values["sway_bar_r"] = source_row.get("sway_bar_r") or section.get("sway_bar_r")
        values["wing_angle_deg"] = source_row.get("wing_angle_deg") or section.get("wing_angle_deg")
    else:
        values["rebound_f"] = source_row.get("rebound_f") or section.get("rebound_f")
        values["rebound_r"] = source_row.get("rebound_r") or section.get("rebound_r")
        values["bump_f"] = source_row.get("bump_f") or section.get("bump_f")
        values["bump_r"] = source_row.get("bump_r") or section.get("bump_r")
        values["sway_bar_f"] = source_row.get("sway_bar_f") or section.get("sway_bar_f")
        values["sway_bar_r"] = source_row.get("sway_bar_r") or section.get("sway_bar_r")
        values["wing_angle_deg"] = source_row.get("wing_angle_deg") or section.get("wing_angle_deg")

    return {key: values.get(key) for key in target_columns if key in values}


def normalize_pressure_values(
    target_columns: list[str],
    source_row: dict[str, Any] | None,
    payload_section: Any,
) -> dict[str, Any]:
    source_row = source_row or {}
    section: dict[str, Any] = payload_section if isinstance(payload_section, dict) else {}

    values: dict[str, Any] = {}
    if any(key in source_row for key in ("cold_fl", "cold_fr", "cold_rl", "cold_rr", "hot_fl", "hot_fr", "hot_rl", "hot_rr")):
        for column in target_columns:
            if column in source_row:
                values[column] = source_row.get(column)
    else:
        cold = section.get("cold") if isinstance(section.get("cold"), dict) else section
        hot = section.get("hot") if isinstance(section.get("hot"), dict) else {}
        values.update(
            {
                "cold_fl": cold.get("fl"),
                "cold_fr": cold.get("fr"),
                "cold_rl": cold.get("rl"),
                "cold_rr": cold.get("rr"),
                "hot_fl": hot.get("fl"),
                "hot_fr": hot.get("fr"),
                "hot_rl": hot.get("rl"),
                "hot_rr": hot.get("rr"),
            }
        )
    return {key: values.get(key) for key in target_columns if key in values}


def normalize_alignment_values(
    target_columns: list[str],
    source_row: dict[str, Any] | None,
    payload_section: Any,
    wheelbase_mm: Any | None,
) -> dict[str, Any]:
    source_row = source_row or {}
    section: dict[str, Any] = payload_section if isinstance(payload_section, dict) else {}
    values: dict[str, Any] = {}

    def _first_positive_number(*candidates: Any) -> Any | None:
        for candidate in candidates:
            if candidate in (None, ""):
                continue
            try:
                if float(candidate) > 0:
                    return candidate
            except (TypeError, ValueError):
                continue
        return None

    for column in target_columns:
        if column == "wheelbase_mm":
            values[column] = _first_positive_number(
                source_row.get(column),
                wheelbase_mm,
                section.get(column),
            )
        else:
            values[column] = source_row.get(column)
            if values[column] in (None, ""):
                values[column] = section.get(column)
    return {key: values.get(key) for key in target_columns if key in values}


def normalize_tire_temperature_values(
    target_columns: list[str],
    source_row: dict[str, Any] | None,
    payload_section: Any,
    image_url: str | None,
) -> dict[str, Any]:
    source_row = source_row or {}
    section: dict[str, Any] = payload_section if isinstance(payload_section, dict) else {}
    values: dict[str, Any] = {}
    for column in target_columns:
        if column == "photo_url":
            values[column] = source_row.get(column) or image_url or section.get(column)
        else:
            values[column] = source_row.get(column)
            if values[column] in (None, ""):
                values[column] = section.get(column)
    return {key: values.get(key) for key in target_columns if key in values}


def normalize_inventory_values(
    target_columns: list[str],
    source_row: dict[str, Any] | None,
    payload_section: Any,
    payload_tire_set: str | None,
) -> dict[str, Any]:
    source_row = source_row or {}
    section: dict[str, Any] = payload_section if isinstance(payload_section, dict) else {}
    values: dict[str, Any] = {}

    tire_id = clean_text(source_row.get("tire_id") or section.get("tire_id") or payload_tire_set)
    if tire_id:
        values["tire_id"] = tire_id

    for column in target_columns:
        if column == "tire_id":
            continue
        values[column] = source_row.get(column)
        if values[column] in (None, ""):
            values[column] = section.get(column)

    if "manufacturer" in target_columns and not clean_text(values.get("manufacturer")):
        values["manufacturer"] = None
    return {key: values.get(key) for key in target_columns if key in values}


def build_submission_quality_score(row: dict[str, Any]) -> int:
    payload = normalize_payload(row.get("payload"))
    score = 0
    for column in ("raw_text", "image_url", "event_id", "run_group_id", "driver_id", "vehicle_id", "created_by_id", "error_message"):
        score += value_score(row.get(column))
    score += value_score(row.get("analysis_result"))
    score += len([key for key, value in payload.items() if value_score(value) > 0])
    if payload_has_structured_data(payload):
        score += 10
    if isinstance(row.get("analysis_result"), dict) and row["analysis_result"].get("source_type") == "detail":
        score += 15
    return score


def build_source_snapshot(
    conn: psycopg.Connection[Any],
    source_schemas: list[str],
) -> SourceSnapshot:
    submissions: list[dict[str, Any]] = []
    detail_rows: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    reference_rows: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))

    for schema in source_schemas:
        if table_exists(conn, schema, "submissions"):
            rows = fetch_all_rows(conn, schema, "submissions")
            for row in rows:
                row["payload"] = normalize_payload(row.get("payload"))
                submissions.append(row)

        for table in ("seances", "pressures", "suspensions", "alignment", "tire_temperatures", "tire_history"):
            if table_exists(conn, schema, table):
                rows = fetch_all_rows(conn, schema, table)
                for row in rows:
                    key = extract_detail_key(row)
                    if key:
                        detail_rows[table][schema].append(row)

        for table, key_column in (("tracks", "name"), ("tire_inventory", "tire_id")):
            if table_exists(conn, schema, table):
                rows = fetch_all_rows(conn, schema, table)
                for row in rows:
                    key = clean_text(row.get(key_column))
                    if key:
                        reference_rows[table][schema].append(row)

    return SourceSnapshot(submissions=submissions, detail_rows=detail_rows, reference_rows=reference_rows)


def choose_preferred_rows(rows: list[dict[str, Any]], source_schema_order: dict[str, int]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        submission_ref = choose_submission_ref(row)
        if submission_ref:
            grouped[submission_ref].append(row)

    chosen: dict[str, dict[str, Any]] = {}
    for submission_ref, group in grouped.items():
        best = max(
            group,
            key=lambda row: (
                build_submission_quality_score(row),
                row.get("updated_at").timestamp() if isinstance(row.get("updated_at"), datetime) else 0.0,
                row.get("created_at").timestamp() if isinstance(row.get("created_at"), datetime) else 0.0,
                -source_schema_order.get(str(row.get("__source_schema")), 0),
            ),
        )
        chosen[submission_ref] = best
    return chosen


def choose_preferred_reference_rows(
    rows_by_schema: dict[str, list[dict[str, Any]]],
    key_column: str,
    source_schema_order: dict[str, int],
) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for schema, rows in rows_by_schema.items():
        for row in rows:
            key = clean_text(row.get(key_column))
            if key:
                grouped[key].append(row)

    chosen: dict[str, dict[str, Any]] = {}
    for key, group in grouped.items():
        best = max(
            group,
            key=lambda row: (
                row_quality(row)[0],
                row_quality(row)[1],
                row_quality(row)[2],
                -source_schema_order.get(str(row.get("__source_schema")), 0),
            ),
        )
        chosen[key] = best
    return chosen


def load_target_cache(conn: psycopg.Connection[Any], target_schema: str) -> TargetCache:
    def load_map(table: str) -> list[dict[str, Any]]:
        return fetch_all_rows(conn, target_schema, table)

    users = load_map("users")
    events = load_map("events")
    run_groups = load_map("run_groups")
    drivers = load_map("drivers")
    vehicles = load_map("vehicles")
    tracks = load_map("tracks")
    inventory = load_map("tire_inventory")

    users_by_id: dict[uuid.UUID, dict[str, Any]] = {}
    users_by_name: dict[str, dict[str, Any]] = {}
    users_by_email: dict[str, dict[str, Any]] = {}
    for row in users:
        row_id = parse_uuid(row.get("id"))
        if row_id:
            users_by_id[row_id] = row
        name = clean_text(row.get("name"))
        email = clean_text(row.get("email"))
        if name:
            users_by_name[name.lower()] = row
        if email:
            users_by_email[email.lower()] = row

    events_by_id: dict[uuid.UUID, dict[str, Any]] = {}
    events_by_name: dict[str, dict[str, Any]] = {}
    events_by_track: dict[str, dict[str, Any]] = {}
    for row in events:
        row_id = parse_uuid(row.get("id"))
        if row_id:
            events_by_id[row_id] = row
        name = clean_text(row.get("name"))
        track = clean_text(row.get("track"))
        if name:
            events_by_name[name.lower()] = row
        if track:
            events_by_track[track.lower()] = row

    run_groups_by_id: dict[uuid.UUID, dict[str, Any]] = {}
    run_groups_by_event_id: dict[uuid.UUID, dict[str, Any]] = {}
    run_groups_by_code: dict[str, dict[str, Any]] = {}
    for row in run_groups:
        row_id = parse_uuid(row.get("id"))
        event_id = parse_uuid(row.get("event_id"))
        normalized = clean_text(row.get("normalized"))
        raw_text = clean_text(row.get("raw_text"))
        if row_id:
            run_groups_by_id[row_id] = row
        if event_id:
            run_groups_by_event_id[event_id] = row
        if normalized:
            run_groups_by_code[normalized.upper()] = row
        if raw_text:
            run_groups_by_code.setdefault(raw_text.upper(), row)

    drivers_by_id: dict[uuid.UUID, dict[str, Any]] = {}
    drivers_by_code: dict[str, dict[str, Any]] = {}
    for row in drivers:
        row_id = parse_uuid(row.get("id"))
        code = clean_text(row.get("driver_id"))
        if row_id:
            drivers_by_id[row_id] = row
        if code:
            drivers_by_code[code.upper()] = row

    vehicles_by_id: dict[uuid.UUID, dict[str, Any]] = {}
    vehicles_by_code: dict[str, dict[str, Any]] = {}
    for row in vehicles:
        row_id = parse_uuid(row.get("id"))
        code = clean_text(row.get("vehicle_id"))
        if row_id:
            vehicles_by_id[row_id] = row
        if code:
            vehicles_by_code[code.upper()] = row

    tracks_by_name: dict[str, dict[str, Any]] = {}
    for row in tracks:
        name = clean_text(row.get("name"))
        if name:
            tracks_by_name[name.lower()] = row

    tire_inventory_by_id: dict[str, dict[str, Any]] = {}
    for row in inventory:
        tire_id = clean_text(row.get("tire_id"))
        if tire_id:
            tire_inventory_by_id[tire_id.upper()] = row

    return TargetCache(
        users_by_id=users_by_id,
        users_by_name=users_by_name,
        users_by_email=users_by_email,
        events_by_id=events_by_id,
        events_by_name=events_by_name,
        events_by_track=events_by_track,
        run_groups_by_id=run_groups_by_id,
        run_groups_by_event_id=run_groups_by_event_id,
        run_groups_by_code=run_groups_by_code,
        drivers_by_id=drivers_by_id,
        drivers_by_code=drivers_by_code,
        vehicles_by_id=vehicles_by_id,
        vehicles_by_code=vehicles_by_code,
        tracks_by_name=tracks_by_name,
        tire_inventory_by_id=tire_inventory_by_id,
    )


def lookup_submission_uuid(value: Any, cache: dict[uuid.UUID, dict[str, Any]], code_cache: dict[str, dict[str, Any]]) -> uuid.UUID | None:
    row_id = parse_uuid(value)
    if row_id and row_id in cache:
        return row_id
    text = clean_text(value)
    if not text:
        return None
    row = code_cache.get(text.upper()) or code_cache.get(text.lower())
    if row:
        row_id = parse_uuid(row.get("id"))
        if row_id:
            return row_id
    return None


def resolve_user_id(source_row: dict[str, Any], target: TargetCache) -> uuid.UUID | None:
    for candidate in (source_row.get("created_by_id"), source_row.get("created_by"), source_row.get("created_by_name")):
        row_id = parse_uuid(candidate)
        if row_id and row_id in target.users_by_id:
            return row_id
        text = clean_text(candidate)
        if text:
            row = target.users_by_name.get(text.lower()) or target.users_by_email.get(text.lower())
            if row:
                return parse_uuid(row.get("id"))
    return None


def resolve_event_id(source_row: dict[str, Any], payload: dict[str, Any], target: TargetCache) -> uuid.UUID | None:
    for candidate in (source_row.get("event_id"), payload.get("event_id")):
        row_id = parse_uuid(candidate)
        if row_id and row_id in target.events_by_id:
            return row_id
    for candidate in (payload.get("event"), payload.get("track"), source_row.get("event_name")):
        text = clean_text(candidate)
        if not text:
            continue
        row = target.events_by_name.get(text.lower()) or target.events_by_track.get(text.lower())
        if row:
            row_id = parse_uuid(row.get("id"))
            if row_id:
                return row_id
    return None


def resolve_run_group_id(source_row: dict[str, Any], payload: dict[str, Any], target: TargetCache, event_id: uuid.UUID | None) -> uuid.UUID | None:
    for candidate in (source_row.get("run_group_id"), payload.get("run_group_id")):
        row_id = parse_uuid(candidate)
        if row_id and row_id in target.run_groups_by_id:
            return row_id
    for candidate in (payload.get("run_group"), payload.get("run_group_code"), source_row.get("run_group")):
        text = clean_text(candidate)
        if not text:
            continue
        row = target.run_groups_by_code.get(text.upper())
        if row:
            row_id = parse_uuid(row.get("id"))
            if row_id:
                return row_id
    if event_id and event_id in target.run_groups_by_event_id:
        row_id = parse_uuid(target.run_groups_by_event_id[event_id].get("id"))
        if row_id:
            return row_id
    return None


def resolve_driver_uuid(source_row: dict[str, Any], payload: dict[str, Any], target: TargetCache) -> uuid.UUID | None:
    for candidate in (source_row.get("driver_id"), payload.get("driver_uuid")):
        row_id = parse_uuid(candidate)
        if row_id and row_id in target.drivers_by_id:
            return row_id
    for candidate in (payload.get("driver_id"), source_row.get("driver_code"), source_row.get("driver")):
        text = clean_text(candidate)
        if not text:
            continue
        if is_uuid_text(text):
            row_id = parse_uuid(text)
            if row_id and row_id in target.drivers_by_id:
                return row_id
        row = target.drivers_by_code.get(text.upper())
        if row:
            row_id = parse_uuid(row.get("id"))
            if row_id:
                return row_id
    return None


def resolve_vehicle_uuid(source_row: dict[str, Any], payload: dict[str, Any], target: TargetCache) -> uuid.UUID | None:
    for candidate in (source_row.get("vehicle_id"), payload.get("vehicle_uuid")):
        row_id = parse_uuid(candidate)
        if row_id and row_id in target.vehicles_by_id:
            return row_id
    for candidate in (payload.get("vehicle_id"), source_row.get("vehicle_code"), source_row.get("vehicle")):
        text = clean_text(candidate)
        if not text:
            continue
        if is_uuid_text(text):
            row_id = parse_uuid(text)
            if row_id and row_id in target.vehicles_by_id:
                return row_id
        row = target.vehicles_by_code.get(text.upper())
        if row:
            row_id = parse_uuid(row.get("id"))
            if row_id:
                return row_id
    return None


def resolve_driver_code(source_row: dict[str, Any], payload: dict[str, Any], target: TargetCache, driver_uuid: uuid.UUID | None) -> str | None:
    for candidate in (payload.get("driver_id"), source_row.get("driver_code"), source_row.get("driver_id")):
        text = clean_text(candidate)
        if text and not is_uuid_text(text):
            return text
    if driver_uuid and driver_uuid in target.drivers_by_id:
        return clean_text(target.drivers_by_id[driver_uuid].get("driver_id"))
    return None


def resolve_vehicle_code(source_row: dict[str, Any], payload: dict[str, Any], target: TargetCache, vehicle_uuid: uuid.UUID | None) -> str | None:
    for candidate in (payload.get("vehicle_id"), source_row.get("vehicle_code"), source_row.get("vehicle_id")):
        text = clean_text(candidate)
        if text and not is_uuid_text(text):
            return text
    if vehicle_uuid and vehicle_uuid in target.vehicles_by_id:
        return clean_text(target.vehicles_by_id[vehicle_uuid].get("vehicle_id"))
    return None


def choose_best_inventory_candidate(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not rows:
        return None
    return max(
        rows,
        key=lambda row: (
            row_quality(row)[0],
            row_quality(row)[1],
            row_quality(row)[2],
        ),
    )


def choose_best_track_candidate(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not rows:
        return None
    return max(
        rows,
        key=lambda row: (
            row_quality(row)[0],
            row_quality(row)[1],
            row_quality(row)[2],
        ),
    )


def build_submission_record(
    source_row: dict[str, Any],
    target: TargetCache,
    issues: list[Issue],
) -> dict[str, Any] | None:
    payload = normalize_payload(source_row.get("payload"))
    submission_ref = choose_submission_ref(source_row)
    if not submission_ref:
        issues.append(
            Issue(
                severity="error",
                submission_ref=None,
                message="Submission row is missing a submission_ref",
                details={"source_schema": source_row.get("__source_schema")},
            )
        )
        return None

    event_id = resolve_event_id(source_row, payload, target)
    run_group_id = resolve_run_group_id(source_row, payload, target, event_id)
    created_by_id = resolve_user_id(source_row, target)
    driver_id = resolve_driver_uuid(source_row, payload, target)
    vehicle_id = resolve_vehicle_uuid(source_row, payload, target)

    required_missing = []
    if event_id is None:
        required_missing.append("event_id")
    if run_group_id is None:
        required_missing.append("run_group_id")
    if created_by_id is None:
        required_missing.append("created_by_id")
    if driver_id is None and payload.get("driver_id") is not None:
        required_missing.append("driver_id")
    if vehicle_id is None and payload.get("vehicle_id") is not None:
        required_missing.append("vehicle_id")

    if required_missing:
        issues.append(
            Issue(
                severity="error",
                submission_ref=submission_ref,
                message="Submission could not be resolved because required foreign keys are missing",
                details={"missing": required_missing, "source_schema": source_row.get("__source_schema")},
                source_schema=str(source_row.get("__source_schema")),
            )
        )
        return None

    created_at = source_row.get("created_at") if isinstance(source_row.get("created_at"), datetime) else datetime.now(timezone.utc)
    updated_at = source_row.get("updated_at") if isinstance(source_row.get("updated_at"), datetime) else created_at

    status = clean_text(source_row.get("status")) or "PENDING"
    error_message = clean_text(source_row.get("error_message"))
    raw_text = clean_text(source_row.get("raw_text"))
    image_url = clean_text(source_row.get("image_url"))
    analysis_result = source_row.get("analysis_result") if isinstance(source_row.get("analysis_result"), dict) else None

    return {
        "submission_ref": submission_ref,
        "payload": payload,
        "source_schema": source_row.get("__source_schema"),
        "event_id": event_id,
        "run_group_id": run_group_id,
        "created_by_id": created_by_id,
        "driver_id": driver_id,
        "vehicle_id": vehicle_id,
        "created_at": created_at,
        "updated_at": updated_at,
        "status": status,
        "error_message": error_message,
        "raw_text": raw_text,
        "image_url": image_url,
        "analysis_result": analysis_result,
        "source_row": source_row,
    }


def build_session_sections(
    submission: dict[str, Any],
    snapshot: SourceSnapshot,
    target: TargetCache,
    issues: list[Issue],
) -> dict[str, Any] | None:
    source_row = submission["source_row"]
    submission_ref = submission["submission_ref"]
    payload = submission["payload"]

    source_schema = str(submission["source_schema"])
    def rows_for(table_name: str) -> list[dict[str, Any]]:
        matching_rows: list[dict[str, Any]] = []
        for schema_rows in snapshot.detail_rows.get(table_name, {}).values():
            matching_rows.extend(row for row in schema_rows if extract_detail_key(row) == submission_ref)
        return matching_rows

    source_seance_rows = rows_for("seances")
    source_pressure_rows = rows_for("pressures")
    source_suspension_rows = rows_for("suspensions")
    source_alignment_rows = rows_for("alignment")
    source_temp_rows = rows_for("tire_temperatures")
    source_history_rows = rows_for("tire_history")

    source_seance = choose_best_row(source_seance_rows, {source_schema: 1}) if source_seance_rows else None
    source_pressure = choose_best_row(source_pressure_rows, {source_schema: 1}) if source_pressure_rows else None
    source_suspension = choose_best_row(source_suspension_rows, {source_schema: 1}) if source_suspension_rows else None
    source_alignment = choose_best_row(source_alignment_rows, {source_schema: 1}) if source_alignment_rows else None
    source_temp = choose_best_row(source_temp_rows, {source_schema: 1}) if source_temp_rows else None
    source_history = choose_best_row(source_history_rows, {source_schema: 1}) if source_history_rows else None

    source_seance_data = source_seance or {}
    source_pressure_data = source_pressure or {}
    source_suspension_data = source_suspension or {}
    source_alignment_data = source_alignment or {}
    source_temp_data = source_temp or {}
    source_history_data = source_history or {}

    session_date = parse_date(source_seance_data.get("session_date") or payload.get("date"))
    session_time = parse_time(source_seance_data.get("session_time") or payload.get("time"))
    track_name = clean_text(source_seance_data.get("track") or payload.get("track") or target.events_by_id.get(submission["event_id"], {}).get("track"))
    seance_driver_source = source_seance_data.get("driver_id")
    if is_uuid_text(seance_driver_source):
        driver_code = clean_text(resolve_driver_code(source_row, payload, target, parse_uuid(seance_driver_source) or submission["driver_id"]))
    else:
        driver_code = clean_text(seance_driver_source or resolve_driver_code(source_row, payload, target, submission["driver_id"]))

    seance_vehicle_source = source_seance_data.get("vehicle_id")
    if is_uuid_text(seance_vehicle_source):
        vehicle_code = clean_text(resolve_vehicle_code(source_row, payload, target, parse_uuid(seance_vehicle_source) or submission["vehicle_id"]))
    else:
        vehicle_code = clean_text(seance_vehicle_source or resolve_vehicle_code(source_row, payload, target, submission["vehicle_id"]))

    session_type = clean_text(source_seance_data.get("session_type") or payload.get("session_type")) or "Practice"
    session_number = parse_int(source_seance_data.get("session_number") or payload.get("session_number")) or 1
    duration_min = parse_int(source_seance_data.get("duration_min") or payload.get("duration_min"))
    if duration_min is None:
        duration_min = 30
    tire_set_payload = clean_text(payload.get("tire_set"))
    payload_inventory = payload.get("tire_inventory") if isinstance(payload.get("tire_inventory"), dict) else {}

    # Build the canonical inventory candidate from any source row or payload.
    inventory_pool: list[dict[str, Any]] = []
    for rows in snapshot.reference_rows.get("tire_inventory", {}).values():
        inventory_pool.extend(rows)
    candidate_inventory_ids = {
        clean_text(source_seance_data.get("tire_id")),
        clean_text(payload_inventory.get("tire_id")),
        tire_set_payload,
    }
    candidate_inventory_ids = {value.upper() for value in candidate_inventory_ids if value}
    source_inventory_candidates = [
        row
        for row in inventory_pool
        if clean_text(row.get("tire_id")) and clean_text(row.get("tire_id")).upper() in candidate_inventory_ids
    ]
    source_inventory = choose_best_inventory_candidate(source_inventory_candidates) if source_inventory_candidates else None
    inventory_tire_id = clean_text(
        (source_inventory or {}).get("tire_id")
        or payload_inventory.get("tire_id")
        or tire_set_payload
    )

    canonical_tire_id = inventory_tire_id
    if tire_set_payload and inventory_tire_id and tire_set_payload != inventory_tire_id:
        issues.append(
            Issue(
                severity="warning",
                submission_ref=submission_ref,
                message="payload tire_set did not match the tire_inventory tire_id; canonical tire_id was used",
                details={"payload_tire_set": tire_set_payload, "canonical_tire_id": inventory_tire_id},
                source_schema=source_schema,
            )
        )

    if tire_set_payload and not canonical_tire_id:
        canonical_tire_id = tire_set_payload

    if canonical_tire_id and canonical_tire_id.upper() not in target.tire_inventory_by_id:
        # Leave tire_set null if we cannot satisfy the FK. This preserves integrity and logs the issue.
        issues.append(
            Issue(
                severity="warning",
                submission_ref=submission_ref,
                message="No matching tire_inventory row exists for tire_set; tire_set will be left null",
                details={"tire_set": canonical_tire_id},
                source_schema=source_schema,
            )
        )
        canonical_tire_id = None

    tire_inventory_values = normalize_inventory_values(
        [col for col in table_columns_cached["tire_inventory"] if col in ("tire_id", "manufacturer", "model", "size", "purchase_date", "heat_cycles", "track_time_min", "status", "created_at", "updated_at")],
        source_inventory,
        payload_inventory,
        tire_set_payload,
    )
    if canonical_tire_id:
        tire_inventory_values["tire_id"] = canonical_tire_id

    seance_values = {
        "id_seance": submission_ref,
        "session_date": session_date,
        "session_time": session_time,
        "track": track_name,
        "driver_id": driver_code,
        "vehicle_id": vehicle_code,
        "session_type": session_type,
        "session_number": session_number,
        "duration_min": duration_min,
        "tire_set": canonical_tire_id,
        "notes": clean_text(source_seance_data.get("notes") or submission.get("raw_text")),
        "created_by": clean_text(source_seance_data.get("created_by") or target.users_by_id.get(submission["created_by_id"], {}).get("name") or "Migration"),
        "created_at": submission["created_at"],
    }

    required_missing = [name for name in ("session_date", "track", "driver_id", "vehicle_id") if seance_values.get(name) in (None, "")]
    if required_missing:
        issues.append(
            Issue(
                severity="error",
                submission_ref=submission_ref,
                message="Structured submission is missing required session fields",
                details={"missing": required_missing, "source_schema": source_schema},
                source_schema=source_schema,
            )
        )
        return None

    pressure_section = payload.get("pressures") if isinstance(payload.get("pressures"), dict) else {}
    suspension_section = payload.get("suspension") if isinstance(payload.get("suspension"), dict) else {}
    alignment_section = payload.get("alignment") if isinstance(payload.get("alignment"), dict) else {}
    temp_section = payload.get("tire_temperatures") if isinstance(payload.get("tire_temperatures"), dict) else {}

    pressure_values = normalize_pressure_values(
        [column for column in table_columns_cached["pressures"] if column != "id_seance"],
        source_pressure_data,
        pressure_section,
    )
    suspension_values = normalize_suspension_values(
        [column for column in table_columns_cached["suspensions"] if column != "id_seance"],
        source_suspension_data,
        suspension_section,
    )
    alignment_values = normalize_alignment_values(
        [column for column in table_columns_cached["alignment"] if column != "id_seance"],
        source_alignment_data,
        alignment_section,
        payload.get("wheelbase_mm"),
    )
    temp_values = normalize_tire_temperature_values(
        [column for column in table_columns_cached["tire_temperatures"] if column != "id_seance"],
        source_temp_data,
        temp_section,
        submission.get("image_url"),
    )

    history_values = {
        "tire_id": canonical_tire_id,
        "id_seance": submission_ref,
        "usage_date": session_date,
        "track": track_name,
        "duration_min": duration_min,
        "created_at": submission["created_at"],
    }

    return {
        "seance": seance_values,
        "pressure": pressure_values,
        "suspension": suspension_values,
        "alignment": alignment_values,
        "temperature": temp_values,
        "inventory": tire_inventory_values if canonical_tire_id or tire_inventory_values else None,
        "history": history_values if canonical_tire_id else None,
    }


def upsert_row(
    conn: psycopg.Connection[Any],
    schema: str,
    table: str,
    values: dict[str, Any],
    conflict_columns: list[str],
    target_columns: list[str],
    *,
    preserve_existing: bool = True,
) -> None:
    insert_columns = [column for column in values if column in target_columns]
    if not insert_columns:
        return

    set_columns = [column for column in insert_columns if column not in conflict_columns and column not in {"created_at", "updated_at", "id"}]
    if preserve_existing:
        assignments = [
            sql.SQL("{col} = COALESCE(EXCLUDED.{col}, {table}.{col})").format(
                col=sql.Identifier(column),
                table=sql.Identifier(table),
            )
            for column in set_columns
        ]
    else:
        assignments = [
            sql.SQL("{col} = EXCLUDED.{col}").format(
                col=sql.Identifier(column),
            )
            for column in set_columns
        ]

    conflict_sql = sql.SQL(", ").join(sql.Identifier(column) for column in conflict_columns)
    columns_sql = sql.SQL(", ").join(sql.Identifier(column) for column in insert_columns)
    placeholders = sql.SQL(", ").join(sql.Placeholder() for _ in insert_columns)

    if assignments:
        query = sql.SQL(
            "insert into {schema}.{table} ({columns}) values ({placeholders}) on conflict ({conflict}) do update set {assignments}"
        ).format(
            schema=sql.Identifier(schema),
            table=sql.Identifier(table),
            columns=columns_sql,
            placeholders=placeholders,
            conflict=conflict_sql,
            assignments=sql.SQL(", ").join(assignments),
        )
    else:
        query = sql.SQL(
            "insert into {schema}.{table} ({columns}) values ({placeholders}) on conflict ({conflict}) do nothing"
        ).format(
            schema=sql.Identifier(schema),
            table=sql.Identifier(table),
            columns=columns_sql,
            placeholders=placeholders,
            conflict=conflict_sql,
        )

    with conn.cursor() as cur:
        cur.execute(query, [values[column] for column in insert_columns])


def prepare_report_file(path: str | None) -> Path | None:
    if not path:
        return None
    report_path = Path(path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    return report_path


def source_schema_order(source_schemas: list[str]) -> dict[str, int]:
    return {schema: index for index, schema in enumerate(source_schemas)}


def apply_reference_backfill(
    conn: psycopg.Connection[Any],
    target_schema: str,
    target: TargetCache,
    snapshot: SourceSnapshot,
    source_schemas: list[str],
    report: MigrationReport,
    issues: list[Issue],
) -> None:
    order = source_schema_order(source_schemas)

    track_candidates: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for schema, rows in snapshot.reference_rows.get("tracks", {}).items():
        for row in rows:
            key = clean_text(row.get("name"))
            if key:
                track_candidates[key.lower()].append(row)

    inventory_candidates: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for schema, rows in snapshot.reference_rows.get("tire_inventory", {}).items():
        for row in rows:
            tire_id = clean_text(row.get("tire_id"))
            if tire_id:
                inventory_candidates[tire_id.upper()].append(row)

    track_columns = table_columns_cached["tracks"]
    inventory_columns = table_columns_cached["tire_inventory"]

    for track_name, rows in track_candidates.items():
        best = choose_best_track_candidate(rows)
        if not best:
            continue
        values = {
            "name": clean_text(best.get("name")) or track_name,
            "latitude": parse_decimal(best.get("latitude")),
            "longitude": parse_decimal(best.get("longitude")),
            "country": clean_text(best.get("country")),
            "active": bool(best.get("active")) if best.get("active") is not None else True,
            "created_at": best.get("created_at") if isinstance(best.get("created_at"), datetime) else datetime.now(timezone.utc),
            "updated_at": best.get("updated_at") if isinstance(best.get("updated_at"), datetime) else datetime.now(timezone.utc),
        }
        upsert_row(conn, target_schema, "tracks", values, ["name"], track_columns, preserve_existing=True)
        report.table_counts["tracks"] = report.table_counts.get("tracks", 0) + 1

    for tire_id, rows in inventory_candidates.items():
        best = choose_best_inventory_candidate(rows)
        if not best:
            continue
        values = {
            "tire_id": tire_id,
            "manufacturer": clean_text(best.get("manufacturer")),
            "model": clean_text(best.get("model")),
            "size": clean_text(best.get("size")),
            "purchase_date": parse_date(best.get("purchase_date")),
            "heat_cycles": parse_int(best.get("heat_cycles")),
            "track_time_min": parse_int(best.get("track_time_min")),
            "created_at": best.get("created_at") if isinstance(best.get("created_at"), datetime) else datetime.now(timezone.utc),
            "updated_at": best.get("updated_at") if isinstance(best.get("updated_at"), datetime) else datetime.now(timezone.utc),
        }
        if "status" in inventory_columns:
            status = clean_text(best.get("status"))
            values["status"] = status.upper() if status else "ACTIVE"
        if not values.get("manufacturer"):
            issues.append(
                Issue(
                    severity="warning",
                    submission_ref=None,
                    message="Skipping tire_inventory candidate because manufacturer is missing",
                    details={"tire_id": tire_id, "source_schema": best.get("__source_schema")},
                    source_schema=str(best.get("__source_schema")),
                )
            )
            continue
        upsert_row(conn, target_schema, "tire_inventory", values, ["tire_id"], inventory_columns, preserve_existing=True)
        report.table_counts["tire_inventory"] = report.table_counts.get("tire_inventory", 0) + 1


def apply_submission_backfill(
    conn: psycopg.Connection[Any],
    target_schema: str,
    target: TargetCache,
    submission: dict[str, Any],
    sections: dict[str, Any] | None,
    report: MigrationReport,
    issues: list[Issue],
) -> None:
    target_columns = {
        table: table_columns_cached[table]
        for table in ("submissions", "seances", "pressures", "suspensions", "alignment", "tire_temperatures", "tire_history", "tracks", "tire_inventory")
    }

    source_row = submission["source_row"]
    payload = submission["payload"]
    submission_ref = submission["submission_ref"]

    # Upsert the submission metadata first so the history can be traced even when structured sections are partial.
    submission_values = {
        "id": source_row.get("id") or uuid.uuid4(),
        "submission_ref": submission_ref,
        "event_id": submission["event_id"],
        "run_group_id": submission["run_group_id"],
        "driver_id": submission["driver_id"],
        "vehicle_id": submission["vehicle_id"],
        "created_by_id": submission["created_by_id"],
        "raw_text": submission.get("raw_text"),
        "image_url": submission.get("image_url"),
        "payload": Json(json_safe(payload)),
        "analysis_result": Json(json_safe(submission.get("analysis_result"))) if submission.get("analysis_result") is not None else None,
        "error_message": submission.get("error_message"),
        "created_at": submission["created_at"],
        "updated_at": submission["updated_at"],
    }
    if "status" in target_columns["submissions"]:
        submission_values["status"] = submission.get("status") or "PENDING"
    upsert_row(conn, target_schema, "submissions", submission_values, ["submission_ref"], target_columns["submissions"], preserve_existing=True)

    if sections is None:
        issues.append(
            Issue(
                severity="warning",
                submission_ref=submission_ref,
                message="Structured sections are missing or invalid; only the submission row was backfilled",
                details={"source_schema": submission["source_schema"]},
                source_schema=str(submission["source_schema"]),
            )
        )
        report.skipped_rows += 1
        return

    seance_values = sections["seance"]
    pressure_values = sections["pressure"]
    suspension_values = sections["suspension"]
    alignment_values = sections["alignment"]
    temp_values = sections["temperature"]
    inventory_values = sections["inventory"]
    history_values = sections["history"]

    upsert_row(conn, target_schema, "seances", seance_values, ["id_seance"], target_columns["seances"], preserve_existing=True)
    upsert_row(conn, target_schema, "pressures", {"id_seance": submission_ref, **pressure_values}, ["id_seance"], target_columns["pressures"], preserve_existing=True)
    upsert_row(conn, target_schema, "suspensions", {"id_seance": submission_ref, **suspension_values}, ["id_seance"], target_columns["suspensions"], preserve_existing=True)
    upsert_row(conn, target_schema, "alignment", {"id_seance": submission_ref, **alignment_values}, ["id_seance"], target_columns["alignment"], preserve_existing=True)
    upsert_row(conn, target_schema, "tire_temperatures", {"id_seance": submission_ref, **temp_values}, ["id_seance"], target_columns["tire_temperatures"], preserve_existing=True)

    if inventory_values and inventory_values.get("tire_id"):
        upsert_row(conn, target_schema, "tire_inventory", inventory_values, ["tire_id"], target_columns["tire_inventory"], preserve_existing=True)

    if history_values and history_values.get("tire_id"):
        upsert_row(conn, target_schema, "tire_history", history_values, ["tire_id", "id_seance"], target_columns["tire_history"], preserve_existing=True)

    report.applied_rows += 1


def verify_target_state(
    conn: psycopg.Connection[Any],
    target_schema: str,
    report: MigrationReport,
) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    tables = ("submissions", "seances", "pressures", "suspensions", "alignment", "tire_temperatures", "tire_history", "tire_inventory", "tracks")
    for table in tables:
        if table_exists(conn, target_schema, table):
            with conn.cursor() as cur:
                cur.execute(sql.SQL("select count(*) from {}.{}").format(sql.Identifier(target_schema), sql.Identifier(table)))
                summary[table] = cur.fetchone()["count"]

    # Referential integrity checks on the normalized rows.
    checks = {}
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL(
                """
                select count(*)
                from {schema}.submissions s
                left join {schema}.seances se on se.id_seance = s.submission_ref
                where s.payload::jsonb ? 'date' and se.id_seance is null
                """
            ).format(schema=sql.Identifier(target_schema))
        )
        checks["structured_submissions_missing_seance"] = cur.fetchone()["count"]

        cur.execute(
            sql.SQL(
                """
                select count(*)
                from {schema}.tire_history th
                left join {schema}.tire_inventory ti on ti.tire_id = th.tire_id
                left join {schema}.seances se on se.id_seance = th.id_seance
                where ti.tire_id is null or se.id_seance is null
                """
            ).format(schema=sql.Identifier(target_schema))
        )
        checks["tire_history_fk_issues"] = cur.fetchone()["count"]

    report.table_counts = summary
    summary.update(checks)
    return summary


def write_report(path: Path | None, report: MigrationReport, verification: dict[str, Any]) -> None:
    if path is None:
        return

    payload = {
        "source_rows": report.source_rows,
        "chosen_rows": report.chosen_rows,
        "processed_rows": report.processed_rows,
        "applied_rows": report.applied_rows,
        "skipped_rows": report.skipped_rows,
        "duplicate_groups": report.duplicate_groups,
        "table_counts": report.table_counts,
        "warnings": [issue.__dict__ for issue in report.warnings],
        "errors": [issue.__dict__ for issue in report.errors],
        "verification": verification,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")


def print_summary(report: MigrationReport, verification: dict[str, Any]) -> None:
    print("Backfill summary")
    print(f"  source rows: {report.source_rows}")
    print(f"  chosen rows: {report.chosen_rows}")
    print(f"  processed rows: {report.processed_rows}")
    print(f"  applied rows: {report.applied_rows}")
    print(f"  skipped rows: {report.skipped_rows}")
    print(f"  duplicate groups: {report.duplicate_groups}")
    print("  table counts:")
    for table, count in sorted(report.table_counts.items()):
        print(f"    {table}: {count}")
    print("  verification:")
    for key, value in verification.items():
        print(f"    {key}: {value}")
    if report.warnings:
        print("  warnings:")
        for issue in report.warnings:
            print(f"    - {issue.message} [{issue.submission_ref or 'n/a'}]")
    if report.errors:
        print("  errors:")
        for issue in report.errors:
            print(f"    - {issue.message} [{issue.submission_ref or 'n/a'}]")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill legacy SM2 submissions into the unified sm2racing schema."
    )
    parser.add_argument("--source-database-url", default=os.getenv("SOURCE_DATABASE_URL"))
    parser.add_argument("--target-database-url", default=os.getenv("TARGET_DATABASE_URL") or os.getenv("DATABASE_URL"))
    parser.add_argument(
        "--source-schema",
        action="append",
        dest="source_schemas",
        help="Source schema to scan. Can be provided multiple times.",
    )
    parser.add_argument("--target-schema", default=os.getenv("TARGET_SCHEMA", DEFAULT_TARGET_SCHEMA))
    parser.add_argument("--dry-run", action="store_true", help="Inspect and report without writing data.")
    parser.add_argument("--verify", action="store_true", help="Run verification queries after the backfill.")
    parser.add_argument("--report-file", default=os.getenv("BACKFILL_REPORT_FILE"))
    parser.add_argument("--log-action", default="backfill_sm2racing")
    parser.add_argument("--limit", type=int, default=None, help="Process only the first N chosen submissions.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    target_url = args.target_database_url
    source_url = args.source_database_url or target_url
    if not target_url:
        print("DATABASE_URL or TARGET_DATABASE_URL must be set", file=sys.stderr)
        return 2
    if not source_url:
        print("SOURCE_DATABASE_URL must be set when TARGET_DATABASE_URL is not provided", file=sys.stderr)
        return 2

    source_schemas = args.source_schemas or list(DEFAULT_SOURCE_SCHEMAS)
    report_path = prepare_report_file(args.report_file)

    global table_columns_cached
    table_columns_cached = {}

    with psycopg.connect(source_url, row_factory=dict_row) as source_conn, psycopg.connect(target_url, row_factory=dict_row) as target_conn:
        target = load_target_cache(target_conn, args.target_schema)
        for table in ("submissions", "seances", "pressures", "suspensions", "alignment", "tire_temperatures", "tire_history", "tracks", "tire_inventory"):
            if table_exists(target_conn, args.target_schema, table):
                table_columns_cached[table] = table_columns(target_conn, args.target_schema, table)
            else:
                table_columns_cached[table] = []

        snapshot = build_source_snapshot(source_conn, source_schemas)
        report = MigrationReport(source_rows=len(snapshot.submissions))
        schema_order = source_schema_order(source_schemas)
        chosen = choose_preferred_rows(snapshot.submissions, schema_order)
        report.chosen_rows = len(chosen)

        duplicate_groups = defaultdict(list)
        for row in snapshot.submissions:
            submission_ref = choose_submission_ref(row)
            if submission_ref:
                duplicate_groups[submission_ref].append(row)
        report.duplicate_groups = sum(1 for rows in duplicate_groups.values() if len(rows) > 1)

        selected_rows = list(chosen.values())
        selected_rows.sort(
            key=lambda row: (
                row.get("created_at").timestamp() if isinstance(row.get("created_at"), datetime) else 0.0,
                row.get("updated_at").timestamp() if isinstance(row.get("updated_at"), datetime) else 0.0,
                choose_submission_ref(row) or "",
            )
        )
        if args.limit is not None:
            selected_rows = selected_rows[: args.limit]

        # Backfill reference rows first so the session rows can satisfy FK constraints.
        if not args.dry_run:
            reference_issues: list[Issue] = []
            with target_conn.transaction():
                apply_reference_backfill(target_conn, args.target_schema, target, snapshot, source_schemas, report, reference_issues)
            for issue in reference_issues:
                if issue.severity == "warning":
                    report.warnings.append(issue)
                else:
                    report.errors.append(issue)
                log_issue(
                    target_conn,
                    action=args.log_action,
                    message=issue.message,
                    payload={"submission_ref": issue.submission_ref, **issue.details},
                    user="migration-script",
                )
            target = load_target_cache(target_conn, args.target_schema)

        if args.dry_run:
            for row in selected_rows:
                row_issues: list[Issue] = []
                submission = build_submission_record(row, target, row_issues)
                if submission is None:
                    report.skipped_rows += 1
                    report.errors.extend(issue for issue in row_issues if issue.severity == "error")
                    report.warnings.extend(issue for issue in row_issues if issue.severity == "warning")
                    continue
                sections = build_session_sections(submission, snapshot, target, row_issues)
                if sections is None:
                    report.skipped_rows += 1
                    report.errors.extend(issue for issue in row_issues if issue.severity == "error")
                    report.warnings.extend(issue for issue in row_issues if issue.severity == "warning")
                    continue
                report.processed_rows += 1
                report.warnings.extend(issue for issue in row_issues if issue.severity == "warning")
                report.errors.extend(issue for issue in row_issues if issue.severity == "error")
            verification = verify_target_state(target_conn, args.target_schema, report)
            write_report(report_path, report, verification)
            print_summary(report, verification)
            return 0

        # Apply the actual backfill. Process each submission in its own transaction so one bad row does not poison the batch.
        for row in selected_rows:
            row_issues: list[Issue] = []
            submission = build_submission_record(row, target, row_issues)
            if submission is None:
                report.skipped_rows += 1
                report.errors.extend(issue for issue in row_issues if issue.severity == "error")
                report.warnings.extend(issue for issue in row_issues if issue.severity == "warning")
                for issue in row_issues:
                    log_issue(
                        target_conn,
                        action=args.log_action,
                        message=issue.message,
                        payload={"submission_ref": issue.submission_ref, **issue.details},
                        user="migration-script",
                    )
                continue
            sections = build_session_sections(submission, snapshot, target, row_issues)
            if sections is None:
                report.skipped_rows += 1
                report.errors.extend(issue for issue in row_issues if issue.severity == "error")
                report.warnings.extend(issue for issue in row_issues if issue.severity == "warning")
                log_issue(
                    target_conn,
                    action=args.log_action,
                    message=f"Skipped structured backfill for {submission['submission_ref']} because required fields were missing",
                    payload={"source_schema": submission["source_schema"]},
                    user="migration-script",
                )
                continue

            try:
                with target_conn.transaction():
                    apply_submission_backfill(target_conn, args.target_schema, target, submission, sections, report, row_issues)
                report.processed_rows += 1
            except Exception as exc:  # pragma: no cover - defensive migration guard
                report.errors.append(
                    Issue(
                        severity="error",
                        submission_ref=submission["submission_ref"],
                        message=str(exc),
                        details={"source_schema": submission["source_schema"]},
                        source_schema=str(submission["source_schema"]),
                    )
                )
                log_issue(
                    target_conn,
                    action=args.log_action,
                    message=f"Failed to backfill {submission['submission_ref']}: {exc}",
                    payload={"source_schema": submission["source_schema"]},
                    user="migration-script",
                )
                continue

            for issue in row_issues:
                if issue.severity == "warning":
                    report.warnings.append(issue)
                    log_issue(
                        target_conn,
                        action=args.log_action,
                        message=issue.message,
                        payload={"submission_ref": issue.submission_ref, **issue.details},
                        user="migration-script",
                    )
                elif issue.severity == "error":
                    report.errors.append(issue)
                    log_issue(
                        target_conn,
                        action=args.log_action,
                        message=issue.message,
                        payload={"submission_ref": issue.submission_ref, **issue.details},
                        user="migration-script",
                    )

        verification = verify_target_state(target_conn, args.target_schema, report)
        if args.verify:
            # The verification query set already captures the main integrity checks.
            pass

        write_report(report_path, report, verification)
        print_summary(report, verification)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
