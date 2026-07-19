from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable


RAW_SCHEMA_VERSION = "2.6.1"
RAW_ACTION = "ADD_SEANCE"
RAW_SESSION_TYPE = "Practice"
RAW_PRESSURE_UNIT = "psi"
DEFAULT_RAW_CONFIDENCE = 1.0
RAW_SESSION_TIME = "00:00:00"
TIRE_SET_PATTERN = re.compile(r"^[YMP]-S\d+$", re.IGNORECASE)
SESSION_TOKEN_PATTERN = re.compile(r"^s(?P<number>\d+)$", re.IGNORECASE)
DURATION_TOKEN_PATTERN = re.compile(r"^(?P<minutes>\d+)min$", re.IGNORECASE)
BEST_LAP_PATTERN = re.compile(r"^\d+:\d{2}\.\d{3}$")
PRESSURE_LIMITS = {
    "cold": (5.0, 60.0),
    "hot": (5.0, 80.0),
}


class RawSubmissionValidationError(ValueError):
    def __init__(self, message: str, *, errors: list[dict[str, str]] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.errors = errors or [{"field": "raw_text", "message": message}]


@dataclass(slots=True)
class ParsedRawNote:
    session_number: int | None
    duration_min: int
    driver_alias: str
    vehicle_alias: str
    tire_set: str
    pressures: dict[str, dict[str, float]] = field(default_factory=dict)
    alignment: dict[str, Any] = field(default_factory=dict)
    suspension: dict[str, Any] = field(default_factory=dict)
    wheelbase_mm: float | None = None
    best_lap: str | None = None


def _normalized_text(value: Any) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_only.split()).strip()


def _normalized_token(value: Any) -> str:
    return _normalized_text(value).lower()


def _alias_tokens(*values: Any) -> set[str]:
    tokens: set[str] = set()
    for value in values:
        normalized = _normalized_text(value)
        if not normalized:
            continue
        lowered = normalized.lower()
        tokens.add(lowered)
        for token in re.findall(r"[A-Za-z0-9]+", normalized):
            tokens.add(token.lower())
    return tokens


def _driver_aliases(driver: Any) -> set[str]:
    aliases = _alias_tokens(
        getattr(driver, "driver_id", ""),
        getattr(driver, "driver_name", ""),
        getattr(driver, "first_name", ""),
        getattr(driver, "last_name", ""),
    )
    for alias in getattr(driver, "aliases", []) or []:
        aliases.update(_alias_tokens(alias))
    return aliases


def _vehicle_aliases(vehicle: Any) -> set[str]:
    return _alias_tokens(
        getattr(vehicle, "vehicle_id", ""),
        getattr(vehicle, "driver_id", ""),
        getattr(vehicle, "make", ""),
        getattr(vehicle, "model", ""),
        getattr(vehicle, "registration_number", ""),
        getattr(vehicle, "vehicle_class", ""),
    )


def resolve_driver_alias(drivers: Iterable[Any], alias: str) -> Any:
    normalized_alias = _normalized_token(alias)
    matches = [driver for driver in drivers if normalized_alias in _driver_aliases(driver)]
    if not matches:
        raise RawSubmissionValidationError(
            f"driver alias '{alias}' was not found",
            errors=[{"field": "driver_id", "message": f"driver alias '{alias}' was not found"}],
        )
    if len(matches) > 1:
        raise RawSubmissionValidationError(
            f"driver alias '{alias}' matched multiple drivers",
            errors=[{"field": "driver_id", "message": f"driver alias '{alias}' matched multiple drivers"}],
        )
    return matches[0]


def resolve_vehicle_alias(vehicles: Iterable[Any], alias: str) -> Any:
    normalized_alias = _normalized_token(alias)
    matches = [vehicle for vehicle in vehicles if normalized_alias in _vehicle_aliases(vehicle)]
    if not matches:
        raise RawSubmissionValidationError(
            f"vehicle alias '{alias}' does not belong to driver_id",
            errors=[{"field": "vehicle_id", "message": "vehicle_id does not belong to driver_id"}],
        )
    if len(matches) > 1:
        raise RawSubmissionValidationError(
            f"vehicle alias '{alias}' matched multiple vehicles",
            errors=[{"field": "vehicle_id", "message": f"vehicle alias '{alias}' matched multiple vehicles"}],
        )
    return matches[0]


def _parse_float(value: str, *, field_name: str) -> float:
    try:
        return float(value)
    except ValueError as exc:
        raise RawSubmissionValidationError(
            f"{field_name} must be numeric",
            errors=[{"field": field_name, "message": f"{field_name} must be numeric"}],
        ) from exc


def _parse_positive_float(value: str, *, field_name: str) -> float:
    parsed = _parse_float(value, field_name=field_name)
    if parsed <= 0:
        raise RawSubmissionValidationError(
            f"{field_name} must be greater than 0",
            errors=[{"field": field_name, "message": f"{field_name} must be greater than 0"}],
        )
    return parsed


def _parse_corner_values(value: str, *, field_name: str) -> list[float]:
    parts = [segment.strip() for segment in value.split("/") if segment.strip()]
    if len(parts) == 1:
        parsed = _parse_float(parts[0], field_name=field_name)
        return [parsed, parsed, parsed, parsed]
    if len(parts) != 4:
        raise RawSubmissionValidationError(
            f"{field_name} must provide 1 or 4 values",
            errors=[{"field": field_name, "message": f"{field_name} must provide 1 or 4 values"}],
        )
    return [_parse_float(part, field_name=field_name) for part in parts]


def _parse_pair_values(value: str, *, field_name: str) -> list[float]:
    parts = [segment.strip() for segment in value.split("/") if segment.strip()]
    if len(parts) == 1:
        parsed = _parse_float(parts[0], field_name=field_name)
        return [parsed, parsed]
    if len(parts) != 2:
        raise RawSubmissionValidationError(
            f"{field_name} must provide 1 or 2 values",
            errors=[{"field": field_name, "message": f"{field_name} must provide 1 or 2 values"}],
        )
    return [_parse_float(part, field_name=field_name) for part in parts]


def _collapse_front_rear_values(value: str, *, field_name: str) -> tuple[float, float]:
    parts = [segment.strip() for segment in value.split("/") if segment.strip()]
    if len(parts) == 1:
        parsed = _parse_float(parts[0], field_name=field_name)
        return parsed, parsed
    if len(parts) == 2:
        left, right = [_parse_float(part, field_name=field_name) for part in parts]
        return left, right
    if len(parts) == 4:
        front_left, front_right, rear_left, rear_right = [
            _parse_float(part, field_name=field_name) for part in parts
        ]
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


def _collapse_front_rear_text(value: str, *, field_name: str) -> tuple[str, str]:
    parts = [segment.strip() for segment in value.split("/") if segment.strip()]
    if len(parts) == 1:
        return parts[0], parts[0]
    if len(parts) == 2:
        return parts[0], parts[1]
    if len(parts) == 4:
        return "/".join(parts[:2]), "/".join(parts[2:])
    raise RawSubmissionValidationError(
        f"{field_name} must provide 1, 2, or 4 values",
        errors=[{"field": field_name, "message": f"{field_name} must provide 1, 2, or 4 values"}],
    )


def _set_pressure_values(target: dict[str, dict[str, float]], phase: str, value: str) -> None:
    fl, fr, rl, rr = _parse_corner_values(value, field_name=f"pressures.{phase}")
    target[phase] = {
        "fl": fl,
        "fr": fr,
        "rl": rl,
        "rr": rr,
    }


def _set_alignment_camber(target: dict[str, Any], value: str) -> None:
    fl, fr, rl, rr = _parse_corner_values(value, field_name="alignment.camber")
    target.update(
        {
            "camber_fl": fl,
            "camber_fr": fr,
            "camber_rl": rl,
            "camber_rr": rr,
        }
    )


def _set_alignment_toe(target: dict[str, Any], value: str) -> None:
    toe_front, toe_rear = _collapse_front_rear_text(value, field_name="alignment.toe")
    target.update(
        {
            "toe_front": toe_front,
            "toe_rear": toe_rear,
        }
    )


def _set_alignment_caster(target: dict[str, Any], value: str) -> None:
    left, right = _parse_pair_values(value, field_name="alignment.caster")
    target.update(
        {
            "caster_l": left,
            "caster_r": right,
        }
    )


def _set_alignment_ride_height(target: dict[str, Any], value: str) -> None:
    front, rear = _collapse_front_rear_values(value, field_name="alignment.ride_height")
    target.update(
        {
            "ride_height_f": front,
            "ride_height_r": rear,
        }
    )


def _set_suspension_rebound(target: dict[str, Any], value: str) -> None:
    fl, fr, rl, rr = _parse_corner_values(value, field_name="suspension.rebound")
    target.update(
        {
            "rebound_fl": int(fl),
            "rebound_fr": int(fr),
            "rebound_rl": int(rl),
            "rebound_rr": int(rr),
        }
    )


def _set_suspension_bump(target: dict[str, Any], value: str) -> None:
    fl, fr, rl, rr = _parse_corner_values(value, field_name="suspension.bump")
    target.update(
        {
            "bump_fl": int(fl),
            "bump_fr": int(fr),
            "bump_rl": int(rl),
            "bump_rr": int(rr),
        }
    )


def _set_suspension_sway_bar(target: dict[str, Any], value: str) -> None:
    front, rear = _collapse_front_rear_text(value, field_name="suspension.sway_bar")
    target.update(
        {
            "sway_bar_f": front,
            "sway_bar_r": rear,
        }
    )


def parse_raw_note(raw_text: str) -> ParsedRawNote:
    # The shorthand format is positional up front, then key/value setup fragments.
    normalized_raw_text = " ".join(str(raw_text or "").split()).strip()
    if not normalized_raw_text:
        raise RawSubmissionValidationError(
            "raw_text is required",
            errors=[{"field": "raw_text", "message": "raw_text is required"}],
        )

    tokens = normalized_raw_text.split(" ")
    session_number: int | None = None
    token_offset = 0

    session_match = SESSION_TOKEN_PATTERN.fullmatch(tokens[0])
    if session_match:
        if len(tokens) < 5:
            raise RawSubmissionValidationError(
                "raw_text must include session, duration, driver, vehicle, and tire set",
                errors=[
                    {
                        "field": "raw_text",
                        "message": "raw_text must include session, duration, driver, vehicle, and tire set",
                    }
                ],
            )
        session_number = int(session_match.group("number"))
        token_offset = 1
    else:
        duration_token = tokens[0]
        if not DURATION_TOKEN_PATTERN.fullmatch(duration_token):
            raise RawSubmissionValidationError(
                "session number must start with s[number]",
                errors=[{"field": "session_number", "message": "session number must start with s[number]"}],
            )
        if len(tokens) < 4:
            raise RawSubmissionValidationError(
                "raw_text must include duration, driver, vehicle, and tire set when session number is omitted",
                errors=[
                    {
                        "field": "raw_text",
                        "message": "raw_text must include duration, driver, vehicle, and tire set when session number is omitted",
                    }
                ],
            )

    duration_match = DURATION_TOKEN_PATTERN.fullmatch(tokens[token_offset])
    if not duration_match:
        raise RawSubmissionValidationError(
            "duration must use the shorthand [number]min",
            errors=[{"field": "duration_min", "message": "duration must use the shorthand [number]min"}],
        )

    driver_index = token_offset + 1
    vehicle_index = token_offset + 2
    tire_index = token_offset + 3
    if len(tokens) <= tire_index:
        raise RawSubmissionValidationError(
            "raw_text must include session, duration, driver, vehicle, and tire set",
            errors=[
                {
                    "field": "raw_text",
                    "message": "raw_text must include session, duration, driver, vehicle, and tire set",
                }
            ],
        )

    tire_set_token = tokens[tire_index].upper()
    if not TIRE_SET_PATTERN.fullmatch(tire_set_token):
        raise RawSubmissionValidationError(
            "tire_set must match [Y|M|P]-S[number]",
            errors=[{"field": "tire_set", "message": "tire_set must match [Y|M|P]-S[number]"}],
        )

    parsed = ParsedRawNote(
        session_number=session_number,
        duration_min=int(duration_match.group("minutes")),
        driver_alias=tokens[driver_index],
        vehicle_alias=tokens[vehicle_index],
        tire_set=tire_set_token,
    )

    index = tire_index + 1
    while index < len(tokens):
        key = tokens[index].lower()
        if index + 1 >= len(tokens):
            raise RawSubmissionValidationError(
                f"{key} is missing a value",
                errors=[{"field": key, "message": f"{key} is missing a value"}],
            )

        value = tokens[index + 1]
        if key == "pf":
            _set_pressure_values(parsed.pressures, "cold", value)
        elif key == "pc":
            _set_pressure_values(parsed.pressures, "hot", value)
        elif key == "wb":
            parsed.wheelbase_mm = _parse_positive_float(value, field_name="wheelbase_mm")
        elif key == "c":
            _set_alignment_camber(parsed.alignment, value)
        elif key == "t":
            _set_alignment_toe(parsed.alignment, value)
        elif key == "ca":
            _set_alignment_caster(parsed.alignment, value)
        elif key == "rh":
            _set_alignment_ride_height(parsed.alignment, value)
        elif key == "rb":
            _set_suspension_rebound(parsed.suspension, value)
        elif key == "bp":
            _set_suspension_bump(parsed.suspension, value)
        elif key == "sb":
            _set_suspension_sway_bar(parsed.suspension, value)
        elif key == "best":
            if not BEST_LAP_PATTERN.fullmatch(value):
                raise RawSubmissionValidationError(
                    "best lap must use m:ss.mmm format",
                    errors=[{"field": "best_lap", "message": "best lap must use m:ss.mmm format"}],
                )
            parsed.best_lap = value
        else:
            raise RawSubmissionValidationError(
                f"unsupported shorthand token '{tokens[index]}'",
                errors=[{"field": "raw_text", "message": f"unsupported shorthand token '{tokens[index]}'"}],
            )

        index += 2

    return parsed


def build_backend_seance_id(
    *,
    captured_at: datetime,
    driver_id: str,
    session_number: int | None,
) -> str:
    # Raw-note ingestion owns id generation so AI and clients never supply id_seance.
    session_date = captured_at.astimezone(timezone.utc).strftime("%Y%m%d")
    normalized_session_number = 1 if session_number is None else int(session_number)
    return f"{session_date}-{driver_id.upper()}-S{normalized_session_number:02d}"


def build_raw_submission_payload(
    parsed: ParsedRawNote,
    *,
    driver_id: str,
    vehicle_id: str,
    track: str,
    run_group: str,
    created_by: str,
    captured_at: datetime | None = None,
    confidence: float = DEFAULT_RAW_CONFIDENCE,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    timestamp = captured_at or datetime.now(timezone.utc)
    normalized_confidence = float(confidence)
    session_number = 1 if parsed.session_number is None else parsed.session_number
    id_seance = build_backend_seance_id(
        captured_at=timestamp,
        driver_id=driver_id,
        session_number=session_number,
    )
    session_data: dict[str, Any] = {
        "date": timestamp.astimezone(timezone.utc).date().isoformat(),
        "time": RAW_SESSION_TIME,
        "session_id": id_seance,
        "track": track,
        "run_group": run_group,
        "driver_id": driver_id,
        "vehicle_id": vehicle_id,
        "session_type": RAW_SESSION_TYPE,
        "session_number": session_number,
        "duration_min": parsed.duration_min,
        "tire_set": parsed.tire_set,
        "pressures": {
            "unit": RAW_PRESSURE_UNIT,
        },
    }

    if parsed.pressures.get("cold"):
        session_data["pressures"]["cold"] = dict(parsed.pressures["cold"])
    if parsed.pressures.get("hot"):
        session_data["pressures"]["hot"] = dict(parsed.pressures["hot"])
    if parsed.wheelbase_mm is not None:
        session_data["wheelbase_mm"] = parsed.wheelbase_mm
    if parsed.alignment:
        session_data["alignment"] = dict(parsed.alignment)
    if parsed.suspension:
        session_data["suspension"] = dict(parsed.suspension)
    if parsed.best_lap is not None:
        session_data["best_lap"] = parsed.best_lap

    payload = {
        "schema_version": RAW_SCHEMA_VERSION,
        "action": RAW_ACTION,
        "created_by": created_by,
        "data": session_data,
    }
    analysis_result = {
        "schema_version": RAW_SCHEMA_VERSION,
        "action": RAW_ACTION,
        "confidence": normalized_confidence,
        "parser_version": "raw-note-backend-2.6.1",
    }
    return payload, analysis_result, id_seance


def validate_raw_submission_payload(
    *,
    created_by: str,
    raw_text: str,
    payload: dict[str, Any],
    analysis_result: dict[str, Any],
) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if payload.get("schema_version") != RAW_SCHEMA_VERSION:
        errors.append({"field": "schema_version", "message": "schema_version must be 2.6.1"})
    if payload.get("action") != RAW_ACTION:
        errors.append({"field": "action", "message": "action must be ADD_SEANCE"})
    if not _normalized_text(created_by):
        errors.append({"field": "created_by", "message": "created_by must exist"})
    if not _normalized_text(raw_text):
        errors.append({"field": "raw_text", "message": "raw_text must exist"})

    confidence = analysis_result.get("confidence")
    if not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1:
        errors.append({"field": "confidence", "message": "confidence must be between 0 and 1"})

    session_data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    driver_id = _normalized_text(session_data.get("driver_id"))
    vehicle_id = _normalized_text(session_data.get("vehicle_id"))
    if not driver_id:
        errors.append({"field": "driver_id", "message": "driver_id must exist"})
    if not vehicle_id:
        errors.append({"field": "vehicle_id", "message": "vehicle_id must exist"})
    tire_set = _normalized_text(session_data.get("tire_set")).upper()
    if tire_set and not TIRE_SET_PATTERN.fullmatch(tire_set):
        errors.append({"field": "tire_set", "message": "tire_set must match [Y|M|P]-S[number]"})

    pressures = session_data.get("pressures") if isinstance(session_data.get("pressures"), dict) else {}
    if pressures.get("unit") != RAW_PRESSURE_UNIT:
        errors.append({"field": "pressures.unit", "message": "pressure unit is psi"})

    for phase, limits in PRESSURE_LIMITS.items():
        values = pressures.get(phase) if isinstance(pressures.get(phase), dict) else {}
        for corner in ("fl", "fr", "rl", "rr"):
            value = values.get(corner)
            if value is None:
                continue
            if not isinstance(value, (int, float)):
                errors.append(
                    {
                        "field": f"pressures.{phase}.{corner}",
                        "message": "pressure values must be numeric and reasonable",
                    }
                )
                continue
            minimum, maximum = limits
            numeric = float(value)
            if numeric < minimum or numeric > maximum:
                errors.append(
                    {
                        "field": f"pressures.{phase}.{corner}",
                        "message": "pressure values must be numeric and reasonable",
                    }
                )

    wheelbase_mm = session_data.get("wheelbase_mm")
    if wheelbase_mm is not None and not isinstance(wheelbase_mm, (int, float)):
        errors.append({"field": "wheelbase_mm", "message": "wheelbase_mm must be numeric if provided"})

    return errors


def describe_raw_exception(exc: Exception) -> dict[str, str]:
    """Build a compact, safe exception summary for raw-note error logging."""

    exception_type = exc.__class__.__name__
    original_exc = getattr(exc, "orig", None)
    if original_exc is not None:
        original_exception_type = original_exc.__class__.__name__
        original_exception_message = _normalized_text(str(original_exc)) or original_exception_type
        return {
            "exception_type": exception_type,
            "original_exception_type": original_exception_type,
            "original_exception_message": original_exception_message,
            "display_message": (
                f"{exception_type}: {original_exception_type}: {original_exception_message}"
            ),
        }

    exception_message = _normalized_text(str(exc)) or exception_type
    return {
        "exception_type": exception_type,
        "original_exception_type": "",
        "original_exception_message": "",
        "display_message": f"{exception_type}: {exception_message}",
    }
