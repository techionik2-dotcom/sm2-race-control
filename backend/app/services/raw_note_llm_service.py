from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from app.core.config import get_settings
from app.services.raw_submission_service import ParsedRawNote


logger = logging.getLogger(__name__)

RAW_NOTE_EXTRACTION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "confidence": {"type": "number"},
        "data": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "session_number": {"type": ["integer", "null"]},
                "duration_min": {"type": ["integer", "null"]},
                "driver_alias": {"type": ["string", "null"]},
                "vehicle_alias": {"type": ["string", "null"]},
                "driver_id": {"type": ["string", "null"]},
                "vehicle_id": {"type": ["string", "null"]},
                "tire_set": {"type": ["string", "null"]},
                "wheelbase_mm": {"type": ["number", "null"]},
                "best_lap": {"type": ["string", "null"]},
                "best_lap_time": {"type": ["string", "null"]},
                "pressures": {
                    "type": ["object", "null"],
                    "additionalProperties": False,
                    "properties": {
                        "cold": {
                            "type": ["object", "null"],
                            "additionalProperties": False,
                            "properties": {
                                "fl": {"type": ["number", "null"]},
                                "fr": {"type": ["number", "null"]},
                                "rl": {"type": ["number", "null"]},
                                "rr": {"type": ["number", "null"]},
                            },
                        },
                        "hot": {
                            "type": ["object", "null"],
                            "additionalProperties": False,
                            "properties": {
                                "fl": {"type": ["number", "null"]},
                                "fr": {"type": ["number", "null"]},
                                "rl": {"type": ["number", "null"]},
                                "rr": {"type": ["number", "null"]},
                            },
                        },
                    },
                },
                "alignment": {
                    "type": ["object", "null"],
                    "additionalProperties": False,
                    "properties": {
                        "camber_fl": {"type": ["number", "null"]},
                        "camber_fr": {"type": ["number", "null"]},
                        "camber_rl": {"type": ["number", "null"]},
                        "camber_rr": {"type": ["number", "null"]},
                        "toe_front": {"type": ["string", "null"]},
                        "toe_rear": {"type": ["string", "null"]},
                        "ride_height_f": {"type": ["number", "null"]},
                        "ride_height_r": {"type": ["number", "null"]},
                        "caster_l": {"type": ["number", "null"]},
                        "caster_r": {"type": ["number", "null"]},
                    },
                },
                "suspension": {
                    "type": ["object", "null"],
                    "additionalProperties": False,
                    "properties": {
                        "rebound_f": {"type": ["integer", "null"]},
                        "rebound_r": {"type": ["integer", "null"]},
                        "bump_f": {"type": ["integer", "null"]},
                        "bump_r": {"type": ["integer", "null"]},
                        "sway_bar_f": {"type": ["string", "integer", "null"]},
                        "sway_bar_r": {"type": ["string", "integer", "null"]},
                    },
                },
                "suspensions": {
                    "type": ["object", "null"],
                    "additionalProperties": True,
                },
            },
            "required": [
                "session_number",
                "duration_min",
                "driver_alias",
                "vehicle_alias",
                "tire_set",
            ],
        },
    },
    "required": ["confidence", "data"],
}


@dataclass(slots=True)
class RawNoteLLMParseResult:
    parsed_note: ParsedRawNote
    confidence: float
    model: str | None = None
    used_openai: bool = False
    fallback_reason: str | None = None


def _response_output_text(response_payload: dict[str, Any]) -> str:
    output_text = response_payload.get("output_text")
    if isinstance(output_text, str):
        return output_text

    pieces: list[str] = []
    for item in response_payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content") or []:
            if not isinstance(content, dict):
                continue
            text_value = content.get("text")
            if isinstance(text_value, str):
                pieces.append(text_value)
    return "".join(pieces)


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text_value = " ".join(str(value).split()).strip()
    return text_value or None


def _parse_float(value: Any) -> float | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None
    try:
        return float(cleaned)
    except (TypeError, ValueError):
        return None


def _parse_int(value: Any) -> int | None:
    parsed = _parse_float(value)
    if parsed is None or not parsed.is_integer():
        return None
    return int(parsed)


def _normalize_tire_set(value: Any) -> str | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None

    token = cleaned.upper().replace(" ", "-").replace("--", "-")
    token = re.sub(r"^YOKOHAMA-", "Y-", token)
    token = re.sub(r"^MICHELIN-", "M-", token)
    token = re.sub(r"^PIRELLI-", "P-", token)

    match = re.fullmatch(r"([YMP])-?S?(\d+)", token)
    if match:
        return f"{match.group(1)}-S{int(match.group(2))}"

    match = re.fullmatch(r"([YMP])-S(\d+)", token)
    if match:
        return f"{match.group(1)}-S{int(match.group(2))}"

    return None


def _normalize_corners(source: Any, *, field_name: str, as_int: bool = False) -> dict[str, Any]:
    values = source if isinstance(source, dict) else {}
    corners: dict[str, Any] = {}
    for corner in ("fl", "fr", "rl", "rr"):
        value = values.get(corner)
        if value is None:
            value = values.get(f"{field_name}_{corner}")
        if value is None:
            continue
        parsed = _parse_int(value) if as_int else _parse_float(value)
        if parsed is None:
            continue
        corners[corner] = parsed
    return corners


def _normalize_pressures(source: Any) -> dict[str, dict[str, float]]:
    pressures = source if isinstance(source, dict) else {}
    normalized: dict[str, dict[str, float]] = {}

    for phase in ("cold", "hot"):
        phase_source = pressures.get(phase)
        if not isinstance(phase_source, dict):
            phase_source = pressures
        phase_values = _normalize_corners(phase_source, field_name=phase, as_int=False)
        if phase_values:
            normalized[phase] = phase_values

    return normalized


def _normalize_alignment(source: Any) -> dict[str, Any]:
    alignment = source if isinstance(source, dict) else {}
    normalized: dict[str, Any] = {}

    for key in ("camber_fl", "camber_fr", "camber_rl", "camber_rr", "ride_height_f", "ride_height_r", "caster_l", "caster_r"):
        value = alignment.get(key)
        if value is None:
            continue
        parsed = _parse_float(value)
        if parsed is not None:
            normalized[key] = parsed

    for key in ("toe_front", "toe_rear"):
        value = _clean_text(alignment.get(key))
        if value is not None:
            normalized[key] = value

    return normalized


def _normalize_suspension(source: Any) -> dict[str, Any]:
    suspension = source if isinstance(source, dict) else {}
    normalized: dict[str, Any] = {}

    for key in ("rebound_f", "rebound_r", "bump_f", "bump_r"):
        value = suspension.get(key)
        if value is None:
            continue
        parsed = _parse_int(value)
        if parsed is not None:
            normalized[key] = parsed

    for key in ("sway_bar_f", "sway_bar_r"):
        value = suspension.get(key)
        if value is None:
            continue
        cleaned = _clean_text(value)
        if cleaned is None:
            continue
        parsed = _parse_int(cleaned)
        normalized[key] = parsed if parsed is not None else cleaned

    return normalized


def _normalize_best_lap(value: Any) -> str | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None

    if re.fullmatch(r"\d+:\d{2}\.\d{3}", cleaned):
        return cleaned

    if re.fullmatch(r"\d+\.\d{3}", cleaned):
        seconds = float(cleaned)
        minutes = int(seconds // 60)
        remainder = seconds - (minutes * 60)
        return f"{minutes}:{remainder:06.3f}"

    return cleaned


def _extract_openai_payload(raw_payload: dict[str, Any]) -> dict[str, Any]:
    if isinstance(raw_payload.get("data"), dict):
        return raw_payload["data"]
    return raw_payload


def _normalize_openai_payload(payload: dict[str, Any]) -> RawNoteLLMParseResult | None:
    root = _extract_openai_payload(payload)
    if not isinstance(root, dict):
        return None

    session_number = _parse_int(root.get("session_number"))
    duration_min = _parse_int(root.get("duration_min"))
    driver_alias = _clean_text(root.get("driver_alias") or root.get("driver_id"))
    vehicle_alias = _clean_text(root.get("vehicle_alias") or root.get("vehicle_id"))
    tire_set = _normalize_tire_set(root.get("tire_set"))

    if duration_min is None or not driver_alias or not vehicle_alias or not tire_set:
        return None

    parsed_note = ParsedRawNote(
        session_number=session_number,
        duration_min=duration_min,
        driver_alias=driver_alias,
        vehicle_alias=vehicle_alias,
        tire_set=tire_set,
    )

    pressures = _normalize_pressures(root.get("pressures"))
    if pressures:
        parsed_note.pressures = pressures

    alignment = _normalize_alignment(root.get("alignment"))
    if alignment:
        parsed_note.alignment = alignment

    suspension_source = root.get("suspension") if isinstance(root.get("suspension"), dict) else root.get("suspensions")
    suspension = _normalize_suspension(suspension_source)
    if suspension:
        parsed_note.suspension = suspension

    wheelbase_mm = _parse_float(root.get("wheelbase_mm"))
    if wheelbase_mm is not None:
        parsed_note.wheelbase_mm = wheelbase_mm

    best_lap = _normalize_best_lap(root.get("best_lap") or root.get("best_lap_time"))
    if best_lap is not None:
        parsed_note.best_lap = best_lap

    confidence = _parse_float(payload.get("confidence"))
    if confidence is None:
        confidence = 0.75
    confidence = max(0.0, min(float(confidence), 1.0))

    return RawNoteLLMParseResult(
        parsed_note=parsed_note,
        confidence=confidence,
        model=_clean_text(payload.get("model")),
        used_openai=True,
    )


def _call_openai_json(
    *,
    system_prompt: str,
    user_prompt: str,
    schema_name: str,
    schema: dict[str, Any],
    log_label: str,
) -> tuple[dict[str, Any] | None, str | None]:
    settings = get_settings()
    if not settings.openai_api_key:
        return None, "missing_api_key"

    payload = {
        "model": settings.openai_model,
        "input": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": schema_name,
                "schema": schema,
                "strict": True,
            }
        },
    }

    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings.openai_api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=settings.openai_request_timeout_seconds) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        logger.warning("OpenAI %s failed: status=%s", log_label, error.code)
        return None, f"http_{error.code}"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
        logger.warning("OpenAI %s failed: %s", log_label, error)
        return None, type(error).__name__

    raw_text = _response_output_text(response_payload).strip()
    if not raw_text:
        logger.warning("OpenAI %s returned no output text", log_label)
        return None, "empty_output"

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        logger.warning("OpenAI %s returned invalid JSON", log_label)
        return None, "invalid_json"

    return parsed if isinstance(parsed, dict) else None, None


def extract_raw_note_via_openai(raw_text: str) -> RawNoteLLMParseResult | None:
    settings = get_settings()
    if not settings.openai_api_key:
        return None

    parsed, error = _call_openai_json(
        system_prompt=(
            "You are the SM2 Racing raw note extractor. "
            "Use only the explicit information present in the note. "
            "Do not invent values. "
            "Do not generate any session ID. "
            "Backend code will resolve driver and vehicle records, validate the data, and generate id_seance. "
            "Return only JSON that matches the schema."
        ),
        user_prompt=(
            f"Raw note:\n{raw_text}\n\n"
            "Extract the shorthand into structured data. "
            "Normalize tire_set to the form Y-S#, M-S#, or P-S#. "
            "Keep pressures in psi and wheelbase in millimeters. "
            "Return confidence between 0 and 1."
        ),
        schema_name="sm2_raw_note_extraction",
        schema=RAW_NOTE_EXTRACTION_SCHEMA,
        log_label="raw note extraction",
    )
    if parsed is None:
        logger.info("OpenAI raw note extraction fallback skipped or failed: reason=%s", error)
        return None

    normalized = _normalize_openai_payload(parsed)
    if normalized is None:
        logger.warning("OpenAI raw note extraction returned unusable payload")
        return None

    return normalized
