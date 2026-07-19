from __future__ import annotations

import base64
import json
import logging
from typing import Any
from urllib import error, request

from app.core.config import get_ocr_config_status, get_settings
from app.models.driver import Driver
from app.models.event import Event
from app.models.run_group import RunGroup
from app.models.submission import Submission
from app.models.vehicle import Vehicle
from app.services import image_analysis_service


logger = logging.getLogger(__name__)


normalize_image_analysis_result = image_analysis_service.normalize_image_analysis_result


def _normalize_text(value: Any) -> str | None:
    if value is None:
        return None

    normalized = str(value).strip()
    return normalized or None


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _normalize_submission_image_urls(submission: Submission) -> list[str]:
    payload = _dict_or_empty(getattr(submission, "payload", None))
    image_urls: list[str] = []

    def append_image_url(value: Any) -> None:
        normalized_value = _normalize_text(value)
        if not normalized_value or normalized_value in image_urls:
            return
        image_urls.append(normalized_value)

    for candidate in (
        getattr(submission, "image_url", None),
        payload.get("image_urls"),
        payload.get("imageUrls"),
        _dict_or_empty(payload.get("media")).get("image_urls"),
    ):
        if isinstance(candidate, list):
            for item in candidate:
                append_image_url(item)
        else:
            append_image_url(candidate)

    return image_urls


MAKE_SETUP_CORNERS = ("LF", "RF", "LR", "RR")
ALIGNMENT_CORNER_SUFFIX = {
    "LF": "fl",
    "RF": "fr",
    "LR": "rl",
    "RR": "rr",
}
SHOCK_SETUP_CORNER_SUFFIX = {
    "LF": "lf",
    "RF": "rf",
    "LR": "lr",
    "RR": "rr",
}
CORNER_KEY_ALIASES = {
    "LF": ("LF", "lf", "front_left", "frontLeft", "fl", "FL", "left_front", "leftFront"),
    "RF": ("RF", "rf", "front_right", "frontRight", "fr", "FR", "right_front", "rightFront"),
    "LR": ("LR", "lr", "rear_left", "rearLeft", "rl", "RL", "left_rear", "leftRear"),
    "RR": ("RR", "rr", "rear_right", "rearRight", "right_rear", "rightRear"),
}


def _first_present(value: Any, *keys: str) -> Any:
    mapping = _dict_or_empty(value)
    for key in keys:
        if key in mapping:
            return mapping.get(key)
    return None


def _corner_value(values: Any, corner: str) -> Any:
    return _first_present(values, *CORNER_KEY_ALIASES.get(corner, (corner,)))


def _extension_for_mime_type(mime_type: Any) -> str:
    normalized_mime = _normalize_text(mime_type)
    if normalized_mime == "image/jpg":
        normalized_mime = "image/jpeg"

    return {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
    }.get(normalized_mime or "", "bin")


def _is_make_setup_payload(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False

    schema_version = _normalize_text(payload.get("schema_version"))
    return bool(schema_version and schema_version.startswith("smr_ocr_setup_v"))


def _is_compact_shock_setup_payload(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False

    document_type = _normalize_text(payload.get("type") or payload.get("document_type"))
    if document_type not in {"shock_setup_sheet", "shock_setup"}:
        return False

    return any(
        isinstance(payload.get(corner), dict) or isinstance(payload.get(corner.lower()), dict)
        for corner in MAKE_SETUP_CORNERS
    )


def _is_flexible_setup_payload(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False

    if _is_make_setup_payload(payload) or _is_compact_shock_setup_payload(payload):
        return False

    setup_payload = _dict_or_empty(payload.get("setup"))
    candidate = (
        setup_payload
        if any(
            key in setup_payload
            for key in (
                "camber",
                "toe",
                "tire_pressure",
                "weight",
                "corner_weight",
                "height",
                "ride_height",
                "wing",
                "aero",
                "springs",
                "bump_stops",
                "wheel_base",
                "roll_bar",
                "fuel_liters",
                "fuel",
            )
        )
        else payload
    )

    structural_keys = (
        "camber",
        "toe",
        "tire_pressure",
        "weight",
        "corner_weight",
        "height",
        "ride_height",
        "after_session_set_down",
        "post_session",
        "wing",
        "aero",
        "springs",
        "bump_stops",
        "wheel_base",
        "roll_bar",
        "fuel_liters",
        "fuel",
    )
    structural_matches = sum(1 for key in structural_keys if key in candidate)
    type_hint_present = any(key in payload for key in ("sheet_type", "document_type", "type"))
    session_matches = sum(1 for key in ("date", "time", "driver", "track", "team_name", "series", "car_number") if key in payload)

    return (
        structural_matches >= 2 and (type_hint_present or session_matches >= 2)
    ) or (
        type_hint_present and session_matches >= 2
    )


def _has_meaningful_value(value: Any) -> bool:
    if value is None:
        return False

    if isinstance(value, str):
        return bool(value.strip())

    if isinstance(value, (int, float, bool)):
        return True

    if isinstance(value, dict):
        return any(_has_meaningful_value(item) for item in value.values())

    if isinstance(value, list):
        return any(_has_meaningful_value(item) for item in value)

    return bool(str(value).strip())


def _append_unique(values: list[str], value: Any) -> None:
    normalized = _normalize_text(value)
    if normalized and normalized not in values:
        values.append(normalized)


def _collect_notes(value: Any) -> list[str]:
    notes: list[str] = []
    if isinstance(value, list):
        for item in value:
            _append_unique(notes, item)
        return notes

    normalized = _normalize_text(value)
    if not normalized:
        return notes

    for line in normalized.splitlines():
        _append_unique(notes, line)
    return notes


def _join_non_empty(values: list[Any], separator: str = " / ") -> str | None:
    normalized_values = [_normalize_text(value) for value in values]
    if not any(normalized_values):
        return None
    return separator.join(value or "" for value in normalized_values)


def _format_directional_value(value: Any) -> str | None:
    if isinstance(value, dict):
        numeric_value = _normalize_text(value.get("value"))
        direction = _normalize_text(value.get("direction"))
        if direction:
            direction = direction.lower()
        return _join_non_empty([numeric_value, direction], separator=" ")

    return _normalize_text(value)


def _format_corner_values(values: Any) -> str | None:
    return _join_non_empty([_corner_value(values, corner) for corner in MAKE_SETUP_CORNERS])


def _format_post_session_toe(values: Any) -> str | None:
    return _join_non_empty(
        [
            _format_directional_value(_corner_value(values, "LF")),
            _format_directional_value(_corner_value(values, "RF")),
            _format_directional_value(_corner_value(values, "LR")),
            _format_directional_value(_corner_value(values, "RR")),
        ]
    )


def _format_post_session_shocks(values: Any) -> str | None:
    mapping = _dict_or_empty(values)
    front = _dict_or_empty(mapping.get("front"))
    rear = _dict_or_empty(mapping.get("rear"))
    segments: list[str] = []

    front_value = _join_non_empty([front.get("bump"), front.get("rebound")]) or _normalize_text(mapping.get("front"))
    rear_value = _join_non_empty([rear.get("bump"), rear.get("rebound")]) or _normalize_text(mapping.get("rear"))
    if not front_value and not rear_value:
        front_value = _join_non_empty([_corner_value(mapping, "LF"), _corner_value(mapping, "RF")])
        rear_value = _join_non_empty([_corner_value(mapping, "LR"), _corner_value(mapping, "RR")])
    if front_value:
        segments.append(f"front {front_value}")
    if rear_value:
        segments.append(f"rear {rear_value}")

    return " | ".join(segments) if segments else None


def _format_reference_toe_slots(values: Any) -> str | None:
    mapping = _dict_or_empty(values)
    slot_1 = _normalize_text(mapping.get("slot_1"))
    slot_2 = _normalize_text(mapping.get("slot_2"))
    if not slot_1 and not slot_2:
        return None

    suffix = "" if bool(mapping.get("meaning_confirmed")) else " (meaning unconfirmed)"
    return f"Reference toe slots: 1={slot_1 or '?'} 2={slot_2 or '?'}{suffix}"


def _build_reference_setup_notes(reference_setup: Any) -> list[str]:
    mapping = _dict_or_empty(reference_setup)
    if not _has_meaningful_value(mapping):
        return []

    notes: list[str] = []
    toe_slots = _format_reference_toe_slots(mapping.get("toe_slots"))
    if toe_slots:
        notes.append(toe_slots)

    camber = _format_corner_values(mapping.get("camber"))
    if camber:
        notes.append(f"Reference camber LF/RF/LR/RR: {camber}")

    ride_height_map = _dict_or_empty(mapping.get("ride_height"))
    ride_height = _format_corner_values(ride_height_map)
    if ride_height:
        unit = _normalize_text(ride_height_map.get("unit"))
        notes.append(f"Reference ride height LF/RF/LR/RR{f' ({unit})' if unit else ''}: {ride_height}")

    weight_map = _dict_or_empty(mapping.get("weight"))
    weight = _format_corner_values(weight_map)
    if weight:
        unit = _normalize_text(weight_map.get("unit"))
        notes.append(f"Reference weight LF/RF/LR/RR{f' ({unit})' if unit else ''}: {weight}")

    return notes


def _build_baseline_shock_notes(values: Any) -> list[str]:
    mapping = _dict_or_empty(values)
    if not _has_meaningful_value(mapping):
        return []

    notes: list[str] = []
    package_name = _normalize_text(mapping.get("package_name"))
    if package_name:
        notes.append(f"Baseline shocks package: {package_name}")

    for corner in MAKE_SETUP_CORNERS:
        corner_map = _dict_or_empty(mapping.get(corner))
        if not _has_meaningful_value(corner_map):
            continue

        parts = []
        for label, key in (
            ("HSR", "HSR"),
            ("LSR", "LSR"),
            ("HBS", "HBS"),
            ("LSB", "LSB"),
            ("total", "setup_total"),
        ):
            value = _normalize_text(corner_map.get(key))
            if value:
                parts.append(f"{label} {value}")

        if parts:
            notes.append(f"Baseline {corner}: {', '.join(parts)}")

    return notes


def _build_session_text(session: dict[str, Any]) -> str | None:
    date_value = _normalize_text(session.get("date_raw")) or _normalize_text(session.get("date_iso"))
    time_value = _normalize_text(session.get("time_raw")) or _normalize_text(session.get("time_24h"))
    car_number = _normalize_text(session.get("car_number"))
    series = _normalize_text(session.get("series"))
    team = _normalize_text(session.get("team"))

    session_bits = [date_value, time_value, car_number, series, team]
    normalized = [value for value in session_bits if value]
    return " | ".join(normalized) if normalized else None


def _build_make_waiting_analysis(message: str | None = None) -> dict[str, Any]:
    waiting_message = _normalize_text(message) or "Submitted to Make.com. Waiting for the OCR draft response."
    return {
        "status": "submitted_to_make",
        "message": waiting_message,
        "document_type": "unknown",
        "confidence": 0.0,
        "has_values": False,
        "summary": waiting_message,
        "extracted_text": "",
        "raw_text": "",
        "metadata": {},
        "raw_evidence": {
            "visible_text": [],
            "detected_grids": [],
            "detected_labels": [],
            "unmapped_values": [],
            "quality_flags": [],
            "template_labels": [],
        },
        "field_evidence": [],
        "normalized_sections": {},
        "preprocessing": {},
        "setup": {},
        "warnings": [],
        "recommended_review_status": "PENDING",
        "parser_version": None,
        "model": "make.com",
        "fallback_model_used": False,
    }


def _adapt_compact_shock_setup_payload(payload: dict[str, Any]) -> dict[str, Any]:
    raw_evidence = {
        "visible_text": [],
        "detected_grids": [],
        "detected_labels": [],
        "unmapped_values": [],
        "quality_flags": [],
        "template_labels": [],
    }
    warnings: list[str] = []
    notes: list[str] = []
    shock_setup: dict[str, dict[str, str | None]] = {}

    for warning in payload.get("warnings") if isinstance(payload.get("warnings"), list) else []:
        _append_unique(warnings, warning)
        _append_unique(raw_evidence["quality_flags"], warning)

    raw_notes = payload.get("notes")
    if isinstance(raw_notes, list):
        for note in raw_notes:
            _append_unique(notes, note)
    else:
        _append_unique(notes, raw_notes)

    for corner in MAKE_SETUP_CORNERS:
        raw_corner = _dict_or_empty(payload.get(corner) or payload.get(corner.lower()))
        normalized_corner = {
            "position": corner,
            "hsr": _normalize_text(raw_corner.get("HSR") or raw_corner.get("hsr")),
            "lsr": _normalize_text(raw_corner.get("LSR") or raw_corner.get("lsr")),
            "hsb": _normalize_text(
                raw_corner.get("HBS")
                or raw_corner.get("HSB")
                or raw_corner.get("hbs")
                or raw_corner.get("hsb")
            ),
            "lsb": _normalize_text(raw_corner.get("LSB") or raw_corner.get("lsb")),
            "total_setup": _normalize_text(
                raw_corner.get("SETUP")
                or raw_corner.get("setup_total")
                or raw_corner.get("setup")
                or raw_corner.get("total_setup")
            ),
        }
        shock_setup[SHOCK_SETUP_CORNER_SUFFIX[corner]] = normalized_corner

        corner_summary = _join_non_empty(
            [
                normalized_corner["hsr"],
                normalized_corner["lsr"],
                normalized_corner["hsb"],
                normalized_corner["lsb"],
                normalized_corner["total_setup"],
            ]
        )
        if corner_summary:
            _append_unique(raw_evidence["visible_text"], f"{corner} {corner_summary}")

    document_type = _normalize_text(payload.get("type") or payload.get("document_type")) or "shock_setup_sheet"
    confidence = payload.get("confidence") if isinstance(payload.get("confidence"), (int, float)) else 0.9
    extracted_text = _normalize_text(payload.get("extracted_text")) or _join_non_empty(
        raw_evidence["visible_text"],
        separator="\n",
    )

    adapted = {
        "status": _normalize_text(payload.get("status")) or "review_required",
        "document_type": "shock_setup_sheet" if document_type == "shock_setup" else document_type,
        "template_name": _normalize_text(payload.get("template_name")) or "shock_setup",
        "confidence": confidence,
        "has_values": _has_meaningful_value(shock_setup),
        "summary": _normalize_text(payload.get("summary")) or "Shock setup values detected from Make.com payload.",
        "extracted_text": extracted_text,
        "metadata": {
            "driver_text": _normalize_text(payload.get("driver")) or _normalize_text(payload.get("driver_text")),
            "track_text": _normalize_text(payload.get("track")) or _normalize_text(payload.get("track_text")),
            "session_text": _normalize_text(payload.get("session")) or _normalize_text(payload.get("session_text")),
        },
        "raw_evidence": raw_evidence,
        "field_evidence": [],
        "setup": {
            "alignment": {},
            "pressures": {},
            "suspension": {},
            "sheet_fields": {},
            "post_session": {},
            "shock_setup": shock_setup,
            "notes": notes,
        },
        "warnings": warnings,
        "recommended_review_status": _normalize_text(payload.get("recommended_review_status")) or "PENDING",
        "parser_version": _normalize_text(payload.get("schema_version")),
        "model": _normalize_text(payload.get("model")) or "make.com",
        "fallback_model_used": bool(payload.get("fallback_model_used")),
    }

    return adapted


def _adapt_flexible_setup_payload(payload: dict[str, Any]) -> dict[str, Any]:
    setup_payload = _dict_or_empty(payload.get("setup"))
    core_setup = (
        setup_payload
        if any(
            key in setup_payload
            for key in (
                "camber",
                "toe",
                "tire_pressure",
                "weight",
                "corner_weight",
                "height",
                "ride_height",
                "wing",
                "aero",
                "springs",
                "bump_stops",
                "wheel_base",
                "roll_bar",
                "fuel_liters",
                "fuel",
            )
        )
        else payload
    )
    post_session = _dict_or_empty(
        _first_present(
            payload,
            "after_session_set_down",
            "post_session",
            "after_session",
        )
        or _first_present(
            core_setup,
            "after_session_set_down",
            "post_session",
            "after_session",
        )
    )

    session = {
        "team": _normalize_text(_first_present(payload, "team_name", "team")),
        "series": _normalize_text(_first_present(payload, "series")),
        "car_number": _normalize_text(_first_present(payload, "car_number", "carNo", "car_no")),
        "date_raw": _normalize_text(_first_present(payload, "date", "date_raw")),
        "time_raw": _normalize_text(_first_present(payload, "time", "time_raw")),
        "driver": _normalize_text(_first_present(payload, "driver", "driver_name")),
        "track": _normalize_text(_first_present(payload, "track")),
    }

    raw_evidence = {
        "visible_text": [],
        "detected_grids": [],
        "detected_labels": [],
        "unmapped_values": [],
        "quality_flags": [],
        "template_labels": [],
    }
    warnings: list[str] = []
    notes = _collect_notes(_first_present(payload, "notes", "notes_block", "note"))

    original_type = _normalize_text(_first_present(payload, "sheet_type", "document_type", "type"))
    template_name = original_type or "race_setup_packet"
    session_text = _build_session_text(session)

    if original_type:
        _append_unique(raw_evidence["template_labels"], original_type)
    for visible_line in (session.get("driver"), session.get("track"), session_text):
        _append_unique(raw_evidence["visible_text"], visible_line)
    for note in notes:
        _append_unique(raw_evidence["visible_text"], note)

    camber_map = _dict_or_empty(_first_present(core_setup, "camber"))
    toe_map = _dict_or_empty(_first_present(core_setup, "toe"))
    tire_pressure = _dict_or_empty(_first_present(core_setup, "tire_pressure", "pressures"))
    ride_height_map = _dict_or_empty(_first_present(core_setup, "height", "ride_height"))
    corner_weight_map = _dict_or_empty(_first_present(core_setup, "weight", "corner_weight"))
    roll_bar_map = _dict_or_empty(_first_present(core_setup, "roll_bar"))
    anti_roll_bar_map = _dict_or_empty(_first_present(core_setup, "anti_roll_bar", "arb"))
    wheel_base_map = _dict_or_empty(_first_present(core_setup, "wheel_base", "wheelbase"))
    wing_map = _dict_or_empty(_first_present(core_setup, "wing", "aero"))
    springs_map = _dict_or_empty(_first_present(core_setup, "springs"))
    bump_stops_map = _dict_or_empty(_first_present(core_setup, "bump_stops"))
    bump_stop_height_map = _dict_or_empty(_first_present(core_setup, "bump_stop_height"))
    static_ride_height_map = _dict_or_empty(_first_present(core_setup, "static_ride_height"))
    top_level_shocks = _dict_or_empty(_first_present(core_setup, "shocks"))

    alignment: dict[str, Any] = {}
    for corner, suffix in ALIGNMENT_CORNER_SUFFIX.items():
        alignment[f"camber_{suffix}"] = _normalize_text(_corner_value(camber_map, corner))
        alignment[f"rh_{suffix}"] = _normalize_text(_corner_value(ride_height_map, corner))

    alignment["toe_fl"] = _format_directional_value(_corner_value(toe_map, "LF"))
    alignment["toe_fr"] = _format_directional_value(_corner_value(toe_map, "RF"))
    alignment["toe_rl"] = _format_directional_value(_corner_value(toe_map, "LR"))
    alignment["toe_rr"] = _format_directional_value(_corner_value(toe_map, "RR"))

    pressures = {
        "cold_fl": _normalize_text(_corner_value(tire_pressure, "LF")),
        "cold_fr": _normalize_text(_corner_value(tire_pressure, "RF")),
        "cold_rl": _normalize_text(_corner_value(tire_pressure, "LR")),
        "cold_rr": _normalize_text(_corner_value(tire_pressure, "RR")),
    }

    sheet_fields = {
        "fuel_liters": _normalize_text(_first_present(core_setup, "fuel_liters", "fuel")),
        "driver_weight_lbs": _normalize_text(_first_present(core_setup, "driver_weight_lbs", "driver_weight")),
        "scale_weight_lbs": _normalize_text(_first_present(core_setup, "total_weight_lbs", "scale_weight_lbs")),
        "percentage_box_weight_lbs": _normalize_text(_first_present(core_setup, "percentage_box_weight_lbs")),
        "cross_weight_percent": _normalize_text(_first_present(core_setup, "cross_weight_percent", "percentage")),
        "springs_front": _normalize_text(_first_present(springs_map, "front")),
        "springs_rear": _normalize_text(_first_present(springs_map, "rear")),
        "roll_bar_text": _join_non_empty(
            [
                _first_present(roll_bar_map, "front"),
                _first_present(roll_bar_map, "rear"),
            ]
        ),
        "arb_front_text": _join_non_empty(
            [
                _first_present(anti_roll_bar_map, "front"),
                _first_present(anti_roll_bar_map, "LF", "lf", "front_left"),
                _first_present(anti_roll_bar_map, "RF", "rf", "front_right"),
            ],
            separator=" / ",
        ),
        "arb_rear_text": _join_non_empty(
            [
                _first_present(anti_roll_bar_map, "rear"),
                _first_present(anti_roll_bar_map, "LR", "lr", "rear_left"),
                _first_present(anti_roll_bar_map, "RR", "rr", "rear_right"),
            ],
            separator=" / ",
        ),
        "wheelbase_left_mm": _normalize_text(_first_present(wheel_base_map, "left")),
        "wheelbase_right_mm": _normalize_text(_first_present(wheel_base_map, "right")),
        "wing_rake_deg": _normalize_text(_first_present(wing_map, "rake_deg", "rake_degrees")),
        "wing_angle_deg": _normalize_text(_first_present(wing_map, "wing_deg", "wing_degrees", "angle_deg")),
        "wing_gurney_mm": _normalize_text(_first_present(wing_map, "gurney_mm")),
        "wicker_text": _normalize_text(_first_present(wing_map, "wicker_mm", "wicker")),
        "bump_stops_front": _normalize_text(_first_present(bump_stops_map, "front")),
        "bump_stops_rear": _normalize_text(_first_present(bump_stops_map, "rear")),
        "spacer_text": _normalize_text(_first_present(core_setup, "spacer_mm", "spacer")),
        "bump_text": _normalize_text(_first_present(core_setup, "bump"))
        or _normalize_text(_first_present(_first_present(core_setup, "main_bump_rebound"), "bump")),
        "rebound_text": _normalize_text(_first_present(core_setup, "rebound"))
        or _normalize_text(_first_present(_first_present(core_setup, "main_bump_rebound"), "rebound")),
        "corner_weight_text": _format_corner_values(corner_weight_map),
        "static_ride_height_text": _join_non_empty(
            [
                _first_present(static_ride_height_map, "left"),
                _first_present(static_ride_height_map, "right"),
            ]
        ),
        "bump_stop_height_text": _join_non_empty(
            [
                _first_present(bump_stop_height_map, "left"),
                _first_present(bump_stop_height_map, "right"),
            ]
        ),
        "fuel_pumped_out_liters": _normalize_text(
            _first_present(payload, "fuel_pumped_out_liters")
            if _first_present(payload, "fuel_pumped_out_liters") is not None
            else _first_present(post_session, "fuel_pumped_out_liters")
        ),
        "notes_block": _join_non_empty(notes, separator="\n"),
    }

    post_session_map = {
        "camber_text": _format_corner_values(_first_present(post_session, "camber")),
        "toe_text": _format_post_session_toe(_first_present(post_session, "toe")),
        "weight_text": _format_corner_values(_first_present(post_session, "weight", "corner_weight")),
        "height_text": _format_corner_values(_first_present(post_session, "height", "ride_height")),
        "shocks_text": _format_post_session_shocks(_first_present(post_session, "shocks")),
    }

    suspension: dict[str, Any] = {}
    shock_setup: dict[str, dict[str, str | None]] = {}
    for corner, alignment_suffix in ALIGNMENT_CORNER_SUFFIX.items():
        shock_map = _dict_or_empty(_corner_value(top_level_shocks, corner))
        shock_setup_suffix = SHOCK_SETUP_CORNER_SUFFIX[corner]
        suspension[f"bump_{alignment_suffix}"] = _normalize_text(_first_present(shock_map, "compression", "bump"))
        suspension[f"rebound_{alignment_suffix}"] = _normalize_text(_first_present(shock_map, "rebound"))
        suspension[f"hsr_{alignment_suffix}"] = _normalize_text(_first_present(shock_map, "HSR", "hsr"))
        suspension[f"lsr_{alignment_suffix}"] = _normalize_text(_first_present(shock_map, "LSR", "lsr"))
        suspension[f"hsb_{alignment_suffix}"] = _normalize_text(
            _first_present(shock_map, "HBS", "HSB", "hbs", "hsb")
        )
        suspension[f"lsb_{alignment_suffix}"] = _normalize_text(_first_present(shock_map, "LSB", "lsb"))
        if _has_meaningful_value(shock_map):
            shock_setup[shock_setup_suffix] = {
                "position": corner,
                "hsr": _normalize_text(_first_present(shock_map, "HSR", "hsr")),
                "lsr": _normalize_text(_first_present(shock_map, "LSR", "lsr")),
                "hsb": _normalize_text(_first_present(shock_map, "HBS", "HSB", "hbs", "hsb")),
                "lsb": _normalize_text(_first_present(shock_map, "LSB", "lsb")),
                "total_setup": _normalize_text(
                    _first_present(shock_map, "SETUP", "setup_total", "setup", "total_setup")
                ),
            }

    inferred_document_type = "printed_form_with_values"
    has_primary_setup_values = _has_meaningful_value(
        {
            "camber": camber_map,
            "toe": toe_map,
            "tire_pressure": tire_pressure,
            "ride_height": ride_height_map,
            "corner_weight": corner_weight_map,
            "sheet_fields": sheet_fields,
        }
    )
    has_shock_values = _has_meaningful_value(top_level_shocks)
    has_post_session_values = _has_meaningful_value(post_session)

    if original_type in {"shock_setup_sheet", "shock_setup"} and has_shock_values and not has_primary_setup_values:
        inferred_document_type = "shock_setup_sheet"
    elif not has_primary_setup_values and not has_shock_values and notes:
        inferred_document_type = "mixed_session_notes"
    elif not has_primary_setup_values and not has_shock_values and not notes and not has_post_session_values:
        inferred_document_type = "blank_setup_sheet"

    for warning in warnings:
        _append_unique(raw_evidence["quality_flags"], warning)

    adapted = {
        "status": _normalize_text(payload.get("status")) or "review_required",
        "document_type": inferred_document_type,
        "template_name": template_name,
        "confidence": payload.get("confidence") if isinstance(payload.get("confidence"), (int, float)) else 0.9,
        "has_values": has_primary_setup_values or has_shock_values or has_post_session_values,
        "summary": _normalize_text(payload.get("summary")) or "Flexible OCR setup payload adapted for review.",
        "extracted_text": _join_non_empty(notes, separator="\n") or session_text,
        "metadata": {
            "driver_text": _normalize_text(session.get("driver")),
            "track_text": _normalize_text(session.get("track")),
            "session_text": session_text,
            "session_notes": _join_non_empty(notes, separator="\n") or "",
        },
        "raw_evidence": raw_evidence,
        "field_evidence": [],
        "setup": {
            "alignment": alignment,
            "pressures": pressures,
            "suspension": suspension,
            "sheet_fields": sheet_fields,
            "post_session": post_session_map,
            "shock_setup": shock_setup,
            "notes": notes,
        },
        "warnings": warnings,
        "recommended_review_status": _normalize_text(payload.get("recommended_review_status")) or "PENDING",
        "parser_version": _normalize_text(payload.get("schema_version")) or "smr_flexible_ocr_v1",
        "model": _normalize_text(payload.get("model")) or "make.com",
        "fallback_model_used": bool(payload.get("fallback_model_used")),
    }

    return adapted


def _adapt_make_setup_payload(payload: dict[str, Any]) -> dict[str, Any]:
    session = _dict_or_empty(payload.get("session"))
    setup = _dict_or_empty(payload.get("setup"))
    shocks = _dict_or_empty(payload.get("shocks"))
    baseline_shocks = _dict_or_empty(payload.get("baseline_shocks"))
    post_session = _dict_or_empty(payload.get("post_session"))
    reference_setup = _dict_or_empty(payload.get("reference_setup"))
    quality_control = _dict_or_empty(payload.get("quality_control"))
    source_documents = payload.get("source_documents") if isinstance(payload.get("source_documents"), list) else []

    raw_evidence = {
        "visible_text": [],
        "detected_grids": [],
        "detected_labels": [],
        "unmapped_values": [],
        "quality_flags": [],
        "template_labels": [],
    }
    warnings: list[str] = []
    notes: list[str] = []

    for note in payload.get("notes") if isinstance(payload.get("notes"), list) else []:
        _append_unique(notes, note)

    for note in _build_reference_setup_notes(reference_setup):
        _append_unique(notes, note)
    for note in _build_baseline_shock_notes(baseline_shocks):
        _append_unique(notes, note)

    for warning in quality_control.get("warnings") if isinstance(quality_control.get("warnings"), list) else []:
        _append_unique(warnings, warning)
    for unresolved in quality_control.get("unresolved_fields") if isinstance(quality_control.get("unresolved_fields"), list) else []:
        _append_unique(warnings, unresolved)

    if _has_meaningful_value(reference_setup):
        _append_unique(warnings, "Reference setup preserved in notes for manual review")
    if _has_meaningful_value(baseline_shocks):
        _append_unique(warnings, "Baseline shocks preserved in notes for manual review")
    if bool(quality_control.get("mapping_inferred")):
        _append_unique(warnings, "Mapping inferred from Make OCR schema")

    session_text = _build_session_text(session)
    for visible_line in (session.get("driver"), session.get("track"), session_text):
        _append_unique(raw_evidence["visible_text"], visible_line)
    for note in notes:
        _append_unique(raw_evidence["visible_text"], note)
    for warning in warnings:
        _append_unique(raw_evidence["quality_flags"], warning)

    alignment: dict[str, Any] = {}
    camber_map = _dict_or_empty(setup.get("camber"))
    ride_height_map = _dict_or_empty(setup.get("ride_height"))
    toe_map = _dict_or_empty(setup.get("toe"))
    for corner, suffix in ALIGNMENT_CORNER_SUFFIX.items():
        alignment[f"camber_{suffix}"] = _normalize_text(camber_map.get(corner))
        alignment[f"rh_{suffix}"] = _normalize_text(ride_height_map.get(corner))

    alignment["toe_fl"] = _format_directional_value(toe_map.get("front_left"))
    alignment["toe_fr"] = _format_directional_value(toe_map.get("front_right"))
    alignment["toe_rl"] = _format_directional_value(toe_map.get("rear_left"))
    alignment["toe_rr"] = _format_directional_value(toe_map.get("rear_right"))

    tire_pressure = _dict_or_empty(setup.get("tire_pressure"))
    pressures = {
        "cold_fl": _normalize_text(tire_pressure.get("LF")),
        "cold_fr": _normalize_text(tire_pressure.get("RF")),
        "cold_rl": _normalize_text(tire_pressure.get("LR")),
        "cold_rr": _normalize_text(tire_pressure.get("RR")),
    }

    sheet_fields = {
        "fuel_liters": _normalize_text(setup.get("fuel_liters")),
        "driver_weight_lbs": _normalize_text(setup.get("driver_weight_lbs")),
        "scale_weight_lbs": _normalize_text(setup.get("total_weight_lbs")),
        "percentage_box_weight_lbs": _normalize_text(setup.get("percentage_box_weight_lbs")),
        "cross_weight_percent": _normalize_text(setup.get("cross_weight_percent")),
        "springs_front": _normalize_text(_dict_or_empty(setup.get("springs")).get("front")),
        "springs_rear": _normalize_text(_dict_or_empty(setup.get("springs")).get("rear")),
        "roll_bar_text": _join_non_empty(
            [
                _dict_or_empty(setup.get("roll_bar")).get("front"),
                _dict_or_empty(setup.get("roll_bar")).get("rear"),
            ]
        ),
        "arb_front_text": _join_non_empty(
            [
                _dict_or_empty(setup.get("anti_roll_bar")).get("front"),
                _dict_or_empty(setup.get("anti_roll_bar")).get("LF"),
                _dict_or_empty(setup.get("anti_roll_bar")).get("RF"),
            ],
            separator=" / ",
        ),
        "arb_rear_text": _join_non_empty(
            [
                _dict_or_empty(setup.get("anti_roll_bar")).get("rear"),
                _dict_or_empty(setup.get("anti_roll_bar")).get("LR"),
                _dict_or_empty(setup.get("anti_roll_bar")).get("RR"),
            ],
            separator=" / ",
        ),
        "wheelbase_left_mm": _normalize_text(_dict_or_empty(setup.get("wheel_base")).get("left")),
        "wheelbase_right_mm": _normalize_text(_dict_or_empty(setup.get("wheel_base")).get("right")),
        "wing_rake_deg": _normalize_text(_dict_or_empty(setup.get("aero")).get("rake_deg")),
        "wing_angle_deg": _normalize_text(_dict_or_empty(setup.get("aero")).get("wing_deg")),
        "wing_gurney_mm": _normalize_text(_dict_or_empty(setup.get("aero")).get("gurney_mm")),
        "wicker_text": _normalize_text(_dict_or_empty(setup.get("aero")).get("wicker_mm")),
        "bump_stops_front": _normalize_text(_dict_or_empty(setup.get("bump_stops")).get("front")),
        "bump_stops_rear": _normalize_text(_dict_or_empty(setup.get("bump_stops")).get("rear")),
        "spacer_text": _normalize_text(setup.get("spacer_mm")),
        "bump_text": _normalize_text(_dict_or_empty(setup.get("main_bump_rebound")).get("bump")),
        "rebound_text": _normalize_text(_dict_or_empty(setup.get("main_bump_rebound")).get("rebound")),
        "corner_weight_text": _format_corner_values(_dict_or_empty(setup.get("corner_weight"))),
        "static_ride_height_text": _join_non_empty(
            [
                _dict_or_empty(setup.get("static_ride_height")).get("left"),
                _dict_or_empty(setup.get("static_ride_height")).get("right"),
            ]
        ),
        "bump_stop_height_text": _join_non_empty(
            [
                _dict_or_empty(setup.get("bump_stop_height")).get("left"),
                _dict_or_empty(setup.get("bump_stop_height")).get("right"),
            ]
        ),
        "fuel_pumped_out_liters": _normalize_text(post_session.get("fuel_pumped_out_liters")),
        "notes_block": _join_non_empty(notes, separator="\n"),
    }

    post_session_map = {
        "camber_text": _format_corner_values(post_session.get("camber")),
        "toe_text": _format_post_session_toe(post_session.get("toe")),
        "weight_text": _format_corner_values(_dict_or_empty(post_session.get("corner_weight"))),
        "height_text": _format_corner_values(_dict_or_empty(post_session.get("ride_height"))),
        "shocks_text": _format_post_session_shocks(post_session.get("shocks")),
    }

    suspension: dict[str, Any] = {}
    shock_setup = {}
    for corner, alignment_suffix in ALIGNMENT_CORNER_SUFFIX.items():
        shock_map = _dict_or_empty(shocks.get(corner))
        shock_setup_suffix = SHOCK_SETUP_CORNER_SUFFIX[corner]
        suspension[f"bump_{alignment_suffix}"] = _normalize_text(shock_map.get("compression"))
        suspension[f"rebound_{alignment_suffix}"] = _normalize_text(shock_map.get("rebound"))
        suspension[f"hsr_{alignment_suffix}"] = _normalize_text(shock_map.get("HSR"))
        suspension[f"lsr_{alignment_suffix}"] = _normalize_text(shock_map.get("LSR"))
        suspension[f"hsb_{alignment_suffix}"] = _normalize_text(shock_map.get("HBS"))
        suspension[f"lsb_{alignment_suffix}"] = _normalize_text(shock_map.get("LSB"))
        shock_setup[shock_setup_suffix] = {
            "position": "",
            "hsr": _normalize_text(shock_map.get("HSR")),
            "lsr": _normalize_text(shock_map.get("LSR")),
            "hsb": _normalize_text(shock_map.get("HBS")),
            "lsb": _normalize_text(shock_map.get("LSB")),
            "total_setup": _normalize_text(shock_map.get("setup_total")),
        }

    inferred_document_type = "printed_form_with_values"
    if not _has_meaningful_value(setup) and _has_meaningful_value(shocks):
        inferred_document_type = "shock_setup_sheet"
    elif not _has_meaningful_value(setup) and not _has_meaningful_value(shocks) and notes:
        inferred_document_type = "mixed_session_notes"
    elif not _has_meaningful_value(setup) and not _has_meaningful_value(shocks) and not notes:
        inferred_document_type = "blank_setup_sheet"

    if len(source_documents) > 1:
        summary = f"Make OCR merged {len(source_documents)} source documents into a review draft."
    elif len(source_documents) == 1:
        summary = "Make OCR returned a single-image review draft."
    else:
        summary = "Make OCR returned a structured review draft."

    adapted = {
        "status": "review_required" if bool(quality_control.get("needs_review")) or warnings else None,
        "document_type": inferred_document_type,
        "template_name": _normalize_text(payload.get("document_type")) or "race_setup_packet",
        "confidence": quality_control.get("confidence"),
        "has_values": _has_meaningful_value(setup) or _has_meaningful_value(shocks) or _has_meaningful_value(post_session),
        "summary": summary,
        "extracted_text": _join_non_empty(notes, separator="\n") or session_text,
        "metadata": {
            "driver_text": _normalize_text(session.get("driver")),
            "track_text": _normalize_text(session.get("track")),
            "session_text": session_text,
            "session_notes": _join_non_empty(notes, separator="\n") or "",
        },
        "raw_evidence": raw_evidence,
        "field_evidence": [],
        "setup": {
            "alignment": alignment,
            "pressures": pressures,
            "suspension": suspension,
            "sheet_fields": sheet_fields,
            "post_session": post_session_map,
            "shock_setup": shock_setup,
            "notes": notes,
        },
        "warnings": warnings,
        "recommended_review_status": "PENDING",
        "parser_version": _normalize_text(payload.get("schema_version")),
        "model": "make.com",
        "fallback_model_used": False,
    }

    return adapted


def extract_normalized_inbound_analysis(payload: Any) -> dict[str, Any] | None:
    analysis = _extract_analysis_candidate(payload)
    if analysis is None:
        return None

    if _is_make_setup_payload(analysis):
        analysis = _adapt_make_setup_payload(analysis)
    elif _is_compact_shock_setup_payload(analysis):
        analysis = _adapt_compact_shock_setup_payload(analysis)
    elif _is_flexible_setup_payload(analysis):
        analysis = _adapt_flexible_setup_payload(analysis)

    normalized = normalize_image_analysis_result(analysis)
    if normalized is None:
        return None

    if not _normalize_text(normalized.get("model")):
        normalized["model"] = _normalize_text(_dict_or_empty(analysis).get("model")) or "make.com"

    if "fallback_model_used" not in normalized:
        normalized["fallback_model_used"] = False

    return normalized


def _build_make_ocr_payload(
    *,
    submission: Submission,
    event: Event,
    run_group: RunGroup,
    driver: Driver | None,
    vehicle: Vehicle | None,
    preprocessing_info: dict[str, Any] | list[dict[str, Any]],
) -> dict[str, Any] | None:
    context = _dict_or_empty(submission.payload).get("context")
    context_map = _dict_or_empty(context)
    run_group_value = getattr(run_group, "normalized", None) or getattr(run_group, "raw_text", None)
    if hasattr(run_group_value, "value"):
        run_group_value = run_group_value.value

    preprocessing_items = (
        preprocessing_info
        if isinstance(preprocessing_info, list)
        else [preprocessing_info]
    )
    image_payloads: list[dict[str, Any]] = []
    for index, item in enumerate(preprocessing_items):
        image_payload = _build_make_ocr_image_payload(item)
        if image_payload is None:
            logger.warning("Make OCR source image %s could not be prepared", index)
            return None
        image_payloads.append(image_payload)

    if not image_payloads:
        return None

    source_documents = [
        {
            "index": index,
            **image_payload,
        }
        for index, image_payload in enumerate(image_payloads)
    ]

    return {
        "correlation_id": getattr(submission, "correlation_id", None),
        "submission_ref": submission.submission_ref,
        "ocr_preview": True,
        "force_review_staging": True,
        "raw_text": _normalize_text(submission.raw_text),
        "image": image_payloads[0],
        "source_documents": source_documents,
        "context": context_map,
        "event": {
            "id": str(event.id),
            "name": _normalize_text(getattr(event, "name", None)),
            "track": _normalize_text(getattr(event, "track", None)),
        },
        "run_group": {
            "id": str(run_group.id),
            "code": _normalize_text(run_group_value),
            "raw_text": _normalize_text(getattr(run_group, "raw_text", None)),
        },
        "driver": {
            "id": str(driver.id) if driver is not None else None,
            "driver_id": _normalize_text(getattr(driver, "driver_id", None)),
            "name": _normalize_text(getattr(driver, "driver_name", None)),
        },
        "vehicle": {
            "id": str(vehicle.id) if vehicle is not None else None,
            "vehicle_id": _normalize_text(getattr(vehicle, "vehicle_id", None)),
            "make": _normalize_text(getattr(vehicle, "make", None)),
            "model": _normalize_text(getattr(vehicle, "model", None)),
        },
        "requested_response_shape": "sm_racing_image_analysis",
        "requested_parser_version": image_analysis_service.IMAGE_ANALYSIS_PARSER_VERSION,
    }


def _sanitize_filename_component(value: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in value.strip())
    return safe or "ocr_preview"


def _expected_make_ocr_base64_prefix(mime_type: str) -> str | None:
    return {
        "image/png": "iVBOR",
        "image/jpeg": "/9j/",
        "image/webp": "UklGR",
    }.get(mime_type)


def _validate_make_ocr_base64_string(encoded_image: str, mime_type: str) -> bool:
    if not encoded_image:
        logger.warning("Make OCR image payload produced an empty base64 string")
        return False

    if encoded_image.startswith("IMTString") or "IMTString" in encoded_image:
        logger.warning("Make OCR image payload included an IMT wrapper instead of clean base64")
        return False

    if ": " in encoded_image:
        logger.warning("Make OCR image payload included an unexpected label separator")
        return False

    if encoded_image.startswith("data:") or "data:image" in encoded_image:
        logger.warning("Make OCR image payload included an unexpected data URL prefix")
        return False

    expected_prefix = _expected_make_ocr_base64_prefix(mime_type)
    if expected_prefix and not encoded_image.startswith(expected_prefix):
        logger.warning(
            "Make OCR image payload did not start with the expected base64 prefix: mime_type=%s expected_prefix=%s actual_prefix=%s",
            mime_type,
            expected_prefix,
            encoded_image[:20],
        )
        return False

    return True


def _build_make_ocr_image_payload(preprocessing_info: dict[str, Any]) -> dict[str, Any] | None:
    selected_image_url = _normalize_text(preprocessing_info.get("selected_image_url"))
    if not selected_image_url:
        logger.warning("Make OCR image payload missing selected image URL")
        return None

    parsed = image_analysis_service._parse_data_url(selected_image_url)
    if not parsed:
        logger.warning("Make OCR image payload contained an invalid data URL")
        return None

    mime_type, image_bytes = parsed
    normalized_mime = _normalize_text("image/jpeg" if mime_type == "image/jpg" else mime_type)
    if not image_bytes:
        logger.warning("Make OCR image payload missing image bytes")
        return None
    if not normalized_mime:
        logger.warning("Make OCR image payload missing mime type")
        return None

    selected_variant = _normalize_text(preprocessing_info.get("selected_variant"))
    if not selected_variant:
        logger.warning("Make OCR image payload missing selected variant")
        return None

    extension = _extension_for_mime_type(normalized_mime)
    filename = _normalize_text(f"{_sanitize_filename_component(selected_variant)}.{extension}")
    if not filename:
        logger.warning("Make OCR image payload could not derive a filename")
        return None

    encoded_image = base64.b64encode(image_bytes).decode("utf-8")
    if not _validate_make_ocr_base64_string(encoded_image, normalized_mime):
        return None

    logger.info(
        "Make OCR base64 payload prepared: filename=%s mime_type=%s size_bytes=%s selected_variant=%s base64_length=%s base64_prefix=%s",
        filename,
        normalized_mime,
        len(image_bytes),
        selected_variant,
        len(encoded_image),
        encoded_image[:20],
    )

    return {
        "transport": "base64_json",
        "filename": filename,
        "mime_type": normalized_mime,
        "size_bytes": len(image_bytes),
        "width": preprocessing_info.get("width"),
        "height": preprocessing_info.get("height"),
        "selected_variant": selected_variant,
        "base64": encoded_image,
    }


def _build_make_ocr_request(
    *,
    webhook_url: str,
    payload: dict[str, Any],
    submission: Submission,
) -> request.Request:
    body = json.dumps(
        {
            "payload_json": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            "correlation_id": str(payload.get("correlation_id") or ""),
            "submission_ref": str(payload.get("submission_ref") or ""),
            "ocr_preview": True,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

    logger.info(
        "Make OCR webhook JSON request prepared: correlation_id=%s submission_ref=%s transport=%s",
        payload.get("correlation_id"),
        payload.get("submission_ref"),
        _dict_or_empty(payload.get("image")).get("transport"),
    )

    return request.Request(
        webhook_url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-SM2-OCR-Preview": "true",
            **(
                {"X-SM2-Correlation-Id": str(submission.correlation_id)}
                if getattr(submission, "correlation_id", None)
                else {}
            ),
            **({"X-SM2-Submission-Ref": submission.submission_ref} if submission.submission_ref else {}),
        },
        method="POST",
    )


def _extract_analysis_candidate(payload: Any) -> dict[str, Any] | None:
    if isinstance(payload, list):
        for item in payload:
            nested = _extract_analysis_candidate(item)
            if nested is not None:
                return nested
        return None

    if not isinstance(payload, dict):
        return None

    if _is_make_setup_payload(payload):
        return payload

    if _is_compact_shock_setup_payload(payload):
        return payload

    if _is_flexible_setup_payload(payload):
        return payload

    if any(
        key in payload
        for key in (
            "document_type",
            "setup",
            "status",
            "raw_evidence",
            "field_evidence",
            "confidence",
            "warnings",
            "metadata",
        )
    ):
        return payload

    for key in (
        "analysis",
        "image_analysis",
        "imageAnalysis",
        "ocr_result",
        "ocrResult",
        "result",
        "data",
        "payload",
        "structured_json",
        "structuredJson",
    ):
        candidate = payload.get(key)
        nested = _extract_analysis_candidate(candidate)
        if nested is not None:
            return nested

    return None


def _extract_error_message(payload: Any) -> str | None:
    if isinstance(payload, str):
        return _normalize_text(payload)

    if not isinstance(payload, dict):
        return None

    for key in ("message", "error", "detail"):
        value = payload.get(key)
        if isinstance(value, str) and _normalize_text(value):
            return _normalize_text(value)
        if isinstance(value, dict):
            nested_message = _extract_error_message(value)
            if nested_message:
                return nested_message

    return None


def _analyze_submission_image_via_make(
    *,
    submission: Submission,
    event: Event,
    run_group: RunGroup,
    driver: Driver | None,
    vehicle: Vehicle | None,
) -> dict[str, Any] | None:
    settings = get_settings()
    webhook_url = _normalize_text(getattr(settings, "make_ocr_webhook_url", None))
    image_urls = _normalize_submission_image_urls(submission)
    preprocessing_infos = (
        [image_analysis_service._preprocess_image_payload(image_url) for image_url in image_urls]
        if image_urls
        else [{"valid": False, "error": "No image file received."}]
    )
    primary_preprocessing = preprocessing_infos[0]

    logger.info(
        "OCR analyze request routed to Make webhook: image_count=%s mime_type=%s size_bytes=%s width=%s height=%s variant=%s",
        len(image_urls),
        primary_preprocessing.get("mime_type") or "unknown",
        primary_preprocessing.get("size_bytes"),
        primary_preprocessing.get("width"),
        primary_preprocessing.get("height"),
        primary_preprocessing.get("selected_variant") or "original",
    )

    if not webhook_url or not image_urls:
        logger.warning(
            "Make OCR analyze request skipped: webhook_configured=%s image_count=%s",
            bool(webhook_url),
            len(image_urls),
        )
        return None

    invalid_preprocessing = next((info for info in preprocessing_infos if not info.get("valid")), None)
    if invalid_preprocessing is not None:
        logger.warning(
            "Make OCR preprocessing rejected image: error=%s mime_type=%s",
            invalid_preprocessing.get("error"),
            invalid_preprocessing.get("mime_type") or "unknown",
        )
        return normalize_image_analysis_result(
            image_analysis_service._build_extraction_failed_analysis(
                message=invalid_preprocessing.get("error") or "Image could not be prepared for OCR.",
                preprocessing_info=invalid_preprocessing,
                model="make.com",
            )
        )

    payload = _build_make_ocr_payload(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        preprocessing_info=preprocessing_infos,
    )
    if payload is None:
        logger.warning("Make OCR JSON payload could not be prepared from the selected image variant")
        return normalize_image_analysis_result(
            image_analysis_service._build_extraction_failed_analysis(
                message="Image could not be prepared for OCR.",
                preprocessing_info=primary_preprocessing,
                model="make.com",
            )
        )

    req = _build_make_ocr_request(
        webhook_url=webhook_url,
        payload=payload,
        submission=submission,
    )

    try:
        with request.urlopen(req, timeout=getattr(settings, "make_ocr_timeout_seconds", 20.0)) as response:
            raw_response = response.read().decode("utf-8").strip()
    except error.HTTPError as exc:
        logger.warning("Make OCR webhook responded with HTTP %s", exc.code)
        return normalize_image_analysis_result(
            image_analysis_service._build_extraction_failed_analysis(
                message="OCR service failed. Please retry or enter manually.",
                preprocessing_info=primary_preprocessing,
                model="make.com",
            )
        )
    except error.URLError as exc:
        logger.warning("Make OCR webhook request failed: %s", exc)
        return normalize_image_analysis_result(
            image_analysis_service._build_extraction_failed_analysis(
                message="OCR service failed. Please retry or enter manually.",
                preprocessing_info=primary_preprocessing,
                model="make.com",
            )
        )

    if not raw_response:
        logger.warning("Make OCR webhook returned an empty body")
        return normalize_image_analysis_result(
            image_analysis_service._build_extraction_failed_analysis(
                message="OCR service failed. Please retry or enter manually.",
                preprocessing_info=primary_preprocessing,
                model="make.com",
            )
        )

    try:
        parsed_response = json.loads(raw_response)
    except json.JSONDecodeError:
        logger.warning("Make OCR webhook returned non-JSON body")
        return normalize_image_analysis_result(
            image_analysis_service._build_extraction_failed_analysis(
                message="OCR service failed. Please retry or enter manually.",
                preprocessing_info=primary_preprocessing,
                model="make.com",
            )
        )

    normalized = extract_normalized_inbound_analysis(parsed_response)
    if normalized is None:
        pending_message = _extract_error_message(parsed_response)
        logger.info(
            "Make OCR webhook returned no inline analysis payload; assuming async callback is pending: message=%s",
            pending_message or "none",
        )
        return normalize_image_analysis_result(_build_make_waiting_analysis(pending_message))

    logger.info(
        "Make OCR normalized: status=%s doc_type=%s confidence=%s",
        normalized.get("status"),
        normalized.get("document_type"),
        normalized.get("confidence"),
    )
    return normalized


def analyze_submission_image(
    *,
    submission: Submission,
    event: Event,
    run_group: RunGroup,
    driver: Driver | None,
    vehicle: Vehicle | None,
) -> dict[str, Any] | None:
    settings = get_settings()
    ocr_config = get_ocr_config_status(settings)

    if ocr_config["provider"] != "make_webhook":
        logger.warning(
            "OCR analyze request skipped because Make OCR webhook is not configured: missing_requirements=%s",
            ocr_config["missing_requirements"],
        )
        return None

    return _analyze_submission_image_via_make(
        submission=submission,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
    )
