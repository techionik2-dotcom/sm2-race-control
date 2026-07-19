from __future__ import annotations

import logging
import json
import re
from dataclasses import dataclass
from decimal import Decimal
from datetime import date, datetime, time, timedelta
from typing import Any, Iterable

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select, text
from sqlalchemy.orm import Load, Session

from app.core.config import get_settings
from app.core.db_schema import SM2RACING_SCHEMA
from app.models.driver import Driver
from app.models.chatbot_conversation import ChatbotConversation
from app.models.event import Event
from app.models.run_group import RunGroup
from app.models.structured_notes import (
    Alignment,
    Pressure,
    Seance,
    TireHistory,
    TireInventory,
    TireTemperature,
    Suspension,
)
from app.models.submission import Submission
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.chatbot import (
    ChatbotCard,
    ChatbotContextResponse,
    ChatbotDirectoryChoice,
    ChatbotEventChoice,
    ChatbotField,
    ChatbotQuery,
    ChatbotRecordReference,
    ChatbotResponse,
    ChatbotSection,
    ChatbotSessionChoice,
)
from app.services.chatbot_llm_service import classify_chatbot_intent
from app.services.submission_payload_service import get_session_payload


NO_DATA_MESSAGE = "No matching data was found in the SM2 Racing database."
SOURCE_LABEL = "SM2 Racing Database"
logger = logging.getLogger(__name__)

DETERMINISTIC_PROMPTS = [
    "Show latest events",
    "Show latest sessions",
    "Show latest submissions",
    "Show setup for latest session",
    "Show tire pressures",
    "Show suspension data",
    "Show alignment data",
    "Show tire temperatures",
    "Show tire history",
    "Show driver and vehicle data",
    "Show latest drivers",
    "Show latest vehicles",
    "Show users",
    "Show sessions for this event",
    "Show sessions for driver Alex",
    "Show alignment for Car 12",
]

AI_ONLY_PROMPTS = [
    "Compare sessions",
    "Which one is better?",
    "How can I improve?",
    "What should I change next?",
    "What are my weak points?",
    "Compare with previous session",
    "Suggest priority changes",
    "Explain why",
]

DEFAULT_FOLLOW_UPS = [
    "Show all events",
    "Show latest sessions",
    "Summarize today's runs for Car 12",
    "Show sessions for this event",
    "Show sessions for driver Alex",
    "Show setup for latest session",
    "Show tire pressures",
    "What were the tire pressures in the morning session?",
    "Show tire pressures for Session 2",
    "Show suspension data",
    "Show alignment data",
    "Show alignment for Car 12",
    "Show tire temperatures",
    "Show tire history",
    "Log note: car felt loose on corner exit",
    "Set LF cold pressure to 22.5 for Session 2",
    "Show latest submissions",
    "Show driver and vehicle data",
    "Show changes from baseline",
    "Compare sessions",
    "Which one is better?",
    "How can I improve?",
    "What should I change next?",
    "What are my weak points?",
]

GREETING_QUERY_PHRASES = {
    "hi",
    "hello",
    "hey",
    "greetings",
    "hello there",
    "hi there",
    "hey there",
    "good morning",
    "good afternoon",
    "good evening",
    "good night",
}

HELP_SERVICES_QUERY_PHRASES = {
    "help",
    "can you help me",
    "how can you help",
    "what are you",
    "who are you",
    "what can you do",
    "what do you do",
    "what services do you provide",
    "what services do you offer",
    "show options",
    "services",
}

THANKS_QUERY_PHRASES = {
    "thanks",
    "thank you",
    "thank you so much",
    "thank you very much",
    "thanks a lot",
    "much appreciated",
    "appreciate it",
}

LLM_ROUTABLE_INTENTS = {"compare", "recommendation", "coaching", "unsupported"}

INTENT_ROUTING_TABLE = {
    "greeting": {"group": "greeting", "mode": "preset", "allow_llm": False},
    "help_services": {"group": "help_services", "mode": "preset", "allow_llm": False},
    "thanks": {"group": "thanks", "mode": "preset", "allow_llm": False},
    "list_events": {"group": "latest_events", "mode": "structured", "allow_llm": False},
    "latest_sessions": {"group": "latest_sessions", "mode": "structured", "allow_llm": False},
    "latest_submissions": {"group": "latest_submissions", "mode": "structured", "allow_llm": False},
    "setup_latest_session": {"group": "setup_detail", "mode": "structured", "allow_llm": False},
    "tire_pressures_by_session": {"group": "tire_pressures", "mode": "structured", "allow_llm": False},
    "suspension_data": {"group": "suspension", "mode": "structured", "allow_llm": False},
    "alignment_by_car": {"group": "alignment", "mode": "structured", "allow_llm": False},
    "tire_temperatures_by_session": {"group": "tire_temperatures", "mode": "structured", "allow_llm": False},
    "tire_history_by_session": {"group": "tire_history", "mode": "structured", "allow_llm": False},
    "sessions_by_event": {"group": "event_sessions", "mode": "structured", "allow_llm": False},
    "sessions_by_driver": {"group": "driver_sessions", "mode": "structured", "allow_llm": False},
    "driver_vehicle_data": {"group": "driver_vehicle_lookup", "mode": "structured", "allow_llm": False},
    "compare": {"group": "comparison", "mode": "structured_ai", "allow_llm": True},
    "recommendation": {"group": "suggestion", "mode": "structured_ai", "allow_llm": True},
    "coaching": {"group": "suggestion", "mode": "structured_ai", "allow_llm": True},
    "unsupported": {"group": "unknown", "mode": "llm_fallback", "allow_llm": True},
}

UNSUPPORTED_MESSAGE = (
    "I can currently help with events, sessions, setup sheets, tire pressures, suspension, "
    "alignment, tire temperatures, tire history, chat-based notes, setup updates, submissions, "
    "drivers, users, vehicles, recommendations, and improvement coaching. Please ask one of those questions."
)
PLEASE_SELECT_EVENT_MESSAGE = "Please select an event or include the event name so I can show its sessions."
NO_EVENTS_MESSAGE = "No events were found in the SM2 Racing database."
NO_DRIVER_MATCH_MESSAGE = "No driver matching '{term}' was found in the database."
NO_USER_MATCH_MESSAGE = "No user matching '{term}' was found in the database."
NO_VEHICLE_MATCH_MESSAGE = "No vehicle matching Car {term} was found in the database."
MULTIPLE_DRIVER_MATCH_MESSAGE = "I found multiple drivers matching '{term}'. Please choose the correct driver."
MULTIPLE_VEHICLE_MATCH_MESSAGE = "I found multiple vehicles matching Car {term}. Please choose the correct vehicle."
MULTIPLE_SESSION_MATCH_MESSAGE = "I found multiple Session {number} records. Please select an event or provide more details."

SESSION_TIME_WINDOWS = {
    "morning": (time(0, 0), time(12, 0), "morning"),
    "afternoon": (time(12, 0), time(17, 0), "afternoon"),
    "evening": (time(17, 0), time(21, 0), "evening"),
    "night": (time(21, 0), None, "night"),
}

VEHICLE_SCOPED_INTENTS = {
    "latest_sessions",
    "sessions_by_event",
    "sessions_by_driver",
    "setup_latest_session",
    "tire_pressures_by_session",
    "tire_temperatures_by_session",
    "tire_history_by_session",
    "log_session_note",
    "update_setup_fields",
    "suspension_data",
    "alignment_by_car",
    "latest_submissions",
    "driver_vehicle_data",
    "compare",
    "recommendation",
    "coaching",
}

NLP_ALLOWED_INTENTS = [
    "greeting",
    "help_services",
    "thanks",
    "list_events",
    "latest_sessions",
    "latest_submissions",
    "setup_latest_session",
    "tire_pressures_by_session",
    "tire_temperatures_by_session",
    "tire_history_by_session",
    "suspension_data",
    "alignment_by_car",
    "sessions_by_event",
    "sessions_by_driver",
    "driver_vehicle_data",
    "compare",
    "recommendation",
    "coaching",
    "unsupported",
]


@dataclass(slots=True)
class SessionBundle:
    session: Seance
    driver: Driver | None
    vehicle: Vehicle | None


@dataclass(slots=True)
class NLPIntentResult:
    intent: str
    confidence: float
    filters: dict[str, str]
    explanation: str = ""


@dataclass(frozen=True, slots=True)
class SetupFieldDefinition:
    section: str
    model: type[Any]
    attribute: str
    label: str
    value_type: str
    aliases: tuple[str, ...]
    minimum: float | None = None
    maximum: float | None = None


@dataclass(frozen=True, slots=True)
class ParsedSetupChange:
    definition: SetupFieldDefinition
    value: Decimal | int | str
    raw_value: str


CORNER_ALIASES = {
    "fl": ("fl", "lf", "front left", "left front"),
    "fr": ("fr", "rf", "front right", "right front"),
    "rl": ("rl", "lr", "rear left", "left rear"),
    "rr": ("rr", "rear right", "right rear"),
}

AXLE_ALIASES = {
    "f": ("front", "f"),
    "r": ("rear", "r"),
}

SIDE_ALIASES = {
    "l": ("left", "l"),
    "r": ("right", "r"),
}


def _with_corner_aliases(corner: str, terms: Iterable[str]) -> tuple[str, ...]:
    aliases: list[str] = []
    for term in terms:
        for corner_alias in CORNER_ALIASES[corner]:
            aliases.append(f"{corner_alias} {term}")
            aliases.append(f"{term} {corner_alias}")
    return tuple(dict.fromkeys(aliases))


def _with_axle_aliases(axle: str, terms: Iterable[str]) -> tuple[str, ...]:
    aliases: list[str] = []
    for term in terms:
        for axle_alias in AXLE_ALIASES[axle]:
            aliases.append(f"{axle_alias} {term}")
            aliases.append(f"{term} {axle_alias}")
    return tuple(dict.fromkeys(aliases))


def _with_side_aliases(side: str, terms: Iterable[str]) -> tuple[str, ...]:
    aliases: list[str] = []
    for term in terms:
        for side_alias in SIDE_ALIASES[side]:
            aliases.append(f"{side_alias} {term}")
            aliases.append(f"{term} {side_alias}")
    return tuple(dict.fromkeys(aliases))


def _normalize_query_text(value: str) -> str:
    text = str(value or "").lower().strip()
    text = re.sub(r"[^\w\s']", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _is_greeting_query(value: str) -> bool:
    normalized = _normalize_query_text(value)
    return bool(normalized and normalized in GREETING_QUERY_PHRASES)


def _is_help_services_query(value: str) -> bool:
    normalized = _normalize_query_text(value)
    if not normalized:
        return False

    if normalized in HELP_SERVICES_QUERY_PHRASES:
        return True

    service_patterns = (
        "what services",
        "show options",
        "what can you do",
        "what do you do",
        "how can you help",
        "can you help",
        "who are you",
        "what are you",
    )
    if any(pattern in normalized for pattern in service_patterns):
        return True

    if "service" in normalized and any(term in normalized for term in ("provide", "offer", "help", "can")):
        return True

    return False


def _is_thanks_query(value: str) -> bool:
    normalized = _normalize_query_text(value)
    return bool(normalized and normalized in THANKS_QUERY_PHRASES)


def _route_group_for_intent(intent: str) -> str:
    return INTENT_ROUTING_TABLE.get(intent, {}).get("group", "unknown")


def _allows_llm_for_intent(intent: str) -> bool:
    return bool(INTENT_ROUTING_TABLE.get(intent, {}).get("allow_llm"))


def _greeting_style_for_query(value: str) -> str:
    normalized = _normalize_query_text(value)
    if not normalized:
        return "help_services"

    if _is_help_services_query(normalized):
        return "help_services"

    if _is_thanks_query(normalized):
        return "thanks"

    if _is_greeting_query(normalized):
        return "greeting"

    return "help_services"


def _greeting_message_for_query(query: str) -> tuple[str, list[str]]:
    style = _greeting_style_for_query(query)
    greeting_message = (
        "Hello, and welcome to the SM Racing System. "
        "I can help you with SM Racing race data and setup tasks. "
        "How Can I help you?"
    )
    capability_message = (
        "I can help you with SM Racing race data and setup tasks.\n"
        "Here are the main things I can do:\n"
        "- Show latest events, sessions, drivers, vehicles, and submissions\n"
        "- Display setup details for a selected or latest session\n"
        "- Compare sessions and highlight changes\n"
        "- Review tire pressures, temperatures, suspension, and alignment\n"
        "- Summarize race notes and submissions\n"
        "- Suggest setup improvements based on previous session data"
    )
    capability_follow_up = [
        "Show latest events",
        "Show latest sessions",
        "Show latest submissions",
        "Show setup for latest session",
        "Compare session 1 vs session 2",
    ]

    if style == "greeting":
        return greeting_message, capability_follow_up

    if style == "help_services":
        return capability_message, capability_follow_up

    if style == "thanks":
        return (
            "You're welcome. I can help with session analysis, setup data insights, performance comparisons, "
            "submission reviews, and driver or vehicle lookups."
        ), [
            "Show latest sessions",
            "Show setup for latest session",
            "Show latest submissions",
            "Compare session 1 vs session 2",
        ]

    return capability_message, capability_follow_up


def _setup_field_definitions() -> tuple[SetupFieldDefinition, ...]:
    definitions: list[SetupFieldDefinition] = []
    corner_labels = {
        "fl": "FL",
        "fr": "FR",
        "rl": "RL",
        "rr": "RR",
    }

    for pressure_type, minimum, maximum in (("cold", 5.0, 60.0), ("hot", 5.0, 80.0)):
        for corner, corner_label in corner_labels.items():
            definitions.append(
                SetupFieldDefinition(
                    section="pressures",
                    model=Pressure,
                    attribute=f"{pressure_type}_{corner}",
                    label=f"{pressure_type.title()} pressure {corner_label}",
                    value_type="decimal",
                    aliases=_with_corner_aliases(
                        corner,
                        (
                            f"{pressure_type} pressure",
                            f"{pressure_type} tire pressure",
                            f"{pressure_type} psi",
                        ),
                    ),
                    minimum=minimum,
                    maximum=maximum,
                )
            )

    for field_name, label, terms in (
        ("rebound", "Rebound", ("rebound", "rebound click", "rebound clicks")),
        ("bump", "Bump", ("bump", "bump click", "bump clicks", "compression")),
    ):
        for corner, corner_label in corner_labels.items():
            definitions.append(
                SetupFieldDefinition(
                    section="suspension",
                    model=Suspension,
                    attribute=f"{field_name}_{corner}",
                    label=f"{label} {corner_label}",
                    value_type="int",
                    aliases=_with_corner_aliases(corner, terms),
                    minimum=0,
                )
            )

    definitions.extend(
        [
            SetupFieldDefinition(
                section="suspension",
                model=Suspension,
                attribute="sway_bar_f",
                label="Sway bar front",
                value_type="text",
                aliases=("front sway bar", "sway bar front", "front swaybar", "swaybar front"),
            ),
            SetupFieldDefinition(
                section="suspension",
                model=Suspension,
                attribute="sway_bar_r",
                label="Sway bar rear",
                value_type="text",
                aliases=("rear sway bar", "sway bar rear", "rear swaybar", "swaybar rear"),
            ),
            SetupFieldDefinition(
                section="suspension",
                model=Suspension,
                attribute="wing_angle_deg",
                label="Wing angle",
                value_type="decimal",
                aliases=("wing angle", "rear wing angle", "wing", "aero wing"),
                minimum=-90,
                maximum=90,
            ),
        ]
    )

    for corner, corner_label in corner_labels.items():
        definitions.append(
            SetupFieldDefinition(
                section="alignment",
                model=Alignment,
                attribute=f"camber_{corner}",
                label=f"Camber {corner_label}",
                value_type="decimal",
                aliases=_with_corner_aliases(corner, ("camber",)),
                minimum=-20,
                maximum=20,
            )
        )
        definitions.append(
            SetupFieldDefinition(
                section="alignment",
                model=Alignment,
                attribute=f"corner_weight_{corner}",
                label=f"Corner weight {corner_label}",
                value_type="decimal",
                aliases=_with_corner_aliases(corner, ("corner weight", "weight")),
                minimum=0,
            )
        )

    definitions.extend(
        [
            SetupFieldDefinition(
                section="alignment",
                model=Alignment,
                attribute="toe_front",
                label="Toe front",
                value_type="text",
                aliases=_with_axle_aliases("f", ("toe",)),
            ),
            SetupFieldDefinition(
                section="alignment",
                model=Alignment,
                attribute="toe_rear",
                label="Toe rear",
                value_type="text",
                aliases=_with_axle_aliases("r", ("toe",)),
            ),
            SetupFieldDefinition(
                section="alignment",
                model=Alignment,
                attribute="caster_l",
                label="Caster L",
                value_type="decimal",
                aliases=_with_side_aliases("l", ("caster",)),
                minimum=-20,
                maximum=20,
            ),
            SetupFieldDefinition(
                section="alignment",
                model=Alignment,
                attribute="caster_r",
                label="Caster R",
                value_type="decimal",
                aliases=_with_side_aliases("r", ("caster",)),
                minimum=-20,
                maximum=20,
            ),
            SetupFieldDefinition(
                section="alignment",
                model=Alignment,
                attribute="ride_height_f",
                label="Ride height front",
                value_type="decimal",
                aliases=_with_axle_aliases("f", ("ride height", "rideheight")),
                minimum=0,
            ),
            SetupFieldDefinition(
                section="alignment",
                model=Alignment,
                attribute="ride_height_r",
                label="Ride height rear",
                value_type="decimal",
                aliases=_with_axle_aliases("r", ("ride height", "rideheight")),
                minimum=0,
            ),
            SetupFieldDefinition(
                section="alignment",
                model=Alignment,
                attribute="rake_mm",
                label="Rake",
                value_type="decimal",
                aliases=("rake", "rake mm"),
                minimum=-500,
                maximum=500,
            ),
            SetupFieldDefinition(
                section="alignment",
                model=Alignment,
                attribute="wheelbase_mm",
                label="Wheelbase",
                value_type="decimal",
                aliases=("wheelbase", "wheelbase mm"),
                minimum=0.01,
            ),
        ]
    )

    temp_terms = {
        "in": ("inner tire temperature", "inner temperature", "inner temp", "inside tire temp", "inside temp"),
        "mid": ("middle tire temperature", "middle temperature", "middle temp", "mid tire temp", "mid temp"),
        "out": ("outer tire temperature", "outer temperature", "outer temp", "outside tire temp", "outside temp"),
    }
    temp_labels = {"in": "inner", "mid": "middle", "out": "outer"}
    for corner, corner_label in corner_labels.items():
        for suffix, aliases in temp_terms.items():
            definitions.append(
                SetupFieldDefinition(
                    section="tire_temperatures",
                    model=TireTemperature,
                    attribute=f"{corner}_{suffix}",
                    label=f"Temperature {corner_label} {temp_labels[suffix]}",
                    value_type="decimal",
                    aliases=_with_corner_aliases(corner, aliases),
                    minimum=0,
                    maximum=300,
                )
            )

    return tuple(definitions)


SETUP_FIELD_DEFINITIONS = _setup_field_definitions()


def _table(name: str) -> str:
    return f"{SM2RACING_SCHEMA}.{name}"


def _text(value: object | None, fallback: str = "Not available") -> str:
    if value is None:
        return fallback

    text = str(value).strip()
    return text or fallback


def _enum_text(value: object | None, fallback: str = "Not available") -> str:
    if value is None:
        return fallback

    raw = getattr(value, "value", value)
    return _text(raw, fallback)


def _humanize_enum(value: object | None) -> str:
    text = _enum_text(value)
    if text == "Not available":
        return text

    return text.replace("_", " ").title()


def _date_text(value: date | datetime | None) -> str:
    if value is None:
        return "Not available"

    current = value.date() if isinstance(value, datetime) else value
    return current.strftime("%b %d, %Y").replace(" 0", " ")


def _datetime_text(value: datetime | None) -> str:
    if value is None:
        return "Not available"

    return value.strftime("%b %d, %Y %I:%M %p").replace(" 0", " ")


def _time_text(value: time | None) -> str:
    if value is None:
        return "Not available"

    return value.strftime("%I:%M %p").lstrip("0")


def _duration_text(minutes: int | None) -> str:
    if minutes is None:
        return "Not available"

    total_minutes = int(minutes)
    hours, remainder = divmod(total_minutes, 60)
    if hours and remainder:
        return f"{hours}h {remainder}m"
    if hours:
        return f"{hours}h"
    return f"{remainder}m"


def _decimal_text(value: object | None, digits: int = 2) -> str:
    if value is None:
        return "Not available"

    try:
        text = f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return _text(value)

    return text.rstrip("0").rstrip(".")


def _joined_text(values: Iterable[str | None]) -> str:
    cleaned = [str(value).strip() for value in values if str(value).strip()]
    return ", ".join(cleaned) if cleaned else "Not available"


def _tone_for_active(is_active: bool | None) -> str:
    return "success" if is_active is not False else "neutral"


def _tone_for_status(status_value: object | None) -> str:
    if status_value is None:
        return "neutral"

    text = _enum_text(status_value, "").upper()
    if text in {"ACTIVE", "READY", "OPEN", "CURRENT"}:
        return "success"
    if text in {"ARCHIVED", "INACTIVE", "DISCARDED", "CLOSED"}:
        return "neutral"
    if text in {"WARNING", "PENDING"}:
        return "warning"
    return "accent"


def _field(label: str, value: object | None) -> ChatbotField:
    return ChatbotField(label=label, value=_text(value))


def _session_status_value(session: Seance) -> object | None:
    # The live database currently lacks the status column, so only read it if it was loaded.
    return session.__dict__.get("status")


def _record_reference(
    kind: str,
    value: object,
    label: str,
    *,
    details: str | None = None,
) -> ChatbotRecordReference:
    return ChatbotRecordReference(kind=kind, value=str(value), label=label, details=details)


def _actor_label(current_user: User | None) -> str:
    if current_user is None:
        return "admin-chatbot"

    for attribute in ("name", "email"):
        value = getattr(current_user, attribute, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return str(getattr(current_user, "id", "admin-chatbot"))


def _alias_regex(alias: str) -> str:
    return r"\b" + r"\s+".join(re.escape(part) for part in alias.lower().split()) + r"\b"


def _coerce_setup_change_value(definition: SetupFieldDefinition, raw_value: str) -> Decimal | int | str:
    cleaned = raw_value.strip().strip("'\"")
    if not cleaned:
        raise ValueError(f"{definition.label} needs a value.")

    if definition.value_type == "text":
        if len(cleaned) > 80:
            raise ValueError(f"{definition.label} is too long. Keep the value under 80 characters.")
        return cleaned

    try:
        numeric = Decimal(cleaned)
    except Exception as exc:
        raise ValueError(f"{definition.label} must be a valid number.") from exc

    numeric_float = float(numeric)
    if definition.minimum is not None and numeric_float < definition.minimum:
        raise ValueError(f"{definition.label} must be at least {_decimal_text(definition.minimum)}.")
    if definition.maximum is not None and numeric_float > definition.maximum:
        raise ValueError(f"{definition.label} must be no more than {_decimal_text(definition.maximum)}.")

    if definition.value_type == "int":
        if numeric != numeric.to_integral_value():
            raise ValueError(f"{definition.label} must be a whole number.")
        return int(numeric)

    return numeric


def _extract_setup_value(query: str, definition: SetupFieldDefinition) -> str | None:
    normalized = re.sub(r"\s+", " ", query.lower()).strip()
    numeric_value = r"-?\d+(?:\.\d+)?"

    if definition.value_type == "text":
        value_pattern = r"[^,;.]+?"
        for alias in definition.aliases:
            alias_pattern = _alias_regex(alias)
            pattern = rf"{alias_pattern}\s*(?:=|:|to|at|is|as)\s*(?P<value>{value_pattern})(?=\s+\band\b|\s+for\s+session\b|$|[,;.])"
            match = re.search(pattern, normalized, flags=re.IGNORECASE)
            if match:
                return match.group("value").strip()
        return None

    for alias in definition.aliases:
        alias_pattern = _alias_regex(alias)
        after_pattern = rf"{alias_pattern}\s*(?:=|:|to|at|is|as)?\s*(?P<value>{numeric_value})"
        match = re.search(after_pattern, normalized, flags=re.IGNORECASE)
        if match:
            return match.group("value")

        before_pattern = rf"(?P<value>{numeric_value})\s*(?:psi|deg(?:rees)?|mm|clicks?)?\s+{alias_pattern}"
        match = re.search(before_pattern, normalized, flags=re.IGNORECASE)
        if match:
            return match.group("value")

    return None


def _parse_setup_patch_from_query(query: str) -> list[ParsedSetupChange]:
    changes: list[ParsedSetupChange] = []
    seen: set[tuple[str, str]] = set()
    for definition in SETUP_FIELD_DEFINITIONS:
        raw_value = _extract_setup_value(query, definition)
        if raw_value is None:
            continue

        key = (definition.section, definition.attribute)
        if key in seen:
            continue
        changes.append(
            ParsedSetupChange(
                definition=definition,
                value=_coerce_setup_change_value(definition, raw_value),
                raw_value=raw_value,
            )
        )
        seen.add(key)
    return changes


def _looks_like_setup_update_query(text: str) -> bool:
    if not re.search(r"\b(set|update|change|adjust|record|log)\b", text):
        return False
    if not re.search(r"-?\d+(?:\.\d+)?", text):
        return False
    return any(
        keyword in text
        for keyword in [
            "pressure",
            "psi",
            "camber",
            "toe",
            "caster",
            "ride height",
            "corner weight",
            "rebound",
            "bump",
            "compression",
            "sway",
            "wing",
            "temperature",
            "temp",
            "wheelbase",
            "rake",
        ]
    )


def _looks_like_note_log_query(text: str) -> bool:
    return bool(re.search(r"\b(log|add|record|append)\b.*\bnote\b", text)) or text.startswith("note:")


def _extract_session_note_text(query: str) -> str | None:
    patterns = [
        r"\b(?:log|add|record|append)\s+(?:a\s+)?(?:session\s+)?note(?:\s+for\s+session\s+\d+)?\s*(?:[:\-]|that|saying)?\s*(?P<note>.+)$",
        r"^\s*note\s*[:\-]\s*(?P<note>.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, query, flags=re.IGNORECASE)
        if not match:
            continue
        note = match.group("note").strip().strip("'\"")
        note = re.sub(r"\s+for\s+session\s+\d+\s*$", "", note, flags=re.IGNORECASE)
        note = re.sub(r"\s+", " ", note)
        if note:
            return note
    return None


def _driver_choice(driver: Driver) -> ChatbotDirectoryChoice:
    return ChatbotDirectoryChoice(
        value=driver.driver_id,
        label=_driver_name(driver),
        sublabel=_joined_text([driver.team_name, driver.license_number]),
        tone=_tone_for_active(driver.is_active),
    )


def _vehicle_choice(vehicle: Vehicle) -> ChatbotDirectoryChoice:
    return ChatbotDirectoryChoice(
        value=vehicle.vehicle_id,
        label=_vehicle_name(vehicle),
        sublabel=_joined_text([vehicle.vehicle_class, vehicle.driver_id]),
        tone=_tone_for_active(vehicle.is_active),
    )


def _load_driver_rows(
    db: Session,
    *,
    limit: int = 8,
    driver_id: str | None = None,
    active_only: bool | None = None,
) -> list[Driver]:
    stmt = select(Driver)
    if driver_id:
        stmt = stmt.where(Driver.driver_id == driver_id)

    if active_only is True:
        stmt = stmt.where(Driver.is_active.is_(True))
    elif active_only is False:
        stmt = stmt.where(Driver.is_active.is_(False))

    stmt = stmt.order_by(
        Driver.is_active.desc(),
        Driver.last_name.asc(),
        Driver.first_name.asc(),
        Driver.driver_name.asc(),
    )
    if limit:
        stmt = stmt.limit(limit)
    return list(db.execute(stmt).scalars().all())


def _load_user_rows(
    db: Session,
    *,
    limit: int = 8,
    active_only: bool | None = None,
) -> list[User]:
    stmt = select(User)

    if active_only is True:
        stmt = stmt.where(User.is_active.is_(True))
    elif active_only is False:
        stmt = stmt.where(User.is_active.is_(False))

    stmt = stmt.order_by(
        User.is_active.desc(),
        User.name.asc(),
        User.email.asc(),
    )
    if limit:
        stmt = stmt.limit(limit)
    return list(db.execute(stmt).scalars().all())


def _load_vehicle_rows(
    db: Session,
    *,
    limit: int = 8,
    vehicle_id: str | None = None,
    active_only: bool | None = None,
) -> list[Vehicle]:
    stmt = select(Vehicle)
    if vehicle_id:
        stmt = stmt.where(Vehicle.vehicle_id == vehicle_id)

    if active_only is True:
        stmt = stmt.where(Vehicle.is_active.is_(True))
    elif active_only is False:
        stmt = stmt.where(Vehicle.is_active.is_(False))

    stmt = stmt.order_by(
        Vehicle.is_active.desc(),
        Vehicle.make.asc(),
        Vehicle.model.asc(),
        Vehicle.vehicle_id.asc(),
    )
    if limit:
        stmt = stmt.limit(limit)
    return list(db.execute(stmt).scalars().all())


def _load_submission_input_rows(
    db: Session,
    *,
    session_id: str,
    limit: int = 8,
) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            f"""
            SELECT
                submission_id,
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
            FROM {_table("submission_inputs")}
            WHERE id_seance = :session_id
            ORDER BY created_at DESC, submission_id DESC
            LIMIT :limit
            """
        ),
        {"session_id": session_id, "limit": limit},
    ).mappings()
    return [dict(row) for row in rows]


def _session_event_id(session: Seance, event_rows: list[tuple[Event, RunGroup | None]]) -> str | None:
    for event, _ in event_rows:
        if event.start_date.date() <= session.session_date <= event.end_date.date():
            return str(event.id)
    return None


def _session_load_options() -> tuple[Load, ...]:
    return (
        Load(Seance).load_only(
            Seance.id_seance,
            Seance.session_date,
            Seance.session_time,
            Seance.track,
            Seance.driver_id,
            Seance.vehicle_id,
            Seance.session_type,
            Seance.session_number,
            Seance.duration_min,
            Seance.tire_set,
            Seance.notes,
            Seance.created_by,
            Seance.created_at,
        ),
    )


def _card(
    title: str,
    *,
    subtitle: str | None = None,
    badge: str | None = None,
    badge_tone: str = "neutral",
    icon_key: str | None = None,
    fields: list[ChatbotField] | None = None,
) -> ChatbotCard:
    return ChatbotCard(
        title=title,
        subtitle=subtitle,
        badge=badge,
        badge_tone=badge_tone,
        icon_key=icon_key,
        fields=fields or [],
    )


def _section(
    title: str,
    *,
    subtitle: str | None = None,
    variant: str = "fields",
    icon_key: str | None = None,
    fields: list[ChatbotField] | None = None,
    cards: list[ChatbotCard] | None = None,
    table_headers: list[str] | None = None,
    table_rows: list[list[str]] | None = None,
) -> ChatbotSection:
    return ChatbotSection(
        title=title,
        subtitle=subtitle,
        variant=variant,
        icon_key=icon_key,
        fields=fields or [],
        cards=cards or [],
        table_headers=table_headers or [],
        table_rows=table_rows or [],
    )


def _driver_name(driver: Driver | None, fallback: str | None = None) -> str:
    if driver is None:
        return _text(fallback)

    candidate = _text(driver.driver_name, "")
    if candidate != "Not available":
        return candidate

    combined = " ".join(
        part.strip()
        for part in [driver.first_name, driver.last_name]
        if part and part.strip()
    ).strip()
    return combined or _text(driver.driver_id)


def _user_name(user: User | None, fallback: str | None = None) -> str:
    if user is None:
        return _text(fallback)

    candidate = _text(user.name, "")
    if candidate != "Not available":
        return candidate

    return _text(user.email, fallback or "Not available")


def _vehicle_name(vehicle: Vehicle | None, fallback: str | None = None) -> str:
    if vehicle is None:
        return _text(fallback)

    candidate = " ".join(
        part.strip()
        for part in [vehicle.make, vehicle.model]
        if part and part.strip()
    ).strip()
    return candidate or _text(vehicle.vehicle_id)


def _response_data(
    *,
    sections: list[ChatbotSection] | None = None,
    records_used: list[ChatbotRecordReference] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "records_used_count": len(records_used or []),
        "sections": [section.model_dump(mode="json") for section in (sections or [])],
    }
    if records_used is not None:
        data["records_used"] = [record.model_dump(mode="json") for record in records_used]

    for key, value in extra.items():
        if value is not None:
            data[key] = value

    return data


def _conversation_key(query_in: ChatbotQuery | None) -> str:
    key = getattr(query_in, "conversation_id", None)
    if isinstance(key, str):
        cleaned = key.strip()
        if cleaned:
            return cleaned[:64]
    return "default"


def _conversation_memory(conversation: ChatbotConversation | None) -> dict[str, Any]:
    if conversation is None or not isinstance(conversation.memory, dict):
        return {}
    return conversation.memory


def _unique_limited(values: Iterable[str], *, limit: int = 6) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = str(value).strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        unique.append(cleaned)
        if len(unique) >= limit:
            break
    return unique


def _response_record_payload(records_used: list[ChatbotRecordReference]) -> list[dict[str, Any]]:
    return [record.model_dump(mode="json") for record in records_used[:12]]


def _response_record_ids(records_used: list[ChatbotRecordReference], *, kind: str) -> list[str]:
    return _unique_limited(record.value for record in records_used if record.kind == kind)


def _session_record_payloads(response: ChatbotResponse) -> list[dict[str, Any]]:
    records = []
    for record in response.records_used:
        if record.kind != "session":
            continue
        records.append(record.model_dump(mode="json"))
    return records[:6]


def _build_chatbot_memory_payload(
    *,
    query_in: ChatbotQuery,
    response: ChatbotResponse,
) -> dict[str, Any]:
    records_used = response.records_used or []
    recent_session_ids = _response_record_ids(records_used, kind="session")
    recent_event_ids = _response_record_ids(records_used, kind="event")
    recent_driver_ids = _response_record_ids(records_used, kind="driver")
    recent_vehicle_ids = _response_record_ids(records_used, kind="vehicle")

    payload: dict[str, Any] = {
        "selected_scope": {
            "event_id": str(query_in.event_id) if query_in.event_id else None,
            "session_id": query_in.session_id,
            "driver_id": query_in.driver_id,
            "vehicle_id": query_in.vehicle_id,
            "car_number": query_in.car_number,
        },
        "last_query": query_in.message,
        "last_intent": response.intent,
        "last_response_kind": response.kind,
        "last_response_status": response.status,
        "last_summary": {
            "title": response.title,
            "summary": response.summary,
            "intent": response.intent,
            "status": response.status,
            "kind": response.kind,
            "record_count": len(records_used),
        },
        "recent_record_refs": _response_record_payload(records_used),
        "recent_session_ids": recent_session_ids,
        "recent_event_ids": recent_event_ids,
        "recent_driver_ids": recent_driver_ids,
        "recent_vehicle_ids": recent_vehicle_ids,
    }

    if isinstance(response.data, dict):
        payload["last_payload"] = response.data
    elif isinstance(response.data, list):
        payload["last_payload"] = response.data[:12]

    if response.kind == "compare":
        comparison_session_ids = recent_session_ids[:2]
        payload["last_comparison"] = {
            "session_ids": comparison_session_ids,
            "highlight_count": len(response.data.get("highlights") or []) if isinstance(response.data, dict) else 0,
            "metric_row_count": len(response.sections[2].table_rows) if len(response.sections) > 2 and response.sections[2].variant == "table" else 0,
            "records_used": _response_record_payload(records_used),
        }

    if response.kind == "recommendation":
        payload["last_recommendation"] = {
            "session_ids": recent_session_ids,
            "focus": response.data.get("focus") if isinstance(response.data, dict) else None,
            "best_session_id": response.data.get("best_session_id") if isinstance(response.data, dict) else None,
            "context_source": response.data.get("context_source") if isinstance(response.data, dict) else None,
        }

    if response.kind == "coaching":
        payload["last_coaching"] = {
            "session_ids": recent_session_ids,
            "focus": response.data.get("focus") if isinstance(response.data, dict) else None,
            "session_id": response.data.get("session_id") if isinstance(response.data, dict) else None,
        }

    if response.kind in {"sessions", "submissions"}:
        payload["recent_historical_sessions"] = _session_record_payloads(response)

    return payload


def _save_chatbot_conversation_state(
    db: Session,
    *,
    current_user: User | None,
    query_in: ChatbotQuery,
    response: ChatbotResponse,
) -> None:
    if current_user is None:
        return

    conversation_key = _conversation_key(query_in)
    memory_payload = _build_chatbot_memory_payload(query_in=query_in, response=response)
    conversation = db.scalar(
        select(ChatbotConversation).where(
            ChatbotConversation.user_id == current_user.id,
            ChatbotConversation.conversation_id == conversation_key,
        )
    )
    if conversation is None:
        conversation = ChatbotConversation(
            user_id=current_user.id,
            conversation_id=conversation_key,
            memory=memory_payload,
            last_query=query_in.message,
            last_intent=response.intent,
            last_response_kind=response.kind,
            last_response_status=response.status,
        )
        db.add(conversation)
    else:
        conversation.last_query = query_in.message
        conversation.last_intent = response.intent
        conversation.last_response_kind = response.kind
        conversation.last_response_status = response.status
        conversation.memory = memory_payload


def _load_chatbot_conversation_state(
    db: Session,
    *,
    current_user: User | None,
    query_in: ChatbotQuery,
) -> ChatbotConversation | None:
    if current_user is None:
        return None

    conversation_key = _conversation_key(query_in)
    return db.scalar(
        select(ChatbotConversation).where(
            ChatbotConversation.user_id == current_user.id,
            ChatbotConversation.conversation_id == conversation_key,
        )
    )


def _query_tokens(query: str) -> list[str]:
    stopwords = {
        "a",
        "all",
        "and",
        "car",
        "data",
        "driver",
        "events",
        "for",
        "latest",
        "list",
        "my",
        "please",
        "recent",
        "session",
        "sessions",
        "show",
        "the",
        "this",
        "vehicle",
    }
    return [token for token in re.findall(r"[A-Za-z0-9]+", query.lower()) if token not in stopwords]


def _query_phrase_matches(haystack: str, query: str) -> bool:
    normalized_haystack = re.sub(r"\s+", " ", haystack.lower()).strip()
    normalized_query = re.sub(r"\s+", " ", query.lower()).strip()
    if not normalized_query:
        return False

    if normalized_query in normalized_haystack:
        return True

    tokens = _query_tokens(query)
    if not tokens:
        return normalized_query in normalized_haystack

    return all(token in normalized_haystack for token in tokens)


def _nlp_intent_from_query(query: str, deterministic_intent: str) -> NLPIntentResult | None:
    settings = get_settings()
    result = classify_chatbot_intent(
        query=query,
        deterministic_intent=deterministic_intent,
        allowed_intents=NLP_ALLOWED_INTENTS,
        confidence_threshold=settings.openai_intent_confidence_threshold,
    )
    if result is None:
        return None

    return NLPIntentResult(
        intent=result.intent,
        confidence=result.confidence,
        filters=result.filters,
        explanation=result.explanation,
    )


def _resolve_chatbot_intent(
    query: str,
    query_in: ChatbotQuery | None = None,
) -> tuple[str, str, NLPIntentResult | None, dict[str, str]]:
    deterministic_intent = _intent_from_query(query, query_in)
    nlp_result = _nlp_intent_from_query(query, deterministic_intent)
    settings = get_settings()
    nlp_accepted = (
        nlp_result is not None
        and nlp_result.intent in NLP_ALLOWED_INTENTS
        and nlp_result.confidence >= settings.openai_intent_confidence_threshold
    )
    intent = nlp_result.intent if nlp_accepted and nlp_result is not None else deterministic_intent
    nlp_filters = nlp_result.filters if nlp_accepted and nlp_result is not None else {}
    return intent, deterministic_intent, nlp_result, nlp_filters


def _event_match_text(event: Event, run_group: RunGroup | None) -> str:
    return " ".join(
        part
        for part in [
            event.name,
            event.track,
            event.notes,
            _enum_text(run_group.normalized) if run_group else None,
            run_group.raw_text if run_group else None,
        ]
        if part
    )


def _driver_match_text(driver: Driver) -> str:
    return " ".join(
        part
        for part in [
            driver.driver_id,
            driver.driver_name,
            driver.first_name,
            driver.last_name,
            driver.license_number,
            driver.team_name,
            _joined_text(driver.aliases),
        ]
        if part
    )


def _vehicle_match_text(vehicle: Vehicle) -> str:
    return " ".join(
        part
        for part in [
            vehicle.vehicle_id,
            vehicle.make,
            vehicle.model,
            vehicle.registration_number,
            vehicle.vehicle_class,
            vehicle.driver_id,
            vehicle.notes,
        ]
        if part
    )


def _user_match_text(user: User) -> str:
    return " ".join(
        part
        for part in [
            user.name,
            user.email,
            _enum_text(user.role),
            _enum_text(user.approval_status),
        ]
        if part
    )


def _load_event_rows(db: Session, *, limit: int | None = None) -> list[tuple[Event, RunGroup | None]]:
    stmt = (
        select(Event, RunGroup)
        .join(RunGroup, RunGroup.event_id == Event.id, isouter=True)
        .order_by(Event.start_date.desc(), Event.created_at.desc())
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    return list(db.execute(stmt).all())


def _find_event_matches(
    db: Session,
    search_text: str,
    *,
    limit: int = 5,
) -> list[tuple[Event, RunGroup | None]]:
    if not search_text.strip():
        return []

    rows = _load_event_rows(db, limit=None)
    matches = [row for row in rows if _query_phrase_matches(_event_match_text(*row), search_text)]
    return matches[:limit]


def _find_driver_matches(
    db: Session,
    search_text: str,
    *,
    limit: int = 5,
) -> list[Driver]:
    if not search_text.strip():
        return []

    rows = _load_driver_rows(db, limit=50)
    matches = [driver for driver in rows if _query_phrase_matches(_driver_match_text(driver), search_text)]
    return matches[:limit]


def _find_user_matches(
    db: Session,
    search_text: str,
    *,
    limit: int = 5,
) -> list[User]:
    if not search_text.strip():
        return []

    rows = _load_user_rows(db, limit=50)
    matches = [user for user in rows if _query_phrase_matches(_user_match_text(user), search_text)]
    return matches[:limit]


def _find_vehicle_matches(
    db: Session,
    search_text: str,
    *,
    limit: int = 5,
) -> list[Vehicle]:
    if not search_text.strip():
        return []

    rows = _load_vehicle_rows(db, limit=50)
    matches = [vehicle for vehicle in rows if _query_phrase_matches(_vehicle_match_text(vehicle), search_text)]
    return matches[:limit]


def _extract_session_number(query: str) -> int | None:
    match = re.search(r"\bsession(?:\s+number)?\s*#?\s*(\d+)\b", query, flags=re.IGNORECASE)
    if match:
        return int(match.group(1))

    match = re.search(r"\b(?:session|seance)\s*(\d+)\b", query, flags=re.IGNORECASE)
    if match:
        return int(match.group(1))

    return None


def _extract_compare_session_numbers(query: str) -> tuple[int, int] | None:
    patterns = [
        r"\bsession(?:\s+number)?\s*#?\s*(\d+)\s*(?:vs\.?|versus|and|to|with|against)\s*(?:session(?:\s+number)?\s*#?\s*)?(\d+)\b",
        r"\bs(?:ession)?\s*#?\s*(\d+)\s*(?:vs\.?|versus|and|to|with|against)\s*s(?:ession)?\s*#?\s*(\d+)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, query, flags=re.IGNORECASE)
        if match:
            first = int(match.group(1))
            second = int(match.group(2))
            return (first, second) if first != second else None

    numbers = re.findall(r"\b(?:session|seance)\s*#?\s*(\d+)\b", query, flags=re.IGNORECASE)
    if len(numbers) >= 2:
        first = int(numbers[0])
        second = int(numbers[1])
        return (first, second) if first != second else None

    return None


def _extract_driver_query(query: str) -> str | None:
    patterns = [
        r"(?:for\s+driver|driver\s+sessions?|driver)\s+(.+)$",
        r"(?:show\s+sessions?\s+for\s+driver)\s+(.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, query, flags=re.IGNORECASE)
        if match:
            value = match.group(1).strip()
            value = re.sub(r"[\s.,;:]+$", "", value)
            if value:
                return value
    return None


def _extract_user_query(query: str) -> str | None:
    patterns = [
        r"(?:for\s+user|for\s+account)\s+(.+)$",
        r"(?:show|list|get)\s+(?:latest\s+)?(?:users|user|accounts|account)\s+(?:for|named|called)?\s+(.+)$",
        r"(?:user|account)\s+(?:details?|info|information|data)\s+(?:for)?\s+(.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, query, flags=re.IGNORECASE)
        if match:
            value = match.group(1).strip()
            value = re.sub(r"[\s.,;:?!]+$", "", value)
            if value:
                return value
    return None


def _extract_event_query(query: str) -> str | None:
    patterns = [
        r"(?:for\s+event|event)\s+(.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, query, flags=re.IGNORECASE)
        if match:
            value = match.group(1).strip()
            value = re.sub(r"[\s.,;:]+$", "", value)
            if value and value.lower() not in {"this event", "the event"}:
                return value
    return None


def _extract_car_number(query: str) -> str | None:
    patterns = [
        r"\bcar\s*#\s*([A-Za-z0-9-]+)\b",
        r"\bcar\s+(?:number|no\.?|id)\s*#?\s*([A-Za-z0-9-]+)\b",
        r"\bvehicle\s*#?\s*([A-Za-z0-9-]+)\b",
        r"\bcar\s+([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, query, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


def _has_session_term(text: str) -> bool:
    if "session" in text or "seance" in text:
        return True
    if "run group" in text:
        return False
    return re.search(r"\bruns?\b", text) is not None


def _extract_session_date_filter(query: str, *, today: date | None = None) -> tuple[date | None, str | None]:
    text_value = query.lower()
    reference = today or date.today()
    if re.search(r"\btoday(?:['’]s)?\b", text_value):
        return reference, "today"
    if re.search(r"\byesterday(?:['’]s)?\b", text_value):
        return reference - timedelta(days=1), "yesterday"
    return None, None


def _extract_time_window(query: str) -> str | None:
    text_value = query.lower()
    for key in SESSION_TIME_WINDOWS:
        if re.search(rf"\b{key}\b", text_value):
            return key
    return None


def _session_matches_time_window(session: Seance, time_window: str | None) -> bool:
    if not time_window:
        return True

    session_time = session.session_time
    if session_time is None:
        return False

    start, end, _ = SESSION_TIME_WINDOWS[time_window]
    if session_time < start:
        return False
    return end is None or session_time < end


def _session_scope_note(
    *,
    session_date: date | None = None,
    session_date_label: str | None = None,
    time_window: str | None = None,
) -> str | None:
    notes: list[str] = []
    if session_date is not None:
        label = session_date_label or _date_text(session_date)
        notes.append(f"Scoped to {label} ({_date_text(session_date)}).")
    if time_window:
        notes.append(f"Scoped to the {SESSION_TIME_WINDOWS[time_window][2]} session window.")
    return " ".join(notes) if notes else None


def _session_event_match(session: Seance, event_rows: list[tuple[Event, RunGroup | None]]) -> tuple[Event | None, RunGroup | None]:
    for event, run_group in event_rows:
        if event.start_date.date() <= session.session_date <= event.end_date.date():
            return event, run_group
    return None, None


def _build_candidate_table(
    *,
    title: str,
    subtitle: str,
    headers: list[str],
    rows: list[list[str]],
    icon_key: str,
) -> ChatbotSection:
    return _section(
        title,
        subtitle=subtitle,
        variant="table",
        icon_key=icon_key,
        table_headers=headers,
        table_rows=rows,
    )


def _selection_response(
    *,
    title: str,
    message: str,
    intent: str,
    section: ChatbotSection,
    records_used: list[ChatbotRecordReference] | None = None,
    follow_up: list[str] | None = None,
) -> ChatbotResponse:
    records_used = records_used or []
    return ChatbotResponse(
        kind="message",
        title=title,
        summary=message,
        answer=message,
        source_label=SOURCE_LABEL,
        data_found=bool(records_used or section.table_rows or section.cards or section.fields),
        intent=intent,
        status="needs_context",
        data=_response_data(sections=[section], records_used=records_used, message=message),
        records_used=records_used,
        sections=[section],
        follow_up=follow_up or ["Show latest sessions", "Show all events", "Show driver and vehicle data"],
        generated_at=datetime.utcnow(),
    )


def _not_found_response(
    title: str,
    message: str,
    *,
    intent: str,
    follow_up: list[str] | None = None,
    data: dict[str, Any] | list[Any] | None = None,
) -> ChatbotResponse:
    return ChatbotResponse(
        kind="empty",
        title=title,
        summary=message,
        answer=message,
        source_label=SOURCE_LABEL,
        data_found=False,
        no_data_message=message,
        intent=intent,
        status="not_found",
        data=data or {"message": message},
        follow_up=follow_up or DEFAULT_FOLLOW_UPS,
        generated_at=datetime.utcnow(),
    )


def _unsupported_response(
    title: str,
    message: str,
    *,
    intent: str,
    sections: list[ChatbotSection] | None = None,
    records_used: list[ChatbotRecordReference] | None = None,
    follow_up: list[str] | None = None,
    data: dict[str, Any] | list[Any] | None = None,
) -> ChatbotResponse:
    return ChatbotResponse(
        kind="message",
        title=title,
        summary=message,
        answer=message,
        source_label=SOURCE_LABEL,
        data_found=bool(sections or records_used),
        intent=intent,
        status="unsupported",
        data=data or _response_data(sections=sections, records_used=records_used, message=message),
        sections=sections or [],
        records_used=records_used or [],
        follow_up=follow_up or DEFAULT_FOLLOW_UPS,
        generated_at=datetime.utcnow(),
    )


def _needs_context_response(
    title: str,
    message: str,
    *,
    intent: str,
    sections: list[ChatbotSection] | None = None,
    records_used: list[ChatbotRecordReference] | None = None,
    follow_up: list[str] | None = None,
    data: dict[str, Any] | list[Any] | None = None,
) -> ChatbotResponse:
    return ChatbotResponse(
        kind="message",
        title=title,
        summary=message,
        answer=message,
        source_label=SOURCE_LABEL,
        data_found=bool(sections or records_used),
        intent=intent,
        status="needs_context",
        data=data or _response_data(sections=sections, records_used=records_used, message=message),
        sections=sections or [],
        records_used=records_used or [],
        follow_up=follow_up or ["Show latest sessions", "Show all events", "Show driver and vehicle data"],
        generated_at=datetime.utcnow(),
    )


def _greeting_response(query: str = "", *, intent: str | None = None) -> ChatbotResponse:
    message, follow_up = _greeting_message_for_query(query)
    resolved_intent = intent or _greeting_style_for_query(query)
    return ChatbotResponse(
        kind="message",
        title="AI Race Assistant",
        summary=message,
        answer=message,
        data_source="SM Racing Assistant",
        source_label="SM Racing Assistant",
        data_found=True,
        intent=resolved_intent,
        status="success",
        data={
            "message": message,
            "response_type": "greeting",
            "greeting_style": _greeting_style_for_query(query),
            "intent_group": _route_group_for_intent(resolved_intent),
            "routing_mode": INTENT_ROUTING_TABLE.get(resolved_intent, {}).get("mode", "preset"),
        },
        follow_up=follow_up,
        generated_at=datetime.utcnow(),
    )


def _session_heading(session: Seance) -> str:
    return f"Session {session.session_number}"


def _session_choice(
    session: Seance,
    driver: Driver | None,
    vehicle: Vehicle | None,
    *,
    event_id: str | None = None,
) -> ChatbotSessionChoice:
    return ChatbotSessionChoice(
        value=session.id_seance,
        label=_session_heading(session),
        sublabel=(
            f"{session.track} | {_driver_name(driver, session.driver_id)} | "
            f"{_vehicle_name(vehicle, session.vehicle_id)} | {_date_text(session.session_date)} "
            f"{_time_text(session.session_time)}"
        ),
        session_date=session.session_date,
        session_time=session.session_time,
        track=session.track,
        event_id=event_id,
        driver_id=session.driver_id,
        vehicle_id=session.vehicle_id,
        tone=_tone_for_status(_session_status_value(session)),
    )


def _event_choice(event: Event, run_group: RunGroup | None) -> ChatbotEventChoice:
    sublabel = f"{event.track} | {_date_text(event.start_date)} - {_date_text(event.end_date)}"
    if run_group is not None:
        sublabel = f"{sublabel} | {_enum_text(run_group.normalized)}"

    return ChatbotEventChoice(
        value=str(event.id),
        label=event.name,
        sublabel=sublabel,
        start_date=event.start_date.date(),
        end_date=event.end_date.date(),
        tone=_tone_for_active(event.is_active),
    )


def _session_stmt(
    *,
    event: Event | None = None,
    driver_id: str | None = None,
    vehicle_id: str | None = None,
    session_date: date | None = None,
) -> object:
    stmt = (
        select(Seance, Driver, Vehicle)
        .options(*_session_load_options())
        .join(Driver, Driver.driver_id == Seance.driver_id, isouter=True)
        .join(Vehicle, Vehicle.vehicle_id == Seance.vehicle_id, isouter=True)
    )

    if event is not None:
        stmt = stmt.where(
            and_(
                Seance.session_date >= event.start_date.date(),
                Seance.session_date <= event.end_date.date(),
            )
        )

    if driver_id:
        stmt = stmt.where(Seance.driver_id == driver_id)

    if vehicle_id:
        stmt = stmt.where(Seance.vehicle_id == vehicle_id)

    if session_date is not None:
        stmt = stmt.where(Seance.session_date == session_date)

    return stmt.order_by(
        Seance.session_date.desc(),
        Seance.session_time.desc().nullslast(),
        Seance.created_at.desc(),
    )


def _load_session_rows(
    db: Session,
    *,
    event: Event | None = None,
    driver_id: str | None = None,
    vehicle_id: str | None = None,
    session_date: date | None = None,
    time_window: str | None = None,
    limit: int | None = 10,
) -> list[tuple[Seance, Driver | None, Vehicle | None]]:
    stmt = _session_stmt(event=event, driver_id=driver_id, vehicle_id=vehicle_id, session_date=session_date)
    needs_post_filter = time_window is not None
    if limit is not None and not needs_post_filter:
        stmt = stmt.limit(limit)
    rows = list(db.execute(stmt).all())
    if needs_post_filter:
        rows = [row for row in rows if _session_matches_time_window(row[0], time_window)]
        if limit is not None:
            rows = rows[:limit]
    return rows


def _load_session_bundle(db: Session, session_id: str) -> SessionBundle | None:
    row = db.execute(
        select(Seance, Driver, Vehicle)
        .options(*_session_load_options())
        .join(Driver, Driver.driver_id == Seance.driver_id, isouter=True)
        .join(Vehicle, Vehicle.vehicle_id == Seance.vehicle_id, isouter=True)
        .where(Seance.id_seance == session_id)
    ).first()

    if row is None:
        return None

    session, driver, vehicle = row
    return SessionBundle(session=session, driver=driver, vehicle=vehicle)


def _session_in_event_window(session: Seance, event: Event) -> bool:
    return event.start_date.date() <= session.session_date <= event.end_date.date()


def _select_anchor_session(
    db: Session,
    *,
    event: Event | None,
    session_id: str | None,
    driver_id: str | None = None,
    vehicle_id: str | None = None,
    session_date: date | None = None,
    time_window: str | None = None,
) -> SessionBundle | None:
    if session_id:
        bundle = _load_session_bundle(db, session_id)
        if bundle is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        if event is not None and not _session_in_event_window(bundle.session, event):
            return None
        if driver_id and bundle.session.driver_id != driver_id:
            return None
        if vehicle_id and bundle.session.vehicle_id != vehicle_id:
            return None
        return bundle

    rows = _load_session_rows(
        db,
        event=event,
        driver_id=driver_id,
        vehicle_id=vehicle_id,
        session_date=session_date,
        time_window=time_window,
        limit=1,
    )
    if not rows:
        return None

    session, driver, vehicle = rows[0]
    return SessionBundle(session=session, driver=driver, vehicle=vehicle)


def _bundle_from_row(row: tuple[Seance, Driver | None, Vehicle | None]) -> SessionBundle:
    session, driver, vehicle = row
    return SessionBundle(session=session, driver=driver, vehicle=vehicle)


def _load_session_rows_by_number(
    db: Session,
    *,
    session_number: int,
    event: Event | None = None,
    driver_id: str | None = None,
    vehicle_id: str | None = None,
    session_date: date | None = None,
    time_window: str | None = None,
) -> list[tuple[Seance, Driver | None, Vehicle | None]]:
    rows = _load_session_rows(
        db,
        event=event,
        driver_id=driver_id,
        vehicle_id=vehicle_id,
        session_date=session_date,
        time_window=time_window,
        limit=None,
    )
    return [row for row in rows if row[0].session_number == session_number]


def _latest_bundle_with_record(
    db: Session,
    *,
    model: type[Any],
    event: Event | None = None,
    driver_id: str | None = None,
    vehicle_id: str | None = None,
    session_date: date | None = None,
    time_window: str | None = None,
) -> SessionBundle | None:
    rows = _load_session_rows(
        db,
        event=event,
        driver_id=driver_id,
        vehicle_id=vehicle_id,
        session_date=session_date,
        time_window=time_window,
        limit=None,
    )
    for session, driver, vehicle in rows:
        if db.scalar(select(model).where(model.id_seance == session.id_seance)) is not None:
            return SessionBundle(session=session, driver=driver, vehicle=vehicle)
    return None


def _setup_focus_scope_note(
    *,
    session_date: date | None = None,
    session_date_label: str | None = None,
    time_window: str | None = None,
    focus_note: str,
) -> str:
    return " ".join(
        item
        for item in [
            _session_scope_note(
                session_date=session_date,
                session_date_label=session_date_label,
                time_window=time_window,
            ),
            focus_note,
        ]
        if item
    )


def _resolve_setup_section_bundle(
    db: Session,
    *,
    event: Event | None,
    session_bundle: SessionBundle | None,
    query_in: ChatbotQuery,
    session_number: int | None,
    vehicle_filter_id: str | None,
    session_date: date | None,
    time_window: str | None,
    model: type[Any],
) -> SessionBundle | None:
    if query_in.session_id:
        return session_bundle

    if session_number is not None:
        rows = _load_session_rows_by_number(
            db,
            session_number=session_number,
            event=event,
            driver_id=query_in.driver_id,
            vehicle_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
        )
        return _bundle_from_row(rows[0]) if rows else None

    return _latest_bundle_with_record(
        db,
        model=model,
        event=event,
        driver_id=query_in.driver_id,
        vehicle_id=vehicle_filter_id,
        session_date=session_date,
        time_window=time_window,
    )


def _event_cards(rows: list[tuple[Event, RunGroup | None]]) -> list[ChatbotCard]:
    cards: list[ChatbotCard] = []
    for event, run_group in rows:
        cards.append(
            _card(
                event.name,
                subtitle=f"{event.track} | {_date_text(event.start_date)} - {_date_text(event.end_date)}",
                badge="Active" if event.is_active else "Archived",
                badge_tone=_tone_for_active(event.is_active),
                icon_key="event",
                fields=[
                    _field("Track", event.track),
                    _field("Start", _date_text(event.start_date)),
                    _field("End", _date_text(event.end_date)),
                    _field("Run group", run_group.normalized if run_group else None),
                    _field("Notes", event.notes or "No notes"),
                ],
            )
        )
    return cards


def _session_cards(
    rows: list[tuple[Seance, Driver | None, Vehicle | None]],
    *,
    event_rows: list[tuple[Event, RunGroup | None]] | None = None,
    include_event: bool = False,
    include_run_group: bool = False,
    include_created: bool = False,
) -> list[ChatbotCard]:
    cards: list[ChatbotCard] = []
    for session, driver, vehicle in rows:
        event: Event | None = None
        run_group: RunGroup | None = None
        if event_rows is not None:
            event, run_group = _session_event_match(session, event_rows)

        fields = [
            _field("Session ID", session.id_seance),
            _field("Driver", _driver_name(driver, session.driver_id)),
            _field("Vehicle", _vehicle_name(vehicle, session.vehicle_id)),
            _field("Type", session.session_type or "Not available"),
            _field("Duration", _duration_text(session.duration_min)),
            _field("Tire set", session.tire_set or "Not available"),
            _field("Created by", session.created_by),
        ]
        if include_event:
            fields.insert(0, _field("Event", event.name if event is not None else "Not available"))
        if include_run_group:
            fields.insert(
                1 if include_event else 0,
                _field("Run group", _enum_text(run_group.normalized) if run_group is not None else "Not available"),
            )
        if include_created:
            fields.append(_field("Created", _datetime_text(session.created_at)))
        fields.append(_field("Status", _humanize_enum(_session_status_value(session))))

        cards.append(
            _card(
                _session_heading(session),
                subtitle=f"{session.track} | {_date_text(session.session_date)} {_time_text(session.session_time)}",
                badge=_humanize_enum(_session_status_value(session)),
                badge_tone=_tone_for_status(_session_status_value(session)),
                icon_key="session",
                fields=fields,
            )
        )
    return cards


def _pressure_section(pressure: Pressure | None) -> ChatbotSection:
    if pressure is None:
        return _section(
            "Pressures",
            subtitle="No pressure record was stored for this session.",
            variant="fields",
            icon_key="pressure",
            fields=[_field("Pressures", "No pressure record was stored for this session.")],
        )

    cards = [
        _card(
            "Front Left",
            subtitle="FL",
            icon_key="pressure",
            fields=[_field("Cold", _decimal_text(pressure.cold_fl)), _field("Hot", _decimal_text(pressure.hot_fl))],
        ),
        _card(
            "Front Right",
            subtitle="FR",
            icon_key="pressure",
            fields=[_field("Cold", _decimal_text(pressure.cold_fr)), _field("Hot", _decimal_text(pressure.hot_fr))],
        ),
        _card(
            "Rear Left",
            subtitle="RL",
            icon_key="pressure",
            fields=[_field("Cold", _decimal_text(pressure.cold_rl)), _field("Hot", _decimal_text(pressure.hot_rl))],
        ),
        _card(
            "Rear Right",
            subtitle="RR",
            icon_key="pressure",
            fields=[_field("Cold", _decimal_text(pressure.cold_rr)), _field("Hot", _decimal_text(pressure.hot_rr))],
        ),
    ]

    return _section("Pressures", variant="cards", icon_key="pressure", cards=cards)


def _suspension_section(suspension: Suspension | None) -> ChatbotSection:
    if suspension is None:
        return _section(
            "Suspension",
            subtitle="No suspension record was stored for this session.",
            variant="fields",
            icon_key="suspension",
            fields=[_field("Suspension", "No suspension record was stored for this session.")],
        )

    return _section(
        "Suspension",
        variant="fields",
        icon_key="suspension",
        fields=[
            _field("Rebound FL", _decimal_text(suspension.rebound_fl, 0)),
            _field("Rebound FR", _decimal_text(suspension.rebound_fr, 0)),
            _field("Rebound RL", _decimal_text(suspension.rebound_rl, 0)),
            _field("Rebound RR", _decimal_text(suspension.rebound_rr, 0)),
            _field("Bump FL", _decimal_text(suspension.bump_fl, 0)),
            _field("Bump FR", _decimal_text(suspension.bump_fr, 0)),
            _field("Bump RL", _decimal_text(suspension.bump_rl, 0)),
            _field("Bump RR", _decimal_text(suspension.bump_rr, 0)),
            _field("Sway bar F", suspension.sway_bar_f or "Not available"),
            _field("Sway bar R", suspension.sway_bar_r or "Not available"),
            _field("Wing angle", _decimal_text(suspension.wing_angle_deg)),
        ],
    )


def _alignment_section(alignment: Alignment | None) -> ChatbotSection:
    if alignment is None:
        return _section(
            "Alignment",
            subtitle="No alignment record was stored for this session.",
            variant="fields",
            icon_key="alignment",
            fields=[_field("Alignment", "No alignment record was stored for this session.")],
        )

    return _section(
        "Alignment",
        variant="fields",
        icon_key="alignment",
        fields=[
            _field("Camber FL", _decimal_text(alignment.camber_fl)),
            _field("Camber FR", _decimal_text(alignment.camber_fr)),
            _field("Camber RL", _decimal_text(alignment.camber_rl)),
            _field("Camber RR", _decimal_text(alignment.camber_rr)),
            _field("Toe front", alignment.toe_front or "Not available"),
            _field("Toe rear", alignment.toe_rear or "Not available"),
            _field("Caster L", _decimal_text(alignment.caster_l)),
            _field("Caster R", _decimal_text(alignment.caster_r)),
            _field("Ride height F", _decimal_text(alignment.ride_height_f)),
            _field("Ride height R", _decimal_text(alignment.ride_height_r)),
            _field("Corner weight FL", _decimal_text(alignment.corner_weight_fl)),
            _field("Corner weight FR", _decimal_text(alignment.corner_weight_fr)),
            _field("Corner weight RL", _decimal_text(alignment.corner_weight_rl)),
            _field("Corner weight RR", _decimal_text(alignment.corner_weight_rr)),
            _field("Cross weight", _decimal_text(alignment.cross_weight_pct)),
            _field("Rake", _decimal_text(alignment.rake_mm)),
            _field("Wheelbase", _decimal_text(alignment.wheelbase_mm)),
        ],
    )


def _temperature_section(temperature: TireTemperature | None) -> ChatbotSection:
    if temperature is None:
        return _section(
            "Tire temperatures",
            subtitle="No tire temperature record was stored for this session.",
            variant="fields",
            icon_key="temperature",
            fields=[_field("Tire temperatures", "No tire temperature record was stored for this session.")],
        )

    cards = [
        _card(
            "Front Left",
            subtitle="FL",
            icon_key="temperature",
            fields=[
                _field("Inner", _decimal_text(temperature.fl_in)),
                _field("Middle", _decimal_text(temperature.fl_mid)),
                _field("Outer", _decimal_text(temperature.fl_out)),
            ],
        ),
        _card(
            "Front Right",
            subtitle="FR",
            icon_key="temperature",
            fields=[
                _field("Inner", _decimal_text(temperature.fr_in)),
                _field("Middle", _decimal_text(temperature.fr_mid)),
                _field("Outer", _decimal_text(temperature.fr_out)),
            ],
        ),
        _card(
            "Rear Left",
            subtitle="RL",
            icon_key="temperature",
            fields=[
                _field("Inner", _decimal_text(temperature.rl_in)),
                _field("Middle", _decimal_text(temperature.rl_mid)),
                _field("Outer", _decimal_text(temperature.rl_out)),
            ],
        ),
        _card(
            "Rear Right",
            subtitle="RR",
            icon_key="temperature",
            fields=[
                _field("Inner", _decimal_text(temperature.rr_in)),
                _field("Middle", _decimal_text(temperature.rr_mid)),
                _field("Outer", _decimal_text(temperature.rr_out)),
            ],
        ),
    ]

    return _section("Tire temperatures", variant="cards", icon_key="temperature", cards=cards)


def _history_section(db: Session, session: Seance) -> ChatbotSection:
    rows = list(
        db.execute(
            select(TireHistory, TireInventory)
            .join(TireInventory, TireInventory.tire_id == TireHistory.tire_id, isouter=True)
            .where(TireHistory.id_seance == session.id_seance)
            .order_by(TireHistory.created_at.desc(), TireHistory.tire_id.asc())
            .limit(8)
        ).all()
    )

    if not rows:
        return _section(
            "Tire history",
            subtitle="No tire history rows were stored for this session.",
            variant="fields",
            icon_key="history",
            fields=[_field("Tire history", "No tire history rows were stored for this session.")],
        )

    cards: list[ChatbotCard] = []
    for history, inventory in rows:
        subtitle = _text(
            inventory.manufacturer if inventory else None,
            fallback=_text(history.track, "Tire history"),
        )
        cards.append(
            _card(
                history.tire_id,
                subtitle=subtitle,
                icon_key="history",
                fields=[
                    _field("Usage date", _date_text(history.usage_date)),
                    _field("Track", history.track or "Not available"),
                    _field("Duration", _duration_text(history.duration_min)),
                    _field("Heat cycles", _decimal_text(inventory.heat_cycles, 0) if inventory else "Not available"),
                    _field("Manufacturer", inventory.manufacturer if inventory else "Not available"),
                    _field("Model", inventory.model if inventory and inventory.model else "Not available"),
                    _field("Status", _humanize_enum(inventory.status) if inventory else "Not available"),
                ],
            )
        )

    return _section("Tire history", variant="cards", icon_key="history", cards=cards)


def _submission_metadata_section(db: Session, session: Seance) -> tuple[ChatbotSection, list[ChatbotRecordReference]]:
    rows = _load_submission_input_rows(db, session_id=session.id_seance, limit=8)
    if not rows:
        return (
            _section(
                "Submission metadata",
                subtitle="No submission metadata was stored for this session.",
                variant="fields",
                icon_key="default",
                fields=[_field("Submission metadata", "No submission metadata was stored for this session.")],
            ),
            [],
        )

    cards: list[ChatbotCard] = []
    references: list[ChatbotRecordReference] = []
    for row in rows:
        submission_id = row.get("submission_id")
        submission_type = _text(row.get("submission_type"), "Submission input")
        source = _text(row.get("source"))
        validation_status = _text(row.get("validation_status"))
        confidence = row.get("confidence")
        cards.append(
            _card(
                f"Submission {submission_id}",
                subtitle=f"{submission_type} | {source} | {validation_status}",
                icon_key="default",
                fields=[
                    _field("Session", session.id_seance),
                    _field("Submission type", submission_type),
                    _field("Source", source),
                    _field("Confidence", _decimal_text(confidence, 2) if confidence is not None else "Not available"),
                    _field("Created by", row.get("created_by")),
                    _field("Validation", validation_status),
                    _field("Validation message", row.get("validation_message") or "Not available"),
                ],
            )
        )
        references.append(
            _record_reference(
                "submission_input",
                submission_id,
                submission_type,
                details=f"{source} | {validation_status}",
            )
        )

    return (
        _section(
            "Submission metadata",
            subtitle="Structured submission inputs attached to this session.",
            variant="cards",
            icon_key="default",
            cards=cards,
        ),
        references,
    )


def _session_metadata_section(
    bundle: SessionBundle,
    pressure: Pressure | None,
    *,
    event: Event | None = None,
    run_group: RunGroup | None = None,
) -> ChatbotSection:
    session = bundle.session
    fields = [
        _field("Session", _session_heading(session)),
        _field("Session ID", session.id_seance),
        _field("Date", _date_text(session.session_date)),
        _field("Time", _time_text(session.session_time)),
        _field("Track", session.track),
        _field("Driver", _driver_name(bundle.driver, session.driver_id)),
        _field("Vehicle", _vehicle_name(bundle.vehicle, session.vehicle_id)),
        _field("Type", session.session_type or "Not available"),
        _field("Duration", _duration_text(session.duration_min)),
        _field("Tire set", session.tire_set or "Not available"),
        _field("Status", _humanize_enum(_session_status_value(session))),
        _field("Pressure record", "Available" if pressure else "Not available"),
    ]

    if event is not None:
        fields = [
            _field("Event", event.name),
            _field("Event track", event.track),
            _field("Event dates", f"{_date_text(event.start_date)} - {_date_text(event.end_date)}"),
            _field("Run group", _enum_text(run_group.normalized) if run_group else "Not available"),
            *fields,
        ]

    return _section(
        "Session metadata",
        subtitle="Driver, vehicle, and session context for the selected setup record.",
        variant="fields",
        icon_key="session",
        fields=fields,
    )


def _session_summary(bundle: SessionBundle, *, scope_note: str | None = None) -> str:
    session = bundle.session
    lines = [
        f"Here is {_session_heading(session)} from the SM2 Racing database.",
        f"{_driver_name(bundle.driver, session.driver_id)} in {_vehicle_name(bundle.vehicle, session.vehicle_id)} at {session.track}.",
    ]
    if scope_note:
        lines.append(scope_note)
    return "\n\n".join(lines)


def _setup_response(
    db: Session,
    *,
    bundle: SessionBundle,
    event: Event | None = None,
    pressure_focus_only: bool = False,
    title: str = "Setup Sheet",
    intent: str = "setup_latest_session",
) -> ChatbotResponse:
    session = bundle.session
    run_group = db.scalar(select(RunGroup).where(RunGroup.event_id == event.id)) if event is not None else None
    pressure = db.scalar(select(Pressure).where(Pressure.id_seance == session.id_seance))
    suspension = db.scalar(select(Suspension).where(Suspension.id_seance == session.id_seance))
    alignment = db.scalar(select(Alignment).where(Alignment.id_seance == session.id_seance))
    temperature = db.scalar(select(TireTemperature).where(TireTemperature.id_seance == session.id_seance))
    submission_section, submission_refs = _submission_metadata_section(db, session)

    sections = [
        _session_metadata_section(bundle, pressure, event=event, run_group=run_group),
        _pressure_section(pressure),
    ]
    if not pressure_focus_only:
        sections.extend(
            [
                _suspension_section(suspension),
                _alignment_section(alignment),
                _temperature_section(temperature),
                _history_section(db, session),
                submission_section,
            ]
        )

    records_used = [
        _record_reference("session", session.id_seance, _session_heading(session), details=session.track),
        _record_reference("driver", bundle.driver.driver_id if bundle.driver else session.driver_id, _driver_name(bundle.driver, session.driver_id)),
        _record_reference("vehicle", bundle.vehicle.vehicle_id if bundle.vehicle else session.vehicle_id, _vehicle_name(bundle.vehicle, session.vehicle_id)),
    ]
    if event is not None:
        records_used.append(_record_reference("event", event.id, event.name, details=event.track))
    records_used.extend(submission_refs)

    summary = _session_summary(
        bundle,
        scope_note=(
            "The pressure summary is shown first, followed by the recorded setup detail."
            if pressure_focus_only
            else "The key setup sections below cover pressures, suspension, alignment, tire temperatures, and tire history."
        ),
    )

    return ChatbotResponse(
        kind="setup",
        title=title,
        summary=summary,
        answer=summary,
        source_label=SOURCE_LABEL,
        data_found=True,
        records_used=records_used,
        intent=intent,
        data=_response_data(sections=sections, records_used=records_used, session_id=session.id_seance),
        sections=sections,
        follow_up=["Compare sessions", "Show latest sessions", "Show driver and vehicle data"],
        generated_at=datetime.utcnow(),
    )


def _session_focus_response(
    db: Session,
    *,
    bundle: SessionBundle,
    detail_section: ChatbotSection,
    title: str,
    summary: str,
    intent: str,
    event: Event | None = None,
    follow_up: list[str] | None = None,
) -> ChatbotResponse:
    session = bundle.session
    pressure = db.scalar(select(Pressure).where(Pressure.id_seance == session.id_seance))
    sections = [_session_metadata_section(bundle, pressure, event=event), detail_section]
    records_used = [
        _record_reference("session", session.id_seance, _session_heading(session), details=session.track),
        _record_reference(
            "driver",
            bundle.driver.driver_id if bundle.driver else session.driver_id,
            _driver_name(bundle.driver, session.driver_id),
        ),
        _record_reference(
            "vehicle",
            bundle.vehicle.vehicle_id if bundle.vehicle else session.vehicle_id,
            _vehicle_name(bundle.vehicle, session.vehicle_id),
        ),
    ]
    if event is not None:
        records_used.append(_record_reference("event", event.id, event.name, details=event.track))

    return ChatbotResponse(
        kind="setup",
        title=title,
        summary=summary,
        answer=summary,
        source_label=SOURCE_LABEL,
        data_found=True,
        records_used=records_used,
        intent=intent,
        data=_response_data(sections=sections, records_used=records_used, session_id=session.id_seance),
        sections=sections,
        follow_up=follow_up or ["Show setup for latest session", "Show latest sessions", "Show driver and vehicle data"],
        generated_at=datetime.utcnow(),
    )


def _error_response(title: str, message: str, *, intent: str) -> ChatbotResponse:
    return ChatbotResponse(
        kind="message",
        title=title,
        summary=message,
        answer=message,
        source_label=SOURCE_LABEL,
        data_found=False,
        intent=intent,
        status="error",
        data={"message": message},
        follow_up=DEFAULT_FOLLOW_UPS,
        generated_at=datetime.utcnow(),
    )


def _resolve_chat_write_bundle(
    db: Session,
    *,
    event: Event | None,
    event_rows: list[tuple[Event, RunGroup | None]],
    session_bundle: SessionBundle | None,
    query_in: ChatbotQuery,
    session_number: int | None,
    vehicle_filter_id: str | None,
    session_date: date | None,
    time_window: str | None,
    intent: str,
) -> tuple[SessionBundle | None, ChatbotResponse | None]:
    if query_in.session_id:
        return session_bundle, None

    if session_number is not None:
        rows = _load_session_rows_by_number(
            db,
            session_number=session_number,
            event=event,
            driver_id=query_in.driver_id,
            vehicle_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
        )
        if not rows:
            return None, None
        if len(rows) > 1 and event is None:
            records_used = [
                _record_reference(
                    "session",
                    row_session.id_seance,
                    _session_heading(row_session),
                    details=f"{row_session.track} | {_date_text(row_session.session_date)}",
                )
                for row_session, _, _ in rows
            ]
            section = _build_candidate_table(
                title="Matching sessions",
                subtitle="Multiple session records match that number. Please choose one before applying a chat update.",
                headers=["Session", "Event", "Date", "Driver", "Vehicle"],
                rows=[
                    [
                        _session_heading(row_session),
                        (
                            _session_event_match(row_session, event_rows)[0].name
                            if _session_event_match(row_session, event_rows)[0]
                            else "Not available"
                        ),
                        _date_text(row_session.session_date),
                        _driver_name(row_driver, row_session.driver_id),
                        _vehicle_name(row_vehicle, row_session.vehicle_id),
                    ]
                    for row_session, row_driver, row_vehicle in rows
                ],
                icon_key="session",
            )
            return None, _selection_response(
                title="Choose a session",
                message=MULTIPLE_SESSION_MATCH_MESSAGE.format(number=session_number),
                intent=intent,
                section=section,
                records_used=records_used,
            )
        return _bundle_from_row(rows[0]), None

    return (
        _select_anchor_session(
            db,
            event=event,
            session_id=None,
            driver_id=query_in.driver_id,
            vehicle_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
        ),
        None,
    )


def _format_setup_value(value: object | None) -> str:
    if value is None:
        return "Not available"
    if isinstance(value, (Decimal, int, float)):
        return _decimal_text(value)
    return _text(value)


def _setup_row_for_change(db: Session, session_id: str, definition: SetupFieldDefinition) -> Any:
    row = db.get(definition.model, session_id)
    if row is None:
        row = definition.model(id_seance=session_id)
        db.add(row)
        db.flush()
    return row


def _write_chatbot_audit_log(
    db: Session,
    *,
    action: str,
    session_id: str,
    message: str,
    payload: dict[str, Any],
    actor: str,
) -> None:
    payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    attempts = [
        (
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
                :actor,
                now()
            )
            """,
            {
                "action": action,
                "status": "SUCCESS",
                "message": message,
                "payload": payload_json,
                "actor": actor,
            },
        ),
        (
            f"""
            INSERT INTO {_table("logs")} (
                action,
                status,
                entity_type,
                entity_id,
                message,
                payload,
                logged_at
            ) VALUES (
                :action,
                :status,
                'seance',
                :entity_id,
                :message,
                CAST(:payload AS jsonb),
                now()
            )
            """,
            {
                "action": action,
                "status": "SUCCESS",
                "entity_id": session_id,
                "message": message,
                "payload": payload_json,
            },
        ),
    ]

    for statement, params in attempts:
        try:
            with db.begin_nested():
                db.execute(text(statement), params)
            return
        except Exception:
            logger.debug("Chatbot audit log shape did not match for action %s", action, exc_info=True)

    logger.warning("Chatbot audit log skipped for action %s session=%s", action, session_id)


def _setup_update_response(
    db: Session,
    *,
    bundle: SessionBundle,
    changes: list[ParsedSetupChange],
    query: str,
    current_user: User | None,
    event: Event | None = None,
) -> ChatbotResponse:
    if not changes:
        return _unsupported_response(
            "Setup Update",
            "I could not find any supported setup fields to update. Try a specific command like 'Set LF cold pressure to 22.5 for Session 2.'",
            intent="update_setup_fields",
            follow_up=["Set LF cold pressure to 22.5 for Session 2", "Set LF camber to -3.2", "Log note: car felt loose"],
        )

    actor = _actor_label(current_user)
    session = bundle.session
    table_rows: list[list[str]] = []
    change_payload: list[dict[str, Any]] = []
    touched_sections: set[str] = set()

    try:
        for change in changes:
            definition = change.definition
            row = _setup_row_for_change(db, session.id_seance, definition)
            old_value = getattr(row, definition.attribute, None)
            setattr(row, definition.attribute, change.value)
            touched_sections.add(definition.section)
            table_rows.append(
                [
                    definition.section.replace("_", " ").title(),
                    definition.label,
                    _format_setup_value(old_value),
                    _format_setup_value(change.value),
                ]
            )
            change_payload.append(
                {
                    "section": definition.section,
                    "field": definition.attribute,
                    "label": definition.label,
                    "old_value": _format_setup_value(old_value),
                    "new_value": _format_setup_value(change.value),
                }
            )

        _write_chatbot_audit_log(
            db,
            action="chatbot.setup.update",
            session_id=session.id_seance,
            message=query,
            payload={"changes": change_payload, "session_id": session.id_seance, "actor": actor},
            actor=actor,
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Chatbot setup update failed for session=%s", session.id_seance)
        return _error_response(
            "Setup Update Failed",
            f"I could not apply the setup update: {_text(exc)}",
            intent="update_setup_fields",
        )

    pressure = db.scalar(select(Pressure).where(Pressure.id_seance == session.id_seance))
    suspension = db.scalar(select(Suspension).where(Suspension.id_seance == session.id_seance))
    alignment = db.scalar(select(Alignment).where(Alignment.id_seance == session.id_seance))
    temperature = db.scalar(select(TireTemperature).where(TireTemperature.id_seance == session.id_seance))
    sections = [
        _session_metadata_section(bundle, pressure, event=event),
        _section(
            "Applied setup changes",
            subtitle="Only the fields listed here were changed; all other setup values were preserved.",
            variant="table",
            icon_key="compare",
            table_headers=["Section", "Field", "Old value", "New value"],
            table_rows=table_rows,
        ),
    ]
    if "pressures" in touched_sections:
        sections.append(_pressure_section(pressure))
    if "suspension" in touched_sections:
        sections.append(_suspension_section(suspension))
    if "alignment" in touched_sections:
        sections.append(_alignment_section(alignment))
    if "tire_temperatures" in touched_sections:
        sections.append(_temperature_section(temperature))

    records_used = [
        _record_reference("session", session.id_seance, _session_heading(session), details=session.track),
        _record_reference("driver", bundle.driver.driver_id if bundle.driver else session.driver_id, _driver_name(bundle.driver, session.driver_id)),
        _record_reference("vehicle", bundle.vehicle.vehicle_id if bundle.vehicle else session.vehicle_id, _vehicle_name(bundle.vehicle, session.vehicle_id)),
    ]
    if event is not None:
        records_used.append(_record_reference("event", event.id, event.name, details=event.track))

    summary = (
        f"Applied {len(table_rows)} setup update(s) to {_session_heading(session)}. "
        "Unmentioned setup fields were left unchanged."
    )
    return ChatbotResponse(
        kind="setup",
        title="Setup Updated",
        summary=summary,
        answer=summary,
        source_label=SOURCE_LABEL,
        data_found=True,
        records_used=records_used,
        intent="update_setup_fields",
        data=_response_data(
            sections=sections,
            records_used=records_used,
            session_id=session.id_seance,
            changes=change_payload,
        ),
        sections=sections,
        follow_up=["Compare sessions", "Show setup for latest session", "Log note: setup change applied"],
        generated_at=datetime.utcnow(),
    )


def _note_log_response(
    db: Session,
    *,
    bundle: SessionBundle,
    note: str,
    query: str,
    current_user: User | None,
    event: Event | None = None,
) -> ChatbotResponse:
    actor = _actor_label(current_user)
    session = bundle.session
    timestamp = datetime.utcnow().strftime("%b %d, %Y %I:%M %p UTC").replace(" 0", " ")
    note_entry = f"[{timestamp} | {actor}] {note}"
    existing_notes = (session.notes or "").strip()

    try:
        session.notes = f"{existing_notes}\n{note_entry}" if existing_notes else note_entry
        _write_chatbot_audit_log(
            db,
            action="chatbot.session.note",
            session_id=session.id_seance,
            message=query,
            payload={"session_id": session.id_seance, "note": note, "actor": actor},
            actor=actor,
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Chatbot note log failed for session=%s", session.id_seance)
        return _error_response(
            "Note Logging Failed",
            f"I could not log the note: {_text(exc)}",
            intent="log_session_note",
        )

    pressure = db.scalar(select(Pressure).where(Pressure.id_seance == session.id_seance))
    sections = [
        _session_metadata_section(bundle, pressure, event=event),
        _section(
            "Logged note",
            subtitle="Chat-entered session note appended to the session record.",
            variant="fields",
            icon_key="default",
            fields=[
                _field("Session", _session_heading(session)),
                _field("Note", note),
                _field("Logged by", actor),
                _field("Logged at", timestamp),
            ],
        ),
    ]
    records_used = [
        _record_reference("session", session.id_seance, _session_heading(session), details=session.track),
        _record_reference("driver", bundle.driver.driver_id if bundle.driver else session.driver_id, _driver_name(bundle.driver, session.driver_id)),
        _record_reference("vehicle", bundle.vehicle.vehicle_id if bundle.vehicle else session.vehicle_id, _vehicle_name(bundle.vehicle, session.vehicle_id)),
    ]
    if event is not None:
        records_used.append(_record_reference("event", event.id, event.name, details=event.track))

    summary = f"Logged a note on {_session_heading(session)}: {note}"
    return ChatbotResponse(
        kind="setup",
        title="Session Note Logged",
        summary=summary,
        answer=summary,
        source_label=SOURCE_LABEL,
        data_found=True,
        records_used=records_used,
        intent="log_session_note",
        data=_response_data(sections=sections, records_used=records_used, session_id=session.id_seance, note=note),
        sections=sections,
        follow_up=["Show setup for latest session", "Show latest sessions", "Compare sessions"],
        generated_at=datetime.utcnow(),
    )


def _session_rollup_section(rows: list[tuple[Seance, Driver | None, Vehicle | None]]) -> ChatbotSection:
    drivers = {_driver_name(driver, session.driver_id) for session, driver, _ in rows}
    vehicles = {_vehicle_name(vehicle, session.vehicle_id) for session, _, vehicle in rows}
    tracks = {session.track for session, _, _ in rows if session.track}
    dates = sorted({session.session_date for session, _, _ in rows})
    durations = [session.duration_min for session, _, _ in rows if session.duration_min is not None]
    total_duration = sum(durations) if durations else None
    date_range = "Not available"
    if dates:
        date_range = _date_text(dates[0]) if len(dates) == 1 else f"{_date_text(dates[0])} - {_date_text(dates[-1])}"

    return _section(
        "Session summary",
        subtitle="Quick rollup of the matched race-weekend records.",
        variant="fields",
        icon_key="session",
        fields=[
            _field("Sessions found", len(rows)),
            _field("Drivers", _joined_text(sorted(drivers))),
            _field("Vehicles", _joined_text(sorted(vehicles))),
            _field("Tracks", _joined_text(sorted(tracks))),
            _field("Date range", date_range),
            _field("Total duration", _duration_text(total_duration)),
        ],
    )


def _sessions_response(
    rows: list[tuple[Seance, Driver | None, Vehicle | None]],
    *,
    scope_note: str | None = None,
    title: str = "Latest Sessions",
    intent: str = "latest_sessions",
    event_rows: list[tuple[Event, RunGroup | None]] | None = None,
    follow_up: list[str] | None = None,
) -> ChatbotResponse:
    summary_lines = [
        f"I found {len(rows)} recent session{'s' if len(rows) != 1 else ''} in the SM2 Racing database.",
        "The newest records are listed first.",
    ]
    if scope_note:
        summary_lines.append(scope_note)

    records_used: list[ChatbotRecordReference] = []
    for session, driver, vehicle in rows:
        event, run_group = _session_event_match(session, event_rows or [])
        details_parts = [
            _driver_name(driver, session.driver_id),
            _vehicle_name(vehicle, session.vehicle_id),
        ]
        if event is not None:
            details_parts.insert(0, event.name)
        if run_group is not None:
            details_parts.append(_enum_text(run_group.normalized))
        records_used.append(
            _record_reference(
                "session",
                session.id_seance,
                _session_heading(session),
                details=" | ".join(details_parts),
            )
        )

    sections = [
        _session_rollup_section(rows),
        _section(
            "Latest sessions",
            subtitle="Compact session cards with event, driver, vehicle, run group, and status details.",
            variant="cards",
            icon_key="session",
            cards=_session_cards(
                rows,
                event_rows=event_rows,
                include_event=event_rows is not None,
                include_run_group=event_rows is not None,
                include_created=True,
            ),
        )
    ]

    return ChatbotResponse(
        kind="sessions",
        title=title,
        summary="\n\n".join(summary_lines),
        answer="\n\n".join(summary_lines),
        source_label=SOURCE_LABEL,
        data_found=bool(rows),
        records_used=records_used,
        intent=intent,
        data=_response_data(sections=sections, records_used=records_used),
        sections=sections,
        follow_up=follow_up
        or ["Show setup for latest session", "Show tire pressures", "Compare sessions", "Show driver and vehicle data"],
        generated_at=datetime.utcnow(),
    )


def _events_response(rows: list[tuple[Event, RunGroup | None]]) -> ChatbotResponse:
    records_used = [
        _record_reference(
            "event",
            event.id,
            event.name,
            details=f"{event.track} | {_date_text(event.start_date)} - {_date_text(event.end_date)}",
        )
        for event, _ in rows
    ]

    sections = [
        _section(
            "Events",
            subtitle="Compact event cards with dates, tracks, and run group data.",
            variant="cards",
            icon_key="event",
            cards=_event_cards(rows),
        )
    ]

    return ChatbotResponse(
        kind="events",
        title="Events",
        summary=f"I found {len(rows)} event{'s' if len(rows) != 1 else ''} in the SM2 Racing database.",
        answer=f"I found {len(rows)} event{'s' if len(rows) != 1 else ''} in the SM2 Racing database.",
        source_label=SOURCE_LABEL,
        data_found=bool(rows),
        records_used=records_used,
        intent="list_events",
        data=_response_data(sections=sections, records_used=records_used),
        sections=sections,
        follow_up=["Show latest sessions", "Show sessions for this event", "Show driver and vehicle data"],
        generated_at=datetime.utcnow(),
    )


def _fleet_response(
    db: Session,
    *,
    session_bundle: SessionBundle | None,
    driver_id: str | None = None,
    vehicle_id: str | None = None,
    user_rows: list[User] | None = None,
) -> ChatbotResponse:
    driver_rows = _load_driver_rows(db, limit=8, driver_id=driver_id)
    vehicle_rows = _load_vehicle_rows(db, limit=8, vehicle_id=vehicle_id)
    user_rows = user_rows if user_rows is not None else _load_user_rows(db, limit=8)

    if not driver_rows and not vehicle_rows and not user_rows and session_bundle is None:
        return _not_found_response("Driver, User, and Vehicle Data", NO_DATA_MESSAGE, intent="driver_vehicle_data")

    driver_map = {driver.driver_id: driver for driver in driver_rows}
    if session_bundle is not None and session_bundle.driver is not None:
        driver_map[session_bundle.driver.driver_id] = session_bundle.driver

    sections: list[ChatbotSection] = []
    if session_bundle is not None:
        sections.append(
            _section(
                "Session pairing",
                subtitle="The selected session driver and vehicle pairing.",
                variant="fields",
                icon_key="session",
                fields=[
                    _field("Session", _session_heading(session_bundle.session)),
                    _field("Track", session_bundle.session.track),
                    _field("Date", _date_text(session_bundle.session.session_date)),
                    _field("Time", _time_text(session_bundle.session.session_time)),
                    _field("Driver", _driver_name(session_bundle.driver, session_bundle.session.driver_id)),
                    _field("Vehicle", _vehicle_name(session_bundle.vehicle, session_bundle.session.vehicle_id)),
                    _field("Status", _humanize_enum(_session_status_value(session_bundle.session))),
                ],
            )
        )

    sections.append(
        _section(
            "Drivers",
            subtitle="Driver directory cards with status and vehicle links.",
            variant="cards",
            icon_key="driver",
            cards=[
                _card(
                    _driver_name(driver),
                    subtitle=_text(driver.driver_id),
                    badge="Active" if driver.is_active else "Inactive",
                    badge_tone=_tone_for_active(driver.is_active),
                    icon_key="driver",
                    fields=[
                        _field("Team", driver.team_name or "Not available"),
                        _field("Aliases", _joined_text(driver.aliases)),
                        _field("License", driver.license_number or "Not available"),
                        _field(
                            "Vehicles",
                            _joined_text(
                                [
                                    _vehicle_name(vehicle, vehicle.vehicle_id)
                                    for vehicle in getattr(driver, "vehicles", [])
                                ]
                            ),
                        ),
                        _field("Created", _datetime_text(driver.created_at)),
                    ],
                )
                for driver in driver_rows
            ],
        )
    )

    sections.append(
        _section(
            "Users",
            subtitle="System user accounts with role and approval status.",
            variant="cards",
            icon_key="default",
            cards=[
                _card(
                    _user_name(user),
                    subtitle=user.email,
                    badge="Active" if user.is_active else "Inactive",
                    badge_tone=_tone_for_active(user.is_active),
                    icon_key="default",
                    fields=[
                        _field("Role", _humanize_enum(user.role)),
                        _field("Approval", _humanize_enum(user.approval_status)),
                        _field("Last login", _datetime_text(user.last_login_at)),
                        _field("Created", _datetime_text(user.created_at)),
                    ],
                )
                for user in user_rows
            ],
        )
    )

    sections.append(
        _section(
            "Vehicles",
            subtitle="Vehicle directory cards with status and driver links.",
            variant="cards",
            icon_key="vehicle",
            cards=[
                _card(
                    _vehicle_name(vehicle),
                    subtitle=_text(vehicle.vehicle_id),
                    badge="Active" if vehicle.is_active else "Inactive",
                    badge_tone=_tone_for_active(vehicle.is_active),
                    icon_key="vehicle",
                    fields=[
                        _field("Driver", _driver_name(driver_map.get(vehicle.driver_id), vehicle.driver_id)),
                        _field("Class", vehicle.vehicle_class or "Not available"),
                        _field("Year", _decimal_text(vehicle.year, 0) if vehicle.year else "Not available"),
                        _field("Registration", vehicle.registration_number or "Not available"),
                        _field("VIN", vehicle.vin or "Not available"),
                    ],
                )
                for vehicle in vehicle_rows
            ],
        )
    )

    records_used = [
        _record_reference(
            "driver",
            driver.driver_id,
            _driver_name(driver),
            details=driver.team_name or driver.license_number,
        )
        for driver in driver_rows
    ]
    records_used.extend(
        _record_reference(
            "user",
            str(user.id),
            _user_name(user),
            details=f"{_humanize_enum(user.role)} | {user.email}",
        )
        for user in user_rows
    )
    records_used.extend(
        _record_reference(
            "vehicle",
            vehicle.vehicle_id,
            _vehicle_name(vehicle),
            details=vehicle.vehicle_class or vehicle.driver_id,
        )
        for vehicle in vehicle_rows
    )
    if session_bundle is not None:
        records_used.append(
            _record_reference(
                "session",
                session_bundle.session.id_seance,
                _session_heading(session_bundle.session),
                details=f"{_driver_name(session_bundle.driver, session_bundle.session.driver_id)} | {_vehicle_name(session_bundle.vehicle, session_bundle.session.vehicle_id)}",
            )
        )

    summary_parts = [
        f"Loaded {len(driver_rows)} driver(s), {len(user_rows)} user account(s), and {len(vehicle_rows)} vehicle(s).",
        "Showing the current roster data from the SM Racing database below.",
    ]
    if session_bundle is not None:
        summary_parts.append(f"Session pairing anchored to {_session_heading(session_bundle.session)}.")

    logger.info(
        "Admin chatbot fleet response built: drivers=%s users=%s vehicles=%s session=%s",
        len(driver_rows),
        len(user_rows),
        len(vehicle_rows),
        session_bundle is not None,
    )

    return ChatbotResponse(
        kind="fleet",
        title="Driver, User, and Vehicle Data",
        summary="\n\n".join(summary_parts),
        answer="\n\n".join(summary_parts),
        source_label=SOURCE_LABEL,
        data_found=bool(driver_rows or user_rows or vehicle_rows or session_bundle is not None),
        records_used=records_used,
        intent="driver_vehicle_data",
        data=_response_data(sections=sections, records_used=records_used),
        sections=sections,
        follow_up=["Show latest sessions", "Show latest submissions", "Show setup for latest session"],
        generated_at=datetime.utcnow(),
    )


def _submission_type_text(submission: Submission) -> str:
    payload = submission.payload if isinstance(submission.payload, dict) else {}
    analysis = submission.analysis_result if isinstance(submission.analysis_result, dict) else {}
    for source in (analysis, payload):
        for key in ("submission_type", "type", "category", "kind"):
            value = source.get(key)
            if value:
                return _text(value)
    return _text(submission.structured_ingest_status)


def _submission_session_data(submission: Submission) -> dict[str, Any]:
    payload = submission.payload if isinstance(submission.payload, dict) else {}
    return get_session_payload(payload)


def _submission_session_label(submission: Submission) -> str:
    session_data = _submission_session_data(submission)
    session_number = session_data.get("session_number")
    if session_number not in (None, ""):
        return f"Session {session_number}"

    session_type = _text(session_data.get("session_type"), "")
    if session_type and session_type != "Not available":
        return session_type

    return "Not available"


def _submission_session_window(submission: Submission) -> str:
    session_data = _submission_session_data(submission)
    parts = [
        _clean_blank(session_data.get("date")),
        _clean_blank(session_data.get("time")),
    ]
    joined = " ".join(part for part in parts if part)
    return joined or "Not available"


def _submission_track_text(submission: Submission) -> str:
    session_data = _submission_session_data(submission)
    return _text(session_data.get("track"))


def _submission_note_text(submission: Submission) -> str:
    analysis = submission.analysis_result if isinstance(submission.analysis_result, dict) else {}
    payload = submission.payload if isinstance(submission.payload, dict) else {}

    for source in (analysis, payload):
        for key in ("summary", "note", "notes", "message", "detail", "details", "description"):
            value = source.get(key)
            if value:
                text = _text(value)
                return text if len(text) <= 240 else f"{text[:237].rstrip()}..."

    if submission.raw_text:
        text = _text(submission.raw_text)
        return text if len(text) <= 240 else f"{text[:237].rstrip()}..."

    return "Not available"


def _submission_image_review_text(submission: Submission) -> str:
    analysis = submission.analysis_result if isinstance(submission.analysis_result, dict) else {}
    image_analysis = analysis.get("image_analysis") if isinstance(analysis.get("image_analysis"), dict) else {}
    if image_analysis.get("recommended_review_status"):
        return _text(image_analysis.get("recommended_review_status"))
    if analysis.get("image_analysis_review_status"):
        return _text(analysis.get("image_analysis_review_status"))
    return "PENDING" if submission.image_url else "Not available"


def _submissions_response(
    db: Session,
    *,
    event: Event | None,
    driver_id: str | None,
    vehicle_id: str | None,
    limit: int,
) -> ChatbotResponse:
    stmt = (
        select(Submission, Event, RunGroup, Driver, Vehicle)
        .join(Event, Event.id == Submission.event_id)
        .join(RunGroup, RunGroup.id == Submission.run_group_id)
        .join(Driver, Driver.id == Submission.driver_id, isouter=True)
        .join(Vehicle, Vehicle.id == Submission.vehicle_id, isouter=True)
    )

    if event is not None:
        stmt = stmt.where(Submission.event_id == event.id)

    if driver_id:
        stmt = stmt.where(Driver.driver_id == driver_id)

    if vehicle_id:
        stmt = stmt.where(Vehicle.vehicle_id == vehicle_id)

    rows = list(
        db.execute(
            stmt.order_by(Submission.created_at.desc(), Submission.submission_ref.desc()).limit(limit)
        ).all()
    )

    if not rows:
        logger.info(
            "Admin chatbot submissions lookup returned no rows (event_id=%s driver_id=%s vehicle_id=%s)",
            event.id if event else None,
            driver_id,
            vehicle_id,
        )
        return _not_found_response(
            "Submissions",
            NO_DATA_MESSAGE,
            intent="latest_submissions",
        )

    cards: list[ChatbotCard] = []
    records_used: list[ChatbotRecordReference] = []
    for submission, submission_event, run_group, driver, vehicle in rows:
        submission_status = _text(submission.status.value if hasattr(submission.status, "value") else submission.status)
        driver_label = _driver_name(driver, _text(submission.driver_id))
        vehicle_label = _vehicle_name(vehicle, _text(submission.vehicle_id))
        cards.append(
            _card(
                submission.submission_ref,
                subtitle=f"{submission_event.name} | {submission_status}",
                badge=submission_status,
                badge_tone=_tone_for_status(submission.status),
                icon_key="default",
                fields=[
                    _field("Submission ref", submission.submission_ref),
                    _field("Submission type", _submission_type_text(submission)),
                    _field("Session", _submission_session_label(submission)),
                    _field("Session window", _submission_session_window(submission)),
                    _field("Track", _submission_track_text(submission)),
                    _field("Event", submission_event.name),
                    _field("Run group", _enum_text(run_group.normalized)),
                    _field("Driver", driver_label),
                    _field("Vehicle", vehicle_label),
                    _field("Structured ingest", submission.structured_ingest_status),
                    _field("Image", "Attached" if submission.image_url else "Not available"),
                    _field("Image review", _submission_image_review_text(submission)),
                    _field("Note", _submission_note_text(submission)),
                    _field("Created", _datetime_text(submission.created_at)),
                    _field("Error", submission.error_message or "Not available"),
                ],
            )
        )
        records_used.append(
            _record_reference(
                "submission",
                submission.submission_ref,
                submission.submission_ref,
                details=f"{submission_event.name} | {driver_label} | {vehicle_label}",
            )
        )

    summary = [
        f"I found {len(rows)} recent submission{'s' if len(rows) != 1 else ''} in the SM2 Racing database.",
        "The newest records are listed first.",
    ]

    if event is not None:
        summary.append(f"Scoped to event: {event.name}.")

    logger.info(
        "Admin chatbot submissions response built: count=%s event_id=%s driver_id=%s vehicle_id=%s",
        len(rows),
        event.id if event is not None else None,
        driver_id,
        vehicle_id,
    )

    return ChatbotResponse(
        kind="submissions",
        title="Submissions",
        summary="\n\n".join(summary),
        answer="\n\n".join(summary),
        source_label=SOURCE_LABEL,
        data_found=True,
        records_used=records_used,
        intent="latest_submissions",
        data=_response_data(sections=[
            _section(
                "Submissions",
                subtitle="Submission records with event, run group, driver, and vehicle context.",
                variant="cards",
                icon_key="default",
                cards=cards,
            )
        ], records_used=records_used),
        sections=[
            _section(
                "Submissions",
                subtitle="Submission records with event, run group, driver, and vehicle context.",
                variant="cards",
                icon_key="default",
                cards=cards,
            )
        ],
        follow_up=["Show latest sessions", "Show setup for latest session", "Show all events"],
        generated_at=datetime.utcnow(),
    )


def _numeric_values(values: Iterable[object | None]) -> list[float]:
    numeric_values: list[float] = []
    for value in values:
        if value is None:
            continue
        try:
            numeric_values.append(float(value))
        except (TypeError, ValueError):
            continue
    return numeric_values


def _value_spread(values: Iterable[object | None]) -> float | None:
    numeric_values = _numeric_values(values)
    if not numeric_values:
        return None
    return round(max(numeric_values) - min(numeric_values), 2)


def _session_temp_spread(temperature: TireTemperature | None) -> float | None:
    if temperature is None:
        return None
    values = [
        temperature.fl_in,
        temperature.fl_mid,
        temperature.fl_out,
        temperature.fr_in,
        temperature.fr_mid,
        temperature.fr_out,
        temperature.rl_in,
        temperature.rl_mid,
        temperature.rl_out,
        temperature.rr_in,
        temperature.rr_mid,
        temperature.rr_out,
    ]
    return _value_spread(values)


def _session_alignment_gap(alignment: Alignment | None) -> float | None:
    if alignment is None:
        return None
    values = [
        alignment.camber_fl,
        alignment.camber_fr,
        alignment.camber_rl,
        alignment.camber_rr,
        alignment.toe_fl,
        alignment.toe_fr,
        alignment.toe_rl,
        alignment.toe_rr,
    ]
    return _value_spread(values)


def _session_note_flags(notes: str | None) -> list[str]:
    if not notes:
        return []
    text = notes.lower()
    flags: list[str] = []
    for keyword, label in (
        ("loose", "loose"),
        ("tight", "tight"),
        ("understeer", "understeer"),
        ("oversteer", "oversteer"),
        ("push", "push"),
        ("grip", "grip"),
        ("vibration", "vibration"),
        ("noise", "noise"),
    ):
        if keyword in text:
            flags.append(label)
    return _unique_limited(flags, limit=4)


def _session_snapshot(bundle: SessionBundle) -> dict[str, str]:
    session = bundle.session
    return {
        "session_id": session.id_seance,
        "session_label": _session_heading(session),
        "session_number": str(session.session_number),
        "date": _date_text(session.session_date),
        "time": _time_text(session.session_time),
        "track": session.track,
        "driver": _driver_name(bundle.driver, session.driver_id),
        "vehicle": _vehicle_name(bundle.vehicle, session.vehicle_id),
        "duration": _duration_text(session.duration_min),
        "status": _humanize_enum(_session_status_value(session)),
    }


def _session_quality_snapshot(db: Session, bundle: SessionBundle) -> dict[str, Any]:
    session = bundle.session
    pressure = db.scalar(select(Pressure).where(Pressure.id_seance == session.id_seance))
    suspension = db.scalar(select(Suspension).where(Suspension.id_seance == session.id_seance))
    alignment = db.scalar(select(Alignment).where(Alignment.id_seance == session.id_seance))
    temperature = db.scalar(select(TireTemperature).where(TireTemperature.id_seance == session.id_seance))
    history_count, tire_ids, compounds, heat_cycles, tire_status = _tire_history_summary(db, session.id_seance)

    cold_values = [pressure.cold_fl, pressure.cold_fr, pressure.cold_rl, pressure.cold_rr] if pressure is not None else []
    hot_values = [pressure.hot_fl, pressure.hot_fr, pressure.hot_rl, pressure.hot_rr] if pressure is not None else []

    section_presence = {
        "pressures": pressure is not None,
        "suspension": suspension is not None,
        "alignment": alignment is not None,
        "temperatures": temperature is not None,
        "history": history_count > 0,
    }
    missing_sections = [label for label, present in section_presence.items() if not present]

    pressure_cold_spread = _value_spread(cold_values)
    pressure_hot_spread = _value_spread(hot_values)
    temperature_spread = _session_temp_spread(temperature)
    alignment_gap = _session_alignment_gap(alignment)

    score = 0.0
    strengths: list[str] = []
    weak_points: list[str] = []

    if pressure is not None:
        score += 2.0
        strengths.append("pressure data is captured")
    if suspension is not None:
        score += 1.0
        strengths.append("suspension data is captured")
    if alignment is not None:
        score += 2.0
        strengths.append("alignment data is captured")
    if temperature is not None:
        score += 2.0
        strengths.append("tire temperatures are captured")
    if history_count > 0:
        score += 0.5
        strengths.append("tire history is captured")

    score += len(section_presence) * 0.25

    if pressure_cold_spread is not None:
        score -= pressure_cold_spread * 0.35
        if pressure_cold_spread > 1.0:
            weak_points.append("cold pressure balance is uneven")
        else:
            strengths.append("cold pressure balance is consistent")
    if pressure_hot_spread is not None:
        score -= pressure_hot_spread * 0.2
        if pressure_hot_spread > 1.0:
            weak_points.append("hot pressure balance is uneven")
    if temperature_spread is not None:
        score -= temperature_spread * 0.12
        if temperature_spread > 10.0:
            weak_points.append("tire temperature balance is uneven")
        else:
            strengths.append("tire temperature balance is reasonable")
    if alignment_gap is not None:
        score -= alignment_gap * 0.2
        if alignment_gap > 1.0:
            weak_points.append("alignment balance is uneven")
        else:
            strengths.append("alignment balance is stable")

    if missing_sections:
        score -= len(missing_sections) * 0.75
        weak_points.append(f"missing sections: {', '.join(missing_sections)}")

    note_flags = _session_note_flags(session.notes)
    if note_flags:
        score -= 0.5
        weak_points.append(f"note flags: {', '.join(dict.fromkeys(note_flags))}")

    strengths = _unique_limited(strengths, limit=4)
    weak_points = _unique_limited(weak_points, limit=4)

    score = round(max(score, 0.0), 2)

    return {
        "session": _session_snapshot(bundle),
        "score": score,
        "strengths": strengths,
        "weak_points": weak_points,
        "metrics": {
            "pressure_cold_spread": round(pressure_cold_spread, 2) if pressure_cold_spread is not None else None,
            "pressure_hot_spread": round(pressure_hot_spread, 2) if pressure_hot_spread is not None else None,
            "temperature_spread": round(temperature_spread, 2) if temperature_spread is not None else None,
            "alignment_gap": round(alignment_gap, 2) if alignment_gap is not None else None,
            "history_count": history_count,
            "missing_sections": missing_sections,
            "note_flags": note_flags,
            "tire_ids": tire_ids,
            "compounds": compounds,
            "heat_cycles": heat_cycles,
            "tire_status": tire_status,
        },
    }


def _candidate_session_rows_from_memory(
    db: Session,
    *,
    memory: dict[str, Any],
    session_bundle: SessionBundle | None,
    event: Event | None,
    driver_id: str | None,
    vehicle_id: str | None,
    session_date: date | None,
    time_window: str | None,
    limit: int,
) -> list[tuple[Seance, Driver | None, Vehicle | None]]:
    candidate_ids: list[str] = []
    selected_scope = memory.get("selected_scope") if isinstance(memory.get("selected_scope"), dict) else {}
    comparison = memory.get("last_comparison") if isinstance(memory.get("last_comparison"), dict) else {}
    recommendation = memory.get("last_recommendation") if isinstance(memory.get("last_recommendation"), dict) else {}
    coaching = memory.get("last_coaching") if isinstance(memory.get("last_coaching"), dict) else {}

    for source in (
        selected_scope.get("session_id"),
        *(comparison.get("session_ids") or []),
        *(recommendation.get("session_ids") or []),
        *(coaching.get("session_ids") or []),
        *(memory.get("recent_session_ids") or []),
    ):
        if isinstance(source, str) and source.strip():
            candidate_ids.append(source.strip())

    rows: list[tuple[Seance, Driver | None, Vehicle | None]] = []
    seen: set[str] = set()
    for session_id in candidate_ids:
        if session_id in seen:
            continue
        seen.add(session_id)
        bundle = _load_session_bundle(db, session_id)
        if bundle is None:
            continue
        if event is not None and not _session_in_event_window(bundle.session, event):
            continue
        if driver_id and bundle.session.driver_id != driver_id:
            continue
        if vehicle_id and bundle.session.vehicle_id != vehicle_id:
            continue
        if session_date is not None and bundle.session.session_date != session_date:
            continue
        if time_window is not None and not _session_matches_time_window(bundle.session, time_window):
            continue
        rows.append((bundle.session, bundle.driver, bundle.vehicle))

    effective_driver_id = driver_id or (session_bundle.session.driver_id if session_bundle is not None else None)
    effective_vehicle_id = vehicle_id or (session_bundle.session.vehicle_id if session_bundle is not None else None)
    has_fallback_scope = bool(
        event is not None
        or effective_driver_id is not None
        or effective_vehicle_id is not None
        or session_date is not None
        or time_window is not None
        or session_bundle is not None
    )

    if has_fallback_scope and len(rows) < limit:
        fallback_rows = _load_session_rows(
            db,
            event=event,
            driver_id=effective_driver_id,
            vehicle_id=effective_vehicle_id,
            session_date=session_date,
            time_window=time_window,
            limit=limit,
        )
        for session, driver, vehicle in fallback_rows:
            if session.id_seance in seen:
                continue
            rows.append((session, driver, vehicle))
            seen.add(session.id_seance)
            if len(rows) >= limit:
                break

    if rows:
        return rows[:limit]

    return []


def _recommendation_focus_from_query(query: str, memory: dict[str, Any] | None = None) -> str:
    text = query.lower()
    if any(term in text for term in ["lap time", "fastest", "time attack", "pace"]):
        return "lap_time"
    if any(term in text for term in ["pressure", "pressures", "psi"]):
        return "pressures"
    if any(term in text for term in ["alignment", "camber", "toe", "caster", "rake", "wheelbase"]):
        return "alignment"
    if any(term in text for term in ["suspension", "rebound", "bump", "wing", "sway", "damper"]):
        return "suspension"
    if any(term in text for term in ["consistency", "stable", "stability"]):
        return "consistency"
    if memory:
        recommendation = memory.get("last_recommendation") if isinstance(memory.get("last_recommendation"), dict) else {}
        focus = recommendation.get("focus")
        if isinstance(focus, str) and focus.strip():
            return focus.strip()
    return "setup_balance"


def _recommendation_follow_up_prompts(focus: str | None = None) -> list[str]:
    prompts = [
        "Explain why",
        "Compare with previous session",
        "Show weak points only",
        "Suggest priority changes",
    ]
    if focus and focus != "setup_balance":
        prompts.insert(2, "Show setup differences")
    return prompts[:4]


def _priority_actions_from_snapshot(
    snapshot: dict[str, Any],
    *,
    baseline: dict[str, Any] | None = None,
) -> list[str]:
    metrics = snapshot.get("metrics") if isinstance(snapshot.get("metrics"), dict) else {}
    actions: list[str] = []

    pressure_cold_spread = metrics.get("pressure_cold_spread")
    pressure_hot_spread = metrics.get("pressure_hot_spread")
    temperature_spread = metrics.get("temperature_spread")
    alignment_gap = metrics.get("alignment_gap")
    missing_sections = metrics.get("missing_sections") if isinstance(metrics.get("missing_sections"), list) else []
    note_flags = metrics.get("note_flags") if isinstance(metrics.get("note_flags"), list) else []

    if pressure_cold_spread is not None and float(pressure_cold_spread) > 1.0:
        actions.append("Recheck cold pressure balance before the next run.")
    elif pressure_hot_spread is not None and float(pressure_hot_spread) > 1.0:
        actions.append("Review hot pressure balance after the next run.")

    if temperature_spread is not None and float(temperature_spread) > 10.0:
        actions.append("Review tire temperature balance after the next session.")

    if alignment_gap is not None and float(alignment_gap) > 1.0:
        actions.append("Inspect alignment balance before changing other setup areas.")

    if missing_sections:
        actions.append("Capture the missing setup sections so the next comparison is complete.")

    if note_flags:
        actions.append("Address the handling note before stacking on more setup changes.")

    if baseline is not None and not actions:
        baseline_metrics = baseline.get("metrics") if isinstance(baseline.get("metrics"), dict) else {}
        if baseline_metrics.get("pressure_cold_spread") is not None:
            actions.append("Use the better session as the baseline and validate the pressure balance again.")

    if not actions:
        actions.append("Keep the current strengths and validate them again on the next run.")

    return _unique_limited(actions, limit=3)


def _build_candidate_comparison_rows(snapshots: list[dict[str, Any]]) -> list[list[str]]:
    rows: list[list[str]] = []
    for snapshot in snapshots:
        session = snapshot.get("session") if isinstance(snapshot.get("session"), dict) else {}
        strengths = snapshot.get("strengths") if isinstance(snapshot.get("strengths"), list) else []
        weak_points = snapshot.get("weak_points") if isinstance(snapshot.get("weak_points"), list) else []
        rows.append(
            [
                _text(session.get("session_label")),
                f"{snapshot.get('score', 0):.2f}" if isinstance(snapshot.get("score"), (int, float)) else _text(snapshot.get("score")),
                _joined_text(strengths[:2]) if strengths else "Not available",
                _joined_text(weak_points[:2]) if weak_points else "Not available",
            ]
        )
    return rows


def _build_recommendation_response(
    db: Session,
    *,
    query: str,
    query_in: ChatbotQuery,
    memory: dict[str, Any],
    event: Event | None,
    session_bundle: SessionBundle | None,
    driver_id: str | None,
    vehicle_id: str | None,
    session_date: date | None,
    time_window: str | None,
    intent: str = "recommendation",
) -> ChatbotResponse:
    candidate_rows = _candidate_session_rows_from_memory(
        db,
        memory=memory,
        session_bundle=session_bundle,
        event=event,
        driver_id=driver_id,
        vehicle_id=vehicle_id,
        session_date=session_date,
        time_window=time_window,
        limit=max(query_in.limit, 3),
    )
    if len(candidate_rows) < 2:
        return _needs_context_response(
            "Recommendation",
            "I can help with that, but I need at least two sessions or a recent comparison context before I can choose the stronger option.",
            intent=intent,
            follow_up=[
                "Compare Session 1 vs Session 2",
                "Show latest sessions",
                "Show setup for the latest session",
            ],
        )

    bundles = [_bundle_from_row(row) for row in candidate_rows]
    snapshots = [_session_quality_snapshot(db, bundle) for bundle in bundles]
    snapshots.sort(key=lambda item: (float(item.get("score", 0.0)), item["session"].get("session_number", 0)), reverse=True)

    best_snapshot = snapshots[0]
    runner_up = snapshots[1] if len(snapshots) > 1 else None
    score_gap = (
        round(float(best_snapshot.get("score", 0.0)) - float(runner_up.get("score", 0.0)), 2)
        if runner_up is not None
        else None
    )

    focus = _recommendation_focus_from_query(query, memory)
    comparison_context = memory.get("last_comparison") if isinstance(memory.get("last_comparison"), dict) else {}
    context_source = "previous comparison" if comparison_context.get("session_ids") else "recent session history"

    if score_gap is not None and score_gap < 0.5 and focus == "setup_balance":
        return _needs_context_response(
            "Recommendation",
            "I can compare these sessions, but the setup evidence is too close to call a clear winner. Tell me what you want to optimize for: lap time, setup balance, tire pressures, overall data quality, or consistency.",
            intent=intent,
            follow_up=[
                "Optimize lap time",
                "Optimize setup balance",
                "Optimize tire pressures",
                "Optimize consistency",
            ],
        )

    records_used = [
        _record_reference(
            "session",
            snapshot["session"]["session_id"],
            snapshot["session"]["session_label"],
            details=f"{snapshot['session']['driver']} | {snapshot['session']['vehicle']}",
        )
        for snapshot in snapshots
    ]

    sections = [
        _section(
            "Recommendation",
            subtitle="Best option with the strongest setup evidence currently available.",
            variant="fields",
            icon_key="compare",
            fields=[
                _field("Best option", best_snapshot["session"]["session_label"]),
                _field(
                    "Why",
                    " ".join(
                        part
                        for part in [
                            "It has the highest setup-quality score from the current evidence.",
                            f"Better signals: {_joined_text(best_snapshot.get('strengths', [])[:2])}." if best_snapshot.get("strengths") else None,
                            f"Score gap vs next best: {score_gap:.2f}." if score_gap is not None else None,
                        ]
                        if part
                    ),
                ),
                _field("Evidence source", context_source),
                _field("Focus", _humanize_enum(focus)),
            ],
        ),
        _section(
            "Candidate comparison",
            subtitle="Scored candidates with the strongest and weakest signals called out first.",
            variant="table",
            icon_key="compare",
            table_headers=["Session", "Score", "Strongest signal", "Weakest signal"],
            table_rows=_build_candidate_comparison_rows(snapshots),
        ),
        _section(
            "Suggested focus",
            subtitle="Practical next steps grounded in the current evidence.",
            variant="fields",
            icon_key="default",
            fields=[
                _field("Priority 1", _priority_actions_from_snapshot(best_snapshot)[0]),
                _field(
                    "Priority 2",
                    _priority_actions_from_snapshot(best_snapshot)[1] if len(_priority_actions_from_snapshot(best_snapshot)) > 1 else "Not available",
                ),
                _field(
                    "Priority 3",
                    _priority_actions_from_snapshot(best_snapshot)[2] if len(_priority_actions_from_snapshot(best_snapshot)) > 2 else "Not available",
                ),
            ],
        ),
    ]

    summary = (
        f"{best_snapshot['session']['session_label']} looks like the strongest option from the current evidence."
        if best_snapshot.get("session")
        else "I found the strongest option from the current evidence."
    )
    if focus != "setup_balance":
        summary += f" I used {focus.replace('_', ' ')} as the main check."
    if score_gap is not None:
        summary += f" The setup-quality gap to the next candidate is {score_gap:.2f}."

    response = ChatbotResponse(
        kind="recommendation",
        title="Recommendation",
        summary=summary,
        answer=summary,
        source_label=SOURCE_LABEL,
        data_found=True,
        records_used=records_used,
        intent=intent,
        data={
            "focus": focus,
            "context_source": context_source,
            "best_session_id": best_snapshot["session"]["session_id"],
            "best_session_label": best_snapshot["session"]["session_label"],
            "score_gap": score_gap,
            "candidate_sessions": snapshots,
            "priority_actions": _priority_actions_from_snapshot(best_snapshot),
            "evidence_scope": "setup_only",
        },
        sections=sections,
        follow_up=_recommendation_follow_up_prompts(focus),
        generated_at=datetime.utcnow(),
    )
    return _finalize_recommendation_response(
        query=query,
        backend_response=response,
        request_scope=query_in,
    )


def _build_coaching_response(
    db: Session,
    *,
    query: str,
    query_in: ChatbotQuery,
    memory: dict[str, Any],
    event: Event | None,
    session_bundle: SessionBundle | None,
    driver_id: str | None,
    vehicle_id: str | None,
    session_date: date | None,
    time_window: str | None,
    intent: str = "coaching",
) -> ChatbotResponse:
    candidate_rows = _candidate_session_rows_from_memory(
        db,
        memory=memory,
        session_bundle=session_bundle,
        event=event,
        driver_id=driver_id,
        vehicle_id=vehicle_id,
        session_date=session_date,
        time_window=time_window,
        limit=max(query_in.limit, 3),
    )
    if not candidate_rows:
        return _needs_context_response(
            "Improvement Areas",
            "I need a session or recent history to review before I can coach the next change.",
            intent=intent,
            follow_up=[
                "Show latest sessions",
                "Show setup for the latest session",
                "Compare Session 1 vs Session 2",
            ],
        )

    bundles = [_bundle_from_row(row) for row in candidate_rows]
    snapshots = [_session_quality_snapshot(db, bundle) for bundle in bundles]
    snapshots.sort(key=lambda item: (float(item.get("score", 0.0)), item["session"].get("session_number", 0)), reverse=True)

    focus_snapshot = snapshots[0]
    baseline_snapshot = snapshots[1] if len(snapshots) > 1 else None
    focus = _recommendation_focus_from_query(query, memory)
    priority_actions = _priority_actions_from_snapshot(focus_snapshot, baseline=baseline_snapshot)
    weak_points = focus_snapshot.get("weak_points") if isinstance(focus_snapshot.get("weak_points"), list) else []
    best_strengths = focus_snapshot.get("strengths") if isinstance(focus_snapshot.get("strengths"), list) else []

    records_used = [
        _record_reference(
            "session",
            snapshot["session"]["session_id"],
            snapshot["session"]["session_label"],
            details=f"{snapshot['session']['driver']} | {snapshot['session']['vehicle']}",
        )
        for snapshot in snapshots
    ]

    sections = [
        _section(
            "Improvement areas",
            subtitle="What to improve first based on the current evidence.",
            variant="fields",
            icon_key="default",
            fields=[
                _field("Primary focus", _humanize_enum(focus)),
                _field("Why", _joined_text(best_strengths[:2]) if best_strengths else "The current session has limited balance signals."),
                _field("Weak points", _joined_text(weak_points[:2]) if weak_points else "Not available"),
                _field("Evidence source", "Current session plus recent history"),
            ],
        ),
        _section(
            "Weak points",
            subtitle="The highest-priority gaps surfaced by the backend evidence.",
            variant="table",
            icon_key="compare",
            table_headers=["Area", "Evidence", "Priority"],
            table_rows=[
                [item, item, "High" if index == 0 else "Medium"]
                for index, item in enumerate(weak_points[:3])
            ]
            or [["Setup balance", "No major weak points were detected.", "Low"]],
        ),
        _section(
            "Next actions",
            subtitle="Practical follow-up changes to test next.",
            variant="fields",
            icon_key="default",
            fields=[
                _field("Priority 1", priority_actions[0] if priority_actions else "Not available"),
                _field("Priority 2", priority_actions[1] if len(priority_actions) > 1 else "Not available"),
                _field("Priority 3", priority_actions[2] if len(priority_actions) > 2 else "Not available"),
            ],
        ),
    ]

    summary = (
        f"Based on the available setup evidence, the main improvement areas for {_session_heading(focus_snapshot['session'])} are "
        f"{_joined_text(weak_points[:2]) if weak_points else 'setup balance and consistency'}."
    )

    response = ChatbotResponse(
        kind="coaching",
        title="Improvement Areas",
        summary=summary,
        answer=summary,
        source_label=SOURCE_LABEL,
        data_found=True,
        records_used=records_used,
        intent=intent,
        data={
            "focus": focus,
            "session_id": focus_snapshot["session"]["session_id"],
            "session_label": focus_snapshot["session"]["session_label"],
            "candidate_sessions": snapshots,
            "weak_points": weak_points,
            "priority_actions": priority_actions,
            "evidence_scope": "setup_only",
        },
        sections=sections,
        follow_up=[
            "Show weak points only",
            "Compare with previous session",
            "Show setup differences",
            "Suggest priority changes",
        ],
        generated_at=datetime.utcnow(),
    )
    return _finalize_recommendation_response(
        query=query,
        backend_response=response,
        request_scope=query_in,
    )


def _finalize_recommendation_response(
    *,
    query: str,
    backend_response: ChatbotResponse,
    request_scope: ChatbotQuery | None = None,
) -> ChatbotResponse:
    return backend_response


def _metric_average(values: Iterable[object | None]) -> str:
    numbers = [float(value) for value in values if value is not None]
    if not numbers:
        return "Not available"
    return _decimal_text(sum(numbers) / len(numbers))


def _compare_value(value: object | None, *, digits: int = 2) -> str:
    if value is None:
        return "Not available"
    if isinstance(value, (Decimal, int, float)):
        return _decimal_text(value, digits)
    return _text(value)


def _append_compare_row(
    rows: list[list[str]],
    metric: str,
    left_value: object | None,
    right_value: object | None,
    context: str,
    *,
    digits: int = 2,
) -> None:
    rows.append(
        [
            metric,
            _compare_value(left_value, digits=digits),
            _compare_value(right_value, digits=digits),
            context,
        ]
    )


def _append_compare_fields(
    rows: list[list[str]],
    *,
    left_record: object | None,
    right_record: object | None,
    definitions: Iterable[tuple[str, str, str, int]],
) -> None:
    for metric, attribute, context, digits in definitions:
        _append_compare_row(
            rows,
            metric,
            getattr(left_record, attribute, None) if left_record is not None else None,
            getattr(right_record, attribute, None) if right_record is not None else None,
            context,
            digits=digits,
        )


def _tire_history_summary(db: Session, session_id: str) -> tuple[int, str, str, str, str]:
    rows = list(
        db.execute(
            select(TireHistory, TireInventory)
            .join(TireInventory, TireInventory.tire_id == TireHistory.tire_id, isouter=True)
            .where(TireHistory.id_seance == session_id)
            .order_by(TireHistory.created_at.desc(), TireHistory.tire_id.asc())
            .limit(12)
    ).all()
    )
    if not rows:
        return 0, "Not available", "Not available", "Not available", "Not available"

    tire_ids = [history.tire_id for history, _ in rows]
    compounds = [
        " ".join(part for part in [inventory.manufacturer, inventory.model] if part).strip()
        for _, inventory in rows
        if inventory is not None
    ]
    heat_cycles = [
        str(inventory.heat_cycles)
        for _, inventory in rows
        if inventory is not None and inventory.heat_cycles is not None
    ]
    statuses = [
        _humanize_enum(inventory.status)
        for _, inventory in rows
        if inventory is not None and inventory.status is not None
    ]

    return (
        len(rows),
        _joined_text(tire_ids),
        _joined_text(compounds),
        _joined_text(heat_cycles),
        _joined_text(statuses),
    )


def _compare_rows(
    left: SessionBundle,
    right: SessionBundle,
    *,
    db: Session,
    left_pressure: Pressure | None,
    right_pressure: Pressure | None,
    left_suspension: Suspension | None,
    right_suspension: Suspension | None,
    left_temperature: TireTemperature | None,
    right_temperature: TireTemperature | None,
    left_alignment: Alignment | None,
    right_alignment: Alignment | None,
) -> tuple[list[str], list[list[str]], list[str]]:
    left_cold = (
        [left_pressure.cold_fl, left_pressure.cold_fr, left_pressure.cold_rl, left_pressure.cold_rr]
        if left_pressure
        else []
    )
    right_cold = (
        [right_pressure.cold_fl, right_pressure.cold_fr, right_pressure.cold_rl, right_pressure.cold_rr]
        if right_pressure
        else []
    )
    left_hot = (
        [left_pressure.hot_fl, left_pressure.hot_fr, left_pressure.hot_rl, left_pressure.hot_rr]
        if left_pressure
        else []
    )
    right_hot = (
        [right_pressure.hot_fl, right_pressure.hot_fr, right_pressure.hot_rl, right_pressure.hot_rr]
        if right_pressure
        else []
    )

    def temp_values(temperature: TireTemperature | None) -> list[object | None]:
        if temperature is None:
            return []
        return [
            temperature.fl_in,
            temperature.fl_mid,
            temperature.fl_out,
            temperature.fr_in,
            temperature.fr_mid,
            temperature.fr_out,
            temperature.rl_in,
            temperature.rl_mid,
            temperature.rl_out,
            temperature.rr_in,
            temperature.rr_mid,
            temperature.rr_out,
        ]

    def ride_height_values(alignment: Alignment | None) -> list[object | None]:
        if alignment is None:
            return []
        return [alignment.ride_height_f, alignment.ride_height_r]

    rows: list[list[str]] = []
    _append_compare_row(rows, "Session", _session_heading(left.session), _session_heading(right.session), "Session info")
    _append_compare_row(
        rows,
        "Date",
        f"{_date_text(left.session.session_date)} {_time_text(left.session.session_time)}",
        f"{_date_text(right.session.session_date)} {_time_text(right.session.session_time)}",
        "Session window",
    )
    _append_compare_row(rows, "Track", left.session.track, right.session.track, "Track selection")
    _append_compare_row(rows, "Driver", _driver_name(left.driver, left.session.driver_id), _driver_name(right.driver, right.session.driver_id), "Driver pairing")
    _append_compare_row(rows, "Vehicle", _vehicle_name(left.vehicle, left.session.vehicle_id), _vehicle_name(right.vehicle, right.session.vehicle_id), "Vehicle pairing")
    _append_compare_row(rows, "Session type", left.session.session_type, right.session.session_type, "Session info")
    _append_compare_row(rows, "Duration", _duration_text(left.session.duration_min), _duration_text(right.session.duration_min), "Session length")
    _append_compare_row(rows, "Tire set", left.session.tire_set, right.session.tire_set, "Tire history and session tire set")
    _append_compare_row(rows, "Status", _humanize_enum(_session_status_value(left.session)), _humanize_enum(_session_status_value(right.session)), "Session metadata")

    _append_compare_row(rows, "Cold pressure avg", _metric_average(left_cold), _metric_average(right_cold), "Pressures - average cold pressure")
    _append_compare_row(rows, "Hot pressure avg", _metric_average(left_hot), _metric_average(right_hot), "Pressures - average hot pressure")
    _append_compare_fields(
        rows,
        left_record=left_pressure,
        right_record=right_pressure,
        definitions=[
            ("Cold pressure FL", "cold_fl", "Pressures - front left cold psi", 2),
            ("Cold pressure FR", "cold_fr", "Pressures - front right cold psi", 2),
            ("Cold pressure RL", "cold_rl", "Pressures - rear left cold psi", 2),
            ("Cold pressure RR", "cold_rr", "Pressures - rear right cold psi", 2),
            ("Hot pressure FL", "hot_fl", "Pressures - front left hot psi", 2),
            ("Hot pressure FR", "hot_fr", "Pressures - front right hot psi", 2),
            ("Hot pressure RL", "hot_rl", "Pressures - rear left hot psi", 2),
            ("Hot pressure RR", "hot_rr", "Pressures - rear right hot psi", 2),
        ],
    )

    _append_compare_fields(
        rows,
        left_record=left_suspension,
        right_record=right_suspension,
        definitions=[
            ("Rebound FL", "rebound_fl", "Suspension - front left rebound", 0),
            ("Rebound FR", "rebound_fr", "Suspension - front right rebound", 0),
            ("Rebound RL", "rebound_rl", "Suspension - rear left rebound", 0),
            ("Rebound RR", "rebound_rr", "Suspension - rear right rebound", 0),
            ("Bump FL", "bump_fl", "Suspension - front left bump", 0),
            ("Bump FR", "bump_fr", "Suspension - front right bump", 0),
            ("Bump RL", "bump_rl", "Suspension - rear left bump", 0),
            ("Bump RR", "bump_rr", "Suspension - rear right bump", 0),
            ("Sway bar front", "sway_bar_f", "Suspension - front sway bar", 2),
            ("Sway bar rear", "sway_bar_r", "Suspension - rear sway bar", 2),
            ("Wing angle", "wing_angle_deg", "Suspension - aero wing angle", 2),
        ],
    )

    _append_compare_row(rows, "Ride height avg", _metric_average(ride_height_values(left_alignment)), _metric_average(ride_height_values(right_alignment)), "Alignment - average ride height")
    _append_compare_fields(
        rows,
        left_record=left_alignment,
        right_record=right_alignment,
        definitions=[
            ("Camber FL", "camber_fl", "Alignment - front left camber", 2),
            ("Camber FR", "camber_fr", "Alignment - front right camber", 2),
            ("Camber RL", "camber_rl", "Alignment - rear left camber", 2),
            ("Camber RR", "camber_rr", "Alignment - rear right camber", 2),
            ("Toe front", "toe_front", "Alignment - front toe", 2),
            ("Toe rear", "toe_rear", "Alignment - rear toe", 2),
            ("Caster L", "caster_l", "Alignment - left caster", 2),
            ("Caster R", "caster_r", "Alignment - right caster", 2),
            ("Ride height front", "ride_height_f", "Alignment - front ride height", 2),
            ("Ride height rear", "ride_height_r", "Alignment - rear ride height", 2),
            ("Corner weight FL", "corner_weight_fl", "Alignment - front left corner weight", 2),
            ("Corner weight FR", "corner_weight_fr", "Alignment - front right corner weight", 2),
            ("Corner weight RL", "corner_weight_rl", "Alignment - rear left corner weight", 2),
            ("Corner weight RR", "corner_weight_rr", "Alignment - rear right corner weight", 2),
            ("Cross weight", "cross_weight_pct", "Alignment - cross weight percent", 2),
            ("Rake", "rake_mm", "Alignment - rake", 2),
            ("Wheelbase", "wheelbase_mm", "Alignment - wheelbase", 2),
        ],
    )

    _append_compare_row(rows, "Tire temperature avg", _metric_average(temp_values(left_temperature)), _metric_average(temp_values(right_temperature)), "Tire temperatures - overall average")
    _append_compare_fields(
        rows,
        left_record=left_temperature,
        right_record=right_temperature,
        definitions=[
            ("Temperature FL inner", "fl_in", "Tire temperatures - front left inner", 2),
            ("Temperature FL middle", "fl_mid", "Tire temperatures - front left middle", 2),
            ("Temperature FL outer", "fl_out", "Tire temperatures - front left outer", 2),
            ("Temperature FR inner", "fr_in", "Tire temperatures - front right inner", 2),
            ("Temperature FR middle", "fr_mid", "Tire temperatures - front right middle", 2),
            ("Temperature FR outer", "fr_out", "Tire temperatures - front right outer", 2),
            ("Temperature RL inner", "rl_in", "Tire temperatures - rear left inner", 2),
            ("Temperature RL middle", "rl_mid", "Tire temperatures - rear left middle", 2),
            ("Temperature RL outer", "rl_out", "Tire temperatures - rear left outer", 2),
            ("Temperature RR inner", "rr_in", "Tire temperatures - rear right inner", 2),
            ("Temperature RR middle", "rr_mid", "Tire temperatures - rear right middle", 2),
            ("Temperature RR outer", "rr_out", "Tire temperatures - rear right outer", 2),
        ],
    )

    left_history_count, left_tires, left_compounds, left_heat_cycles, left_tire_status = _tire_history_summary(db, left.session.id_seance)
    right_history_count, right_tires, right_compounds, right_heat_cycles, right_tire_status = _tire_history_summary(db, right.session.id_seance)
    _append_compare_row(rows, "Tire history count", left_history_count, right_history_count, "Tire history - rows attached to session", digits=0)
    _append_compare_row(rows, "Tire IDs", left_tires, right_tires, "Tire history - tire set IDs")
    _append_compare_row(rows, "Tire compounds", left_compounds, right_compounds, "Tire history - manufacturer and model")
    _append_compare_row(rows, "Heat cycles", left_heat_cycles, right_heat_cycles, "Tire history - heat cycles")
    _append_compare_row(rows, "Tire status", left_tire_status, right_tire_status, "Tire history - inventory status")

    highlights = [
        f"Session {right.session.session_number} is being compared against Session {left.session.session_number}.",
    ]

    changed_count = sum(1 for _, left_value, right_value, _ in rows if left_value != right_value)
    unchanged_count = len(rows) - changed_count
    highlights.append(f"{changed_count} field(s) changed and {unchanged_count} stayed the same.")

    if left.session.duration_min is not None and right.session.duration_min is not None:
        diff = right.session.duration_min - left.session.duration_min
        if diff:
            direction = "longer" if diff > 0 else "shorter"
            highlights.append(
                f"Session {right.session.session_number} was {_decimal_text(abs(diff), 0)} minute(s) {direction}."
            )

    return ["Metric", "Session A", "Session B", "Context"], rows, highlights


def _compare_response(
    db: Session,
    *,
    event: Event | None,
    session_id: str | None,
    driver_id: str | None,
    vehicle_id: str | None,
    query: str | None = None,
    session_date: date | None = None,
    time_window: str | None = None,
) -> ChatbotResponse | None:
    rows = _load_session_rows(
        db,
        event=event,
        driver_id=driver_id,
        vehicle_id=vehicle_id,
        session_date=session_date,
        time_window=time_window,
        limit=None,
    )
    if len(rows) < 2:
        return None

    compare_numbers = _extract_compare_session_numbers(query or "")
    if compare_numbers is not None:
        first_number, second_number = compare_numbers
        first_matches = _load_session_rows_by_number(
            db,
            session_number=first_number,
            event=event,
            driver_id=driver_id,
            vehicle_id=vehicle_id,
            session_date=session_date,
            time_window=time_window,
        )
        second_matches = _load_session_rows_by_number(
            db,
            session_number=second_number,
            event=event,
            driver_id=driver_id,
            vehicle_id=vehicle_id,
            session_date=session_date,
            time_window=time_window,
        )
        if not first_matches or not second_matches:
            return None
        left_row = first_matches[0]
        right_row = second_matches[0]
        if left_row[0].id_seance == right_row[0].id_seance:
            return None
    elif session_id:
        anchor_index = next(
            (index for index, (session, _, _) in enumerate(rows) if session.id_seance == session_id),
            None,
        )
        if anchor_index is None:
            bundle = _load_session_bundle(db, session_id)
            if bundle is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
            if event is not None and not _session_in_event_window(bundle.session, event):
                return None
            if driver_id and bundle.session.driver_id != driver_id:
                return None
            if vehicle_id and bundle.session.vehicle_id != vehicle_id:
                return None
            return None
        if anchor_index + 1 >= len(rows):
            return None
        left_row = rows[anchor_index]
        right_row = rows[anchor_index + 1]
    else:
        left_row = rows[1]
        right_row = rows[0]

    left = SessionBundle(*left_row)
    right = SessionBundle(*right_row)

    left_pressure = db.scalar(select(Pressure).where(Pressure.id_seance == left.session.id_seance))
    right_pressure = db.scalar(select(Pressure).where(Pressure.id_seance == right.session.id_seance))
    left_suspension = db.scalar(select(Suspension).where(Suspension.id_seance == left.session.id_seance))
    right_suspension = db.scalar(select(Suspension).where(Suspension.id_seance == right.session.id_seance))
    left_temperature = db.scalar(select(TireTemperature).where(TireTemperature.id_seance == left.session.id_seance))
    right_temperature = db.scalar(select(TireTemperature).where(TireTemperature.id_seance == right.session.id_seance))
    left_alignment = db.scalar(select(Alignment).where(Alignment.id_seance == left.session.id_seance))
    right_alignment = db.scalar(select(Alignment).where(Alignment.id_seance == right.session.id_seance))

    headers, table_rows, highlights = _compare_rows(
        left,
        right,
        db=db,
        left_pressure=left_pressure,
        right_pressure=right_pressure,
        left_suspension=left_suspension,
        right_suspension=right_suspension,
        left_temperature=left_temperature,
        right_temperature=right_temperature,
        left_alignment=left_alignment,
        right_alignment=right_alignment,
    )

    summary_parts = [
        f"Here is a comparison of {_session_heading(left.session)} and {_session_heading(right.session)}.",
        "The most important differences are highlighted first, with the full side-by-side breakdown below.",
        "\n".join(f"- {highlight}" for highlight in highlights),
    ]

    sections = [
        _section(
            "Session A",
            subtitle="The anchor session in the comparison.",
            variant="cards",
            icon_key="session",
            cards=_session_cards([left_row]),
        ),
        _section(
            "Session B",
            subtitle="The comparison session in the comparison.",
            variant="cards",
            icon_key="session",
            cards=_session_cards([right_row]),
        ),
        _section(
            "Comparison",
            subtitle="Metric table with the main setup deltas.",
            variant="table",
            icon_key="compare",
            table_headers=headers,
            table_rows=table_rows,
        ),
    ]
    records_used = [
        _record_reference(
            "session",
            left.session.id_seance,
            _session_heading(left.session),
            details=f"{_driver_name(left.driver, left.session.driver_id)} | {_vehicle_name(left.vehicle, left.session.vehicle_id)}",
        ),
        _record_reference(
            "session",
            right.session.id_seance,
            _session_heading(right.session),
            details=f"{_driver_name(right.driver, right.session.driver_id)} | {_vehicle_name(right.vehicle, right.session.vehicle_id)}",
        ),
    ]

    return ChatbotResponse(
        kind="compare",
        title="Session Comparison",
        summary="\n\n".join(summary_parts),
        answer="\n\n".join(summary_parts),
        source_label=SOURCE_LABEL,
        data_found=True,
        intent="compare",
        records_used=records_used,
        data=_response_data(sections=sections, records_used=records_used),
        sections=sections,
        follow_up=["Show setup for latest session", "Show latest sessions", "Show tire pressures"],
        generated_at=datetime.utcnow(),
    )


def _intent_from_query(query: str, query_in: ChatbotQuery | None = None) -> str:
    text = _normalize_query_text(query)
    has_session_term = _has_session_term(text)

    if _is_thanks_query(text):
        return "thanks"

    if _is_help_services_query(text) or any(
        phrase in text
        for phrase in [
            "show help",
            "need help",
        ]
    ):
        return "help_services"

    if _is_greeting_query(text):
        return "greeting"

    if any(
        keyword in text
        for keyword in [
            "how can i improve",
            "what should i improve",
            "what should i change next",
            "where are the weak points",
            "what are my weak points",
            "focus on next",
            "need improvement",
        ]
    ):
        return "coaching"

    if any(
        keyword in text
        for keyword in [
            "best one",
            "which one is better",
            "which one should i use",
            "strongest option",
            "what is the best session here",
            "which setup looks better",
            "best session",
            "best setup",
            "better option",
        ]
    ):
        return "recommendation"

    if any(keyword in text for keyword in ["compare", "versus", "vs", "difference"]) and has_session_term:
        return "compare"

    if any(
        keyword in text
        for keyword in [
            "baseline",
            "delta",
            "deltas",
            "changes from baseline",
            "what changed",
            "changed from the last session",
            "compare previous session with current",
            "compare previous session",
            "previous session with current",
            "previous session",
        ]
    ):
        return "compare"

    if _looks_like_note_log_query(text):
        return "log_session_note"

    if _looks_like_setup_update_query(text):
        return "update_setup_fields"

    if any(keyword in text for keyword in ["show latest events", "latest events", "show all events", "list events", "show events", "all events"]):
        return "list_events"

    if any(keyword in text for keyword in ["show latest sessions", "latest sessions", "recent sessions", "show recent sessions"]):
        return "latest_sessions"

    if any(
        keyword in text
        for keyword in [
            "today's runs",
            "todays runs",
            "today runs",
            "summarize runs",
            "summarize today's runs",
            "summarize todays runs",
            "latest runs",
            "recent runs",
            "show runs",
        ]
    ):
        return "latest_sessions"

    if any(keyword in text for keyword in ["show latest submissions", "recent submissions", "show submissions", "latest notes"]):
        return "latest_submissions"

    if any(
        keyword in text
        for keyword in [
            "show driver and vehicle data",
            "show drivers and vehicles",
            "driver vehicle mapping",
            "cars and drivers",
            "show latest drivers",
            "show latest vehicles",
            "show users",
            "show user data",
            "show driver data",
            "show vehicle data",
            "show driver info",
            "show vehicle info",
            "show user info",
            "driver information",
            "vehicle information",
            "user information",
            "driver details",
            "vehicle details",
            "user details",
            "list drivers",
            "list vehicles",
            "list users",
            "driver lookup",
            "vehicle lookup",
            "user lookup",
        ]
    ):
        return "driver_vehicle_data"

    if any(
        keyword in text
        for keyword in [
            "show setup for latest session",
            "latest setup",
            "quick summary of this session",
            "summary of this session",
            "summarize this session",
            "summarize latest session",
            "show full setup for latest session",
            "full setup sheet",
            "complete setup sheet",
            "setup sheet for latest session",
            "setup sheet",
            "setup values",
            "setup data",
        ]
    ):
        return "setup_latest_session"

    if any(
        keyword in text
        for keyword in [
            "show tire pressures for session",
            "pressure for session",
            "tire pressure session",
            "show tire pressures",
            "tire pressures",
            "show pressures",
            "pressures",
            "pressure data",
        ]
    ):
        return "tire_pressures_by_session"

    if any(
        keyword in text
        for keyword in [
            "tire temperatures",
            "tire temperature",
            "tire temp",
            "tire temps",
            "temperatures",
            "temperature",
            "temps",
            "temperature readings",
            "pyro",
            "pyrometer",
            "inner middle outer",
            "outer middle inner",
        ]
    ):
        return "tire_temperatures_by_session"

    if any(
        keyword in text
        for keyword in [
            "tire history",
            "tire set history",
            "tire usage",
            "heat cycle",
            "heat cycles",
            "tire compound",
            "tire compounds",
            "tire status",
            "tire age",
        ]
    ):
        return "tire_history_by_session"

    if any(
        keyword in text
        for keyword in [
            "show suspension data",
            "show suspension",
            "suspension setup",
            "damper data",
            "damper",
            "dampers",
            "bump rebound",
            "rebound",
            "bump",
            "compression",
            "sway bar",
            "swaybar",
            "wing angle",
            "wing",
        ]
    ):
        return "suspension_data"

    if any(
        keyword in text
        for keyword in [
            "show alignment for car",
            "alignment for car",
            "show toe/camber for car",
            "alignment data",
            "show alignment",
            "camber",
            "toe",
            "caster",
            "ride height",
            "corner weight",
            "cross weight",
            "wheelbase",
            "rake",
            "geometry",
        ]
    ):
        return "alignment_by_car"

    if has_session_term and "driver" in text and "vehicle" not in text:
        return "sessions_by_driver"

    if (
        has_session_term
        and (
            "event" in text
            or (query_in is not None and query_in.event_id is not None)
            or "this event" in text
        )
    ):
        return "sessions_by_event"

    if "event" in text and any(keyword in text for keyword in ["list", "show", "all", "latest"]):
        return "list_events"

    if has_session_term:
        return "latest_sessions"

    if any(term in text for term in ["user", "users", "account", "accounts"]):
        return "driver_vehicle_data"

    if (
        any(term in text for term in ["driver", "drivers", "vehicle", "vehicles", "car", "cars"])
        and any(keyword in text for keyword in ["show", "list", "lookup", "data", "info", "information", "details", "latest"])
    ):
        return "driver_vehicle_data"

    return "unsupported"


def build_chatbot_context(db: Session, *, limit: int = 10) -> ChatbotContextResponse:
    event_rows = list(
        db.execute(
            select(Event, RunGroup)
            .join(RunGroup, RunGroup.event_id == Event.id, isouter=True)
            .order_by(Event.start_date.desc(), Event.created_at.desc())
            .limit(limit)
        ).all()
    )
    session_rows = _load_session_rows(db, limit=limit)
    driver_rows = _load_driver_rows(db, limit=limit)
    vehicle_rows = _load_vehicle_rows(db, limit=limit)

    events = [_event_choice(event, run_group) for event, run_group in event_rows]
    sessions = [
        _session_choice(
            session,
            driver,
            vehicle,
            event_id=_session_event_id(session, event_rows),
        )
        for session, driver, vehicle in session_rows
    ]
    drivers = [_driver_choice(driver) for driver in driver_rows]
    vehicles = [_vehicle_choice(vehicle) for vehicle in vehicle_rows]

    default_driver_id = session_rows[0][1].driver_id if session_rows and session_rows[0][1] is not None else (drivers[0].value if drivers else None)
    default_vehicle_id = session_rows[0][2].vehicle_id if session_rows and session_rows[0][2] is not None else (vehicles[0].value if vehicles else None)

    context = ChatbotContextResponse(
        events=events,
        sessions=sessions,
        drivers=drivers,
        vehicles=vehicles,
        default_event_id=events[0].value if events else None,
        default_session_id=sessions[0].value if sessions else None,
        default_driver_id=default_driver_id,
        default_vehicle_id=default_vehicle_id,
        has_event_data=bool(events),
        has_session_data=bool(sessions),
        has_driver_data=bool(drivers),
        has_vehicle_data=bool(vehicles),
        source_label=SOURCE_LABEL,
    )
    logger.info(
        "Admin chatbot context built: events=%s sessions=%s drivers=%s vehicles=%s",
        len(events),
        len(sessions),
        len(drivers),
        len(vehicles),
    )
    return context


def build_chatbot_response(db: Session, query_in: ChatbotQuery, current_user: User | None = None) -> ChatbotResponse:
    query = query_in.message.strip()
    logger.info("Admin chatbot raw message received: %s", query)
    intent, deterministic_intent, nlp_result, nlp_filters = _resolve_chatbot_intent(query, query_in)
    logger.info(
        "Admin chatbot intent detected: intent=%s deterministic=%s nlp_intent=%s nlp_confidence=%s query=%s",
        intent,
        deterministic_intent,
        nlp_result.intent if nlp_result else None,
        nlp_result.confidence if nlp_result else None,
        query,
    )

    if intent in {"greeting", "help_services", "thanks"}:
        logger.info("Admin chatbot preset response selected: intent=%s", intent)
        return _greeting_response(query, intent=intent)

    event_rows = _load_event_rows(db, limit=None)
    event = db.get(Event, query_in.event_id) if query_in.event_id else None
    if query_in.event_id and event is None:
        logger.warning("Admin chatbot missing data: event not found for event_id=%s", query_in.event_id)
        return _not_found_response(
            "Events",
            "No event matching the selected event was found in the database.",
            intent=intent,
        )

    session_bundle = _load_session_bundle(db, query_in.session_id) if query_in.session_id else None
    if query_in.session_id and session_bundle is None:
        logger.warning("Admin chatbot missing data: session not found for session_id=%s", query_in.session_id)
        return _not_found_response(
            "Sessions",
            "No session matching the selected session was found in the database.",
            intent=intent,
        )

    selected_driver_rows = _load_driver_rows(db, limit=1, driver_id=query_in.driver_id) if query_in.driver_id else []
    selected_driver = selected_driver_rows[0] if selected_driver_rows else None
    if query_in.driver_id and selected_driver is None:
        logger.warning("Admin chatbot missing data: driver not found for driver_id=%s", query_in.driver_id)
        return _not_found_response(
            "Drivers",
            "No driver matching the selected driver was found in the database.",
            intent=intent,
        )

    selected_vehicle_rows = _load_vehicle_rows(db, limit=1, vehicle_id=query_in.vehicle_id) if query_in.vehicle_id else []
    selected_vehicle = selected_vehicle_rows[0] if selected_vehicle_rows else None
    if query_in.vehicle_id and selected_vehicle is None:
        logger.warning("Admin chatbot missing data: vehicle not found for vehicle_id=%s", query_in.vehicle_id)
        return _not_found_response(
            "Vehicles",
            "No vehicle matching the selected vehicle was found in the database.",
            intent=intent,
        )

    conversation = _load_chatbot_conversation_state(db, current_user=current_user, query_in=query_in)
    memory = _conversation_memory(conversation)

    driver_query = _extract_driver_query(query) or nlp_filters.get("driver_query") or None
    user_query = _extract_user_query(query) or None
    event_query = _extract_event_query(query) or nlp_filters.get("event_query") or None
    car_number = (query_in.car_number or _extract_car_number(query) or nlp_filters.get("car_number") or "").strip() or None
    session_number = _extract_session_number(query)
    if session_number is None and nlp_filters.get("session_number"):
        try:
            session_number = int(nlp_filters["session_number"])
        except ValueError:
            session_number = None
    session_date, session_date_label = _extract_session_date_filter(query)
    if session_date is None and nlp_filters.get("date_filter"):
        session_date, session_date_label = _extract_session_date_filter(nlp_filters["date_filter"])
    time_window = _extract_time_window(query) or nlp_filters.get("time_window") or None
    logger.info(
        "Admin chatbot extracted filters: event_id=%s session_id=%s driver_id=%s vehicle_id=%s driver_query=%s user_query=%s event_query=%s car_number=%s session_number=%s session_date=%s time_window=%s limit=%s",
        query_in.event_id,
        query_in.session_id,
        query_in.driver_id,
        query_in.vehicle_id,
        driver_query,
        user_query,
        event_query,
        car_number,
        session_number,
        session_date,
        time_window,
        query_in.limit,
    )

    if intent == "unsupported":
        logger.info("Admin chatbot unsupported query: %s", query)
        return _unsupported_response("AI Race Assistant", UNSUPPORTED_MESSAGE, intent="unsupported")

    if car_number and selected_vehicle is None and intent in VEHICLE_SCOPED_INTENTS:
        matches = _find_vehicle_matches(db, car_number)
        if not matches:
            logger.info("Admin chatbot missing data: vehicle scope car_number=%s intent=%s", car_number, intent)
            return _not_found_response(
                "Vehicles",
                NO_VEHICLE_MATCH_MESSAGE.format(term=car_number),
                intent=intent,
            )
        if len(matches) > 1:
            records_used = [
                _record_reference(
                    "vehicle",
                    vehicle.vehicle_id,
                    _vehicle_name(vehicle),
                    details=vehicle.registration_number or vehicle.vehicle_class,
                )
                for vehicle in matches
            ]
            driver_lookup = {driver.driver_id: driver for driver in _load_driver_rows(db, limit=25)}
            section = _build_candidate_table(
                title="Matching vehicles",
                subtitle="Choose the vehicle you want to inspect.",
                headers=["Vehicle", "Car", "Driver", "Status"],
                rows=[
                    [
                        _vehicle_name(vehicle),
                        vehicle.vehicle_id,
                        _driver_name(driver_lookup.get(vehicle.driver_id), vehicle.driver_id)
                        if vehicle.driver_id
                        else "Not available",
                        "Active" if vehicle.is_active else "Inactive",
                    ]
                    for vehicle in matches
                ],
                icon_key="vehicle",
            )
            return _selection_response(
                title="Choose a vehicle",
                message=MULTIPLE_VEHICLE_MATCH_MESSAGE.format(term=car_number),
                intent=intent,
                section=section,
                records_used=records_used,
            )
        selected_vehicle = matches[0]

    vehicle_filter_id = selected_vehicle.vehicle_id if selected_vehicle is not None else query_in.vehicle_id

    if intent == "list_events":
        rows = event_rows
        if not rows:
            logger.info("Admin chatbot missing data: intent=list_events")
            return _not_found_response("Events", NO_EVENTS_MESSAGE, intent="list_events")
        logger.info("Admin chatbot records found: intent=list_events count=%s", len(rows))
        return _events_response(rows)

    if intent == "latest_sessions":
        rows = _load_session_rows(
            db,
            event=event,
            driver_id=query_in.driver_id,
            vehicle_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
            limit=query_in.limit,
        )
        if not rows:
            logger.info(
                "Admin chatbot missing data: intent=latest_sessions event_id=%s driver_id=%s vehicle_id=%s",
                query_in.event_id,
                query_in.driver_id,
                vehicle_filter_id,
            )
            return _not_found_response("Latest Sessions", NO_DATA_MESSAGE, intent="latest_sessions")

        scope_notes: list[str] = []
        filter_note = _session_scope_note(
            session_date=session_date,
            session_date_label=session_date_label,
            time_window=time_window,
        )
        if filter_note:
            scope_notes.append(filter_note)
        if event is not None:
            scope_notes.append(f"Scoped to event {event.name}.")
        if selected_driver is not None:
            scope_notes.append(f"Scoped to driver {selected_driver.driver_name}.")
        if selected_vehicle is not None:
            scope_notes.append(f"Scoped to vehicle {selected_vehicle.vehicle_id}.")

        logger.info("Admin chatbot records found: intent=latest_sessions count=%s", len(rows))
        return _sessions_response(
            rows,
            scope_note=" ".join(scope_notes) if scope_notes else None,
            event_rows=event_rows,
            intent="latest_sessions",
            follow_up=[
                "Show sessions for this event",
                "Show sessions for driver Alex",
                "Show setup for latest session",
                "Show tire pressures",
            ],
        )

    if intent == "sessions_by_event":
        resolved_event = event
        if resolved_event is None and event_query:
            matches = _find_event_matches(db, event_query)
            if not matches:
                logger.info("Admin chatbot missing data: intent=sessions_by_event event_query=%s", event_query)
                return _not_found_response(
                    "Sessions",
                    f"No event matching '{event_query}' was found in the database.",
                    intent="sessions_by_event",
                )
            if len(matches) > 1:
                records_used = [
                    _record_reference("event", row_event.id, row_event.name, details=row_event.track)
                    for row_event, _ in matches
                ]
                section = _build_candidate_table(
                    title="Matching events",
                    subtitle="Choose the event you want to inspect.",
                    headers=["Event", "Track", "Dates", "Status"],
                    rows=[
                        [
                            row_event.name,
                            row_event.track,
                            f"{_date_text(row_event.start_date)} - {_date_text(row_event.end_date)}",
                            _humanize_enum("Active" if row_event.is_active else "Archived"),
                        ]
                        for row_event, _ in matches
                    ],
                    icon_key="event",
                )
                return _selection_response(
                    title="Choose an event",
                    message=f"I found multiple events matching '{event_query}'. Please choose the correct event.",
                    intent="sessions_by_event",
                    section=section,
                    records_used=records_used,
                )
            resolved_event = matches[0][0]

        if resolved_event is None:
            logger.info("Admin chatbot missing data: intent=sessions_by_event no event selected")
            return _needs_context_response(
                "Sessions",
                PLEASE_SELECT_EVENT_MESSAGE,
                intent="sessions_by_event",
                follow_up=["Show all events", "Show latest sessions"],
            )

        rows = _load_session_rows(
            db,
            event=resolved_event,
            driver_id=query_in.driver_id,
            vehicle_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
            limit=query_in.limit,
        )
        if not rows:
            logger.info("Admin chatbot missing data: intent=sessions_by_event event_id=%s", resolved_event.id)
            return _not_found_response(
                "Sessions",
                f"No sessions were found for event {resolved_event.name}.",
                intent="sessions_by_event",
            )

        scope_notes = [f"Scoped to event {resolved_event.name}."]
        filter_note = _session_scope_note(
            session_date=session_date,
            session_date_label=session_date_label,
            time_window=time_window,
        )
        if filter_note:
            scope_notes.append(filter_note)
        if selected_driver is not None:
            scope_notes.append(f"Scoped to driver {selected_driver.driver_name}.")
        if selected_vehicle is not None:
            scope_notes.append(f"Scoped to vehicle {selected_vehicle.vehicle_id}.")

        logger.info("Admin chatbot records found: intent=sessions_by_event count=%s", len(rows))
        return _sessions_response(
            rows,
            scope_note=" ".join(scope_notes),
            title=f"Sessions for {resolved_event.name}",
            intent="sessions_by_event",
            event_rows=event_rows,
            follow_up=["Show setup for latest session", "Show tire pressures", "Show driver and vehicle data"],
        )

    if intent == "sessions_by_driver":
        resolved_driver = selected_driver
        if resolved_driver is None:
            if not driver_query:
                return _needs_context_response(
                    "Sessions",
                    "Please include a driver name so I can show that driver's sessions.",
                    intent="sessions_by_driver",
                    follow_up=["Show driver and vehicle data", "Show latest sessions"],
                )

            matches = _find_driver_matches(db, driver_query)
            if not matches:
                logger.info("Admin chatbot missing data: intent=sessions_by_driver driver_query=%s", driver_query)
                return _not_found_response(
                    "Drivers",
                    NO_DRIVER_MATCH_MESSAGE.format(term=driver_query),
                    intent="sessions_by_driver",
                )
            if len(matches) > 1:
                records_used = [
                    _record_reference("driver", driver.driver_id, _driver_name(driver), details=driver.team_name)
                    for driver in matches
                ]
                section = _build_candidate_table(
                    title="Matching drivers",
                    subtitle="Choose the driver you want to inspect.",
                    headers=["Driver", "Code", "Team", "Status"],
                    rows=[
                        [
                            _driver_name(driver),
                            driver.driver_id,
                            driver.team_name or "Not available",
                            "Active" if driver.is_active else "Inactive",
                        ]
                        for driver in matches
                    ],
                    icon_key="driver",
                )
                return _selection_response(
                    title="Choose a driver",
                    message=MULTIPLE_DRIVER_MATCH_MESSAGE.format(term=driver_query),
                    intent="sessions_by_driver",
                    section=section,
                    records_used=records_used,
                )
            resolved_driver = matches[0]

        rows = _load_session_rows(
            db,
            event=event,
            driver_id=resolved_driver.driver_id,
            vehicle_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
            limit=query_in.limit,
        )
        if not rows:
            logger.info(
                "Admin chatbot missing data: intent=sessions_by_driver driver_id=%s event_id=%s vehicle_id=%s",
                resolved_driver.driver_id,
                query_in.event_id,
                vehicle_filter_id,
            )
            return _not_found_response(
                "Sessions",
                f"No sessions were found for driver {resolved_driver.driver_name}.",
                intent="sessions_by_driver",
            )

        scope_notes = [f"Scoped to driver {resolved_driver.driver_name}."]
        filter_note = _session_scope_note(
            session_date=session_date,
            session_date_label=session_date_label,
            time_window=time_window,
        )
        if filter_note:
            scope_notes.append(filter_note)
        if event is not None:
            scope_notes.append(f"Scoped to event {event.name}.")
        if selected_vehicle is not None:
            scope_notes.append(f"Scoped to vehicle {selected_vehicle.vehicle_id}.")

        logger.info("Admin chatbot records found: intent=sessions_by_driver count=%s", len(rows))
        return _sessions_response(
            rows,
            scope_note=" ".join(scope_notes),
            title=f"Sessions for {resolved_driver.driver_name}",
            intent="sessions_by_driver",
            event_rows=event_rows,
            follow_up=["Show driver and vehicle data", "Show setup for latest session", "Show latest sessions"],
        )

    if intent == "log_session_note":
        note = _extract_session_note_text(query)
        if note is None:
            return _needs_context_response(
                "Session Note",
                "Please include the note text. Example: 'Log note: car felt loose on corner exit for Session 2.'",
                intent="log_session_note",
                follow_up=["Log note: car felt loose on corner exit", "Show latest sessions"],
            )

        bundle, selection_response = _resolve_chat_write_bundle(
            db,
            event=event,
            event_rows=event_rows,
            session_bundle=session_bundle,
            query_in=query_in,
            session_number=session_number,
            vehicle_filter_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
            intent="log_session_note",
        )
        if selection_response is not None:
            return selection_response
        if bundle is None or (event is not None and not _session_in_event_window(bundle.session, event)):
            return _not_found_response("Session Note", NO_DATA_MESSAGE, intent="log_session_note")

        resolved_event, _ = _session_event_match(bundle.session, event_rows)
        logger.info("Admin chatbot write intent: log_session_note session=%s", bundle.session.id_seance)
        return _note_log_response(
            db,
            bundle=bundle,
            note=note,
            query=query,
            current_user=current_user,
            event=event or resolved_event,
        )

    if intent == "update_setup_fields":
        try:
            changes = _parse_setup_patch_from_query(query)
        except ValueError as exc:
            return _error_response("Setup Update", str(exc), intent="update_setup_fields")

        bundle, selection_response = _resolve_chat_write_bundle(
            db,
            event=event,
            event_rows=event_rows,
            session_bundle=session_bundle,
            query_in=query_in,
            session_number=session_number,
            vehicle_filter_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
            intent="update_setup_fields",
        )
        if selection_response is not None:
            return selection_response
        if bundle is None or (event is not None and not _session_in_event_window(bundle.session, event)):
            return _not_found_response("Setup Update", NO_DATA_MESSAGE, intent="update_setup_fields")

        resolved_event, _ = _session_event_match(bundle.session, event_rows)
        logger.info(
            "Admin chatbot write intent: update_setup_fields session=%s changes=%s",
            bundle.session.id_seance,
            len(changes),
        )
        return _setup_update_response(
            db,
            bundle=bundle,
            changes=changes,
            query=query,
            current_user=current_user,
            event=event or resolved_event,
        )

    if intent == "setup_latest_session":
        bundle = _select_anchor_session(
            db,
            event=event,
            session_id=query_in.session_id,
            driver_id=query_in.driver_id,
            vehicle_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
        )
        if bundle is None:
            logger.info(
                "Admin chatbot missing data: intent=setup_latest_session event_id=%s session_id=%s driver_id=%s vehicle_id=%s",
                query_in.event_id,
                query_in.session_id,
                query_in.driver_id,
                vehicle_filter_id,
            )
            return _not_found_response(
                "Setup Sheet",
                NO_DATA_MESSAGE,
                intent="setup_latest_session",
            )

        resolved_event, _ = _session_event_match(bundle.session, event_rows)
        logger.info("Admin chatbot records found: intent=setup_latest_session session=%s", bundle.session.id_seance)
        return _setup_response(
            db,
            bundle=bundle,
            event=event or resolved_event,
            title="Setup Sheet",
            intent="setup_latest_session",
        )

    if intent == "tire_pressures_by_session":
        bundle: SessionBundle | None = None
        if query_in.session_id:
            bundle = session_bundle
        elif session_number is not None:
            rows = _load_session_rows_by_number(
                db,
                session_number=session_number,
                event=event,
                driver_id=query_in.driver_id,
                vehicle_id=vehicle_filter_id,
                session_date=session_date,
                time_window=time_window,
            )
            if not rows:
                return _not_found_response("Tire Pressures", NO_DATA_MESSAGE, intent="tire_pressures_by_session")
            if len(rows) > 1 and event is None:
                records_used = [
                    _record_reference(
                        "session",
                        row_session.id_seance,
                        _session_heading(row_session),
                        details=f"{row_session.track} | {_date_text(row_session.session_date)}",
                    )
                    for row_session, _, _ in rows
                ]
                section = _build_candidate_table(
                    title="Matching sessions",
                    subtitle="Multiple session records match that number. Please choose one.",
                    headers=["Session", "Event", "Date", "Driver", "Vehicle"],
                    rows=[
                        [
                            _session_heading(row_session),
                            (_session_event_match(row_session, event_rows)[0].name if _session_event_match(row_session, event_rows)[0] else "Not available"),
                            _date_text(row_session.session_date),
                            _driver_name(row_driver, row_session.driver_id),
                            _vehicle_name(row_vehicle, row_session.vehicle_id),
                        ]
                        for row_session, row_driver, row_vehicle in rows
                    ],
                    icon_key="session",
                )
                return _selection_response(
                    title="Choose a session",
                    message=MULTIPLE_SESSION_MATCH_MESSAGE.format(number=session_number),
                    intent="tire_pressures_by_session",
                    section=section,
                    records_used=records_used,
                )
            bundle = _bundle_from_row(rows[0])
        else:
            bundle = _latest_bundle_with_record(
                db,
                model=Pressure,
                event=event,
                driver_id=query_in.driver_id,
                vehicle_id=vehicle_filter_id,
                session_date=session_date,
                time_window=time_window,
            )

        if bundle is None:
            logger.info(
                "Admin chatbot missing data: intent=tire_pressures_by_session event_id=%s session_number=%s",
                query_in.event_id,
                session_number,
            )
            return _not_found_response("Tire Pressures", NO_DATA_MESSAGE, intent="tire_pressures_by_session")

        if event is not None and not _session_in_event_window(bundle.session, event):
            return _not_found_response("Tire Pressures", NO_DATA_MESSAGE, intent="tire_pressures_by_session")

        pressure = db.scalar(select(Pressure).where(Pressure.id_seance == bundle.session.id_seance))
        if pressure is None:
            return _not_found_response("Tire Pressures", NO_DATA_MESSAGE, intent="tire_pressures_by_session")

        resolved_event, _ = _session_event_match(bundle.session, event_rows)
        summary = _session_summary(
            bundle,
            scope_note=" ".join(
                item
                for item in [
                    _session_scope_note(
                        session_date=session_date,
                        session_date_label=session_date_label,
                        time_window=time_window,
                    ),
                    "Review the pressure section below for the latest cold and hot readings.",
                ]
                if item
            ),
        )
        logger.info("Admin chatbot records found: intent=tire_pressures_by_session session=%s", bundle.session.id_seance)
        return _session_focus_response(
            db,
            bundle=bundle,
            detail_section=_pressure_section(pressure),
            title="Tire Pressures",
            summary=summary,
            intent="tire_pressures_by_session",
            event=event or resolved_event,
            follow_up=["Show suspension data", "Show alignment data", "Show setup for latest session"],
        )

    if intent == "tire_temperatures_by_session":
        bundle = _resolve_setup_section_bundle(
            db,
            event=event,
            session_bundle=session_bundle,
            query_in=query_in,
            session_number=session_number,
            vehicle_filter_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
            model=TireTemperature,
        )
        if bundle is None:
            logger.info("Admin chatbot missing data: intent=tire_temperatures_by_session")
            return _not_found_response(
                "Tire Temperatures",
                NO_DATA_MESSAGE,
                intent="tire_temperatures_by_session",
            )

        if event is not None and not _session_in_event_window(bundle.session, event):
            return _not_found_response(
                "Tire Temperatures",
                NO_DATA_MESSAGE,
                intent="tire_temperatures_by_session",
            )

        resolved_event, _ = _session_event_match(bundle.session, event_rows)
        temperature = db.scalar(select(TireTemperature).where(TireTemperature.id_seance == bundle.session.id_seance))
        if temperature is None:
            return _not_found_response(
                "Tire Temperatures",
                NO_DATA_MESSAGE,
                intent="tire_temperatures_by_session",
            )

        summary = _session_summary(
            bundle,
            scope_note=_setup_focus_scope_note(
                session_date=session_date,
                session_date_label=session_date_label,
                time_window=time_window,
                focus_note="Review the tire temperature section below for inner, middle, and outer readings by corner.",
            ),
        )
        logger.info(
            "Admin chatbot records found: intent=tire_temperatures_by_session session=%s",
            bundle.session.id_seance,
        )
        return _session_focus_response(
            db,
            bundle=bundle,
            detail_section=_temperature_section(temperature),
            title="Tire Temperatures",
            summary=summary,
            intent="tire_temperatures_by_session",
            event=event or resolved_event,
            follow_up=["Show tire pressures", "Show tire history", "Show setup for latest session"],
        )

    if intent == "tire_history_by_session":
        bundle = _resolve_setup_section_bundle(
            db,
            event=event,
            session_bundle=session_bundle,
            query_in=query_in,
            session_number=session_number,
            vehicle_filter_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
            model=TireHistory,
        )
        if bundle is None:
            logger.info("Admin chatbot missing data: intent=tire_history_by_session")
            return _not_found_response("Tire History", NO_DATA_MESSAGE, intent="tire_history_by_session")

        if event is not None and not _session_in_event_window(bundle.session, event):
            return _not_found_response("Tire History", NO_DATA_MESSAGE, intent="tire_history_by_session")

        resolved_event, _ = _session_event_match(bundle.session, event_rows)
        history_section = _history_section(db, bundle.session)
        if not history_section.cards:
            return _not_found_response("Tire History", NO_DATA_MESSAGE, intent="tire_history_by_session")

        summary = _session_summary(
            bundle,
            scope_note=_setup_focus_scope_note(
                session_date=session_date,
                session_date_label=session_date_label,
                time_window=time_window,
                focus_note="Review the tire history section below for tire IDs, compounds, heat cycles, duration, and status.",
            ),
        )
        logger.info(
            "Admin chatbot records found: intent=tire_history_by_session session=%s",
            bundle.session.id_seance,
        )
        return _session_focus_response(
            db,
            bundle=bundle,
            detail_section=history_section,
            title="Tire History",
            summary=summary,
            intent="tire_history_by_session",
            event=event or resolved_event,
            follow_up=["Show tire temperatures", "Show tire pressures", "Show setup for latest session"],
        )

    if intent == "suspension_data":
        bundle: SessionBundle | None = None
        if query_in.session_id:
            bundle = session_bundle
        elif session_number is not None:
            rows = _load_session_rows_by_number(
                db,
                session_number=session_number,
                event=event,
                driver_id=query_in.driver_id,
                vehicle_id=vehicle_filter_id,
                session_date=session_date,
                time_window=time_window,
            )
            if rows:
                bundle = _bundle_from_row(rows[0])
        else:
            bundle = _latest_bundle_with_record(
                db,
                model=Suspension,
                event=event,
                driver_id=query_in.driver_id,
                vehicle_id=vehicle_filter_id,
                session_date=session_date,
                time_window=time_window,
            )

        if bundle is None:
            logger.info("Admin chatbot missing data: intent=suspension_data")
            return _not_found_response("Suspension Data", NO_DATA_MESSAGE, intent="suspension_data")

        if event is not None and not _session_in_event_window(bundle.session, event):
            return _not_found_response("Suspension Data", NO_DATA_MESSAGE, intent="suspension_data")

        resolved_event, _ = _session_event_match(bundle.session, event_rows)
        suspension = db.scalar(select(Suspension).where(Suspension.id_seance == bundle.session.id_seance))
        if suspension is None:
            return _not_found_response("Suspension Data", NO_DATA_MESSAGE, intent="suspension_data")

        summary = _session_summary(
            bundle,
            scope_note=" ".join(
                item
                for item in [
                    _session_scope_note(
                        session_date=session_date,
                        session_date_label=session_date_label,
                        time_window=time_window,
                    ),
                    "Review the suspension section below for the latest damper and chassis settings.",
                ]
                if item
            ),
        )
        logger.info("Admin chatbot records found: intent=suspension_data session=%s", bundle.session.id_seance)
        return _session_focus_response(
            db,
            bundle=bundle,
            detail_section=_suspension_section(suspension),
            title="Suspension Data",
            summary=summary,
            intent="suspension_data",
            event=event or resolved_event,
            follow_up=["Show tire pressures", "Show alignment data", "Show setup for latest session"],
        )

    if intent == "alignment_by_car":
        if query_in.session_id or session_number is not None:
            bundle = _resolve_setup_section_bundle(
                db,
                event=event,
                session_bundle=session_bundle,
                query_in=query_in,
                session_number=session_number,
                vehicle_filter_id=vehicle_filter_id,
                session_date=session_date,
                time_window=time_window,
                model=Alignment,
            )
            if bundle is None:
                return _not_found_response("Alignment Data", NO_DATA_MESSAGE, intent="alignment_by_car")

            if event is not None and not _session_in_event_window(bundle.session, event):
                return _not_found_response("Alignment Data", NO_DATA_MESSAGE, intent="alignment_by_car")

            resolved_event, _ = _session_event_match(bundle.session, event_rows)
            alignment = db.scalar(select(Alignment).where(Alignment.id_seance == bundle.session.id_seance))
            if alignment is None:
                return _not_found_response("Alignment Data", NO_DATA_MESSAGE, intent="alignment_by_car")

            summary = _session_summary(
                bundle,
                scope_note=_setup_focus_scope_note(
                    session_date=session_date,
                    session_date_label=session_date_label,
                    time_window=time_window,
                    focus_note="Review the alignment section below for toe, camber, caster, ride height, corner weight, cross weight, rake, and wheelbase values.",
                ),
            )
            logger.info("Admin chatbot records found: intent=alignment_by_car session=%s", bundle.session.id_seance)
            return _session_focus_response(
                db,
                bundle=bundle,
                detail_section=_alignment_section(alignment),
                title="Alignment Data",
                summary=summary,
                intent="alignment_by_car",
                event=event or resolved_event,
                follow_up=["Show tire pressures", "Show suspension data", "Show setup for latest session"],
            )

        resolved_vehicle = selected_vehicle
        if resolved_vehicle is None:
            if car_number is None:
                bundle = _latest_bundle_with_record(
                    db,
                    model=Alignment,
                    event=event,
                    driver_id=query_in.driver_id,
                    vehicle_id=vehicle_filter_id,
                    session_date=session_date,
                    time_window=time_window,
                )
                if bundle is None:
                    return _not_found_response("Alignment Data", NO_DATA_MESSAGE, intent="alignment_by_car")
                resolved_event, _ = _session_event_match(bundle.session, event_rows)
                alignment = db.scalar(select(Alignment).where(Alignment.id_seance == bundle.session.id_seance))
                if alignment is None:
                    return _not_found_response("Alignment Data", NO_DATA_MESSAGE, intent="alignment_by_car")
                summary = _session_summary(
                    bundle,
                    scope_note=" ".join(
                        item
                        for item in [
                            _session_scope_note(
                                session_date=session_date,
                                session_date_label=session_date_label,
                                time_window=time_window,
                            ),
                            "Review the alignment section below for the latest toe, camber, caster, and ride-height values.",
                        ]
                        if item
                    ),
                )
                logger.info("Admin chatbot records found: intent=alignment_by_car session=%s", bundle.session.id_seance)
                return _session_focus_response(
                    db,
                    bundle=bundle,
                    detail_section=_alignment_section(alignment),
                    title="Alignment Data",
                    summary=summary,
                    intent="alignment_by_car",
                    event=event or resolved_event,
                    follow_up=["Show tire pressures", "Show suspension data", "Show setup for latest session"],
                )

            matches = _find_vehicle_matches(db, car_number)
            if not matches:
                logger.info("Admin chatbot missing data: intent=alignment_by_car car_number=%s", car_number)
                return _not_found_response(
                    "Vehicles",
                    NO_VEHICLE_MATCH_MESSAGE.format(term=car_number),
                    intent="alignment_by_car",
                )
            if len(matches) > 1:
                records_used = [
                    _record_reference(
                        "vehicle",
                        vehicle.vehicle_id,
                        _vehicle_name(vehicle),
                        details=vehicle.registration_number or vehicle.vehicle_class,
                    )
                    for vehicle in matches
                ]
                driver_lookup = {driver.driver_id: driver for driver in _load_driver_rows(db, limit=25)}
                section = _build_candidate_table(
                    title="Matching vehicles",
                    subtitle="Choose the vehicle you want to inspect.",
                    headers=["Vehicle", "Car", "Driver", "Status"],
                    rows=[
                        [
                            _vehicle_name(vehicle),
                            vehicle.vehicle_id,
                            _driver_name(driver_lookup.get(vehicle.driver_id), vehicle.driver_id)
                            if vehicle.driver_id
                            else "Not available",
                            "Active" if vehicle.is_active else "Inactive",
                        ]
                        for vehicle in matches
                    ],
                    icon_key="vehicle",
                )
                return _selection_response(
                    title="Choose a vehicle",
                    message=MULTIPLE_VEHICLE_MATCH_MESSAGE.format(term=car_number),
                    intent="alignment_by_car",
                    section=section,
                    records_used=records_used,
                )
            resolved_vehicle = matches[0]

        bundle = _latest_bundle_with_record(
            db,
            model=Alignment,
            event=event,
            vehicle_id=resolved_vehicle.vehicle_id,
            driver_id=query_in.driver_id,
            session_date=session_date,
            time_window=time_window,
        )
        if bundle is None:
            logger.info(
                "Admin chatbot missing data: intent=alignment_by_car vehicle_id=%s",
                resolved_vehicle.vehicle_id,
            )
            return _not_found_response(
                "Alignment Data",
                NO_DATA_MESSAGE,
                intent="alignment_by_car",
            )

        resolved_event, _ = _session_event_match(bundle.session, event_rows)
        alignment = db.scalar(select(Alignment).where(Alignment.id_seance == bundle.session.id_seance))
        if alignment is None:
            return _not_found_response("Alignment Data", NO_DATA_MESSAGE, intent="alignment_by_car")

        summary = _session_summary(
            bundle,
            scope_note=" ".join(
                item
                for item in [
                    _session_scope_note(
                        session_date=session_date,
                        session_date_label=session_date_label,
                        time_window=time_window,
                    ),
                    "Review the alignment section below for the latest toe, camber, caster, and ride-height values.",
                ]
                if item
            ),
        )
        logger.info("Admin chatbot records found: intent=alignment_by_car session=%s", bundle.session.id_seance)
        return _session_focus_response(
            db,
            bundle=bundle,
            detail_section=_alignment_section(alignment),
            title="Alignment Data",
            summary=summary,
            intent="alignment_by_car",
            event=event or resolved_event,
            follow_up=["Show tire pressures", "Show suspension data", "Show setup for latest session"],
        )

    if intent == "latest_submissions":
        response = _submissions_response(
            db,
            event=event,
            driver_id=query_in.driver_id,
            vehicle_id=vehicle_filter_id,
            limit=query_in.limit,
        )
        logger.info(
            "Admin chatbot records found: intent=latest_submissions status=%s count=%s",
            response.status,
            len(response.records_used or []),
        )
        return response

    if intent == "driver_vehicle_data":
        session_bundle = session_bundle
        if session_bundle is not None and event is not None and not _session_in_event_window(session_bundle.session, event):
            session_bundle = None
        matched_user_rows: list[User] | None = None
        if user_query:
            matched_user_rows = _find_user_matches(db, user_query)
            if not matched_user_rows:
                logger.info("Admin chatbot missing data: intent=driver_vehicle_data user_query=%s", user_query)
                return _not_found_response(
                    "Users",
                    NO_USER_MATCH_MESSAGE.format(term=user_query),
                    intent="driver_vehicle_data",
                )
        response = _fleet_response(
            db,
            session_bundle=session_bundle,
            driver_id=selected_driver.driver_id if selected_driver is not None else query_in.driver_id,
            vehicle_id=vehicle_filter_id,
            user_rows=matched_user_rows,
        )
        logger.info(
            "Admin chatbot records found: intent=driver_vehicle_data drivers=%s users=%s vehicles=%s session=%s",
            len([record for record in response.records_used or [] if record.kind == "driver"]),
            len([record for record in response.records_used or [] if record.kind == "user"]),
            len([record for record in response.records_used or [] if record.kind == "vehicle"]),
            session_bundle is not None,
        )
        return response

    if intent == "recommendation":
        response = _build_recommendation_response(
            db,
            query=query,
            query_in=query_in,
            memory=memory,
            event=event,
            session_bundle=session_bundle,
            driver_id=query_in.driver_id,
            vehicle_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
            intent="recommendation",
        )
        logger.info(
            "Admin chatbot records found: intent=recommendation status=%s count=%s",
            response.status,
            len(response.records_used or []),
        )
        return response

    if intent == "coaching":
        response = _build_coaching_response(
            db,
            query=query,
            query_in=query_in,
            memory=memory,
            event=event,
            session_bundle=session_bundle,
            driver_id=query_in.driver_id,
            vehicle_id=vehicle_filter_id,
            session_date=session_date,
            time_window=time_window,
            intent="coaching",
        )
        logger.info(
            "Admin chatbot records found: intent=coaching status=%s count=%s",
            response.status,
            len(response.records_used or []),
        )
        return response

    if intent == "compare":
        response = _compare_response(
            db,
            event=event,
            session_id=query_in.session_id,
            driver_id=query_in.driver_id,
            vehicle_id=vehicle_filter_id,
            query=query,
            session_date=session_date,
            time_window=time_window,
        )
        if response is None:
            logger.info(
                "Admin chatbot missing data: intent=compare event_id=%s session_id=%s driver_id=%s vehicle_id=%s",
                query_in.event_id,
                query_in.session_id,
                query_in.driver_id,
                vehicle_filter_id,
            )
            return _not_found_response(
                "Session Comparison",
                NO_DATA_MESSAGE,
                intent="compare",
            )
        logger.info("Admin chatbot records found: intent=compare")
        return response

    logger.info("Admin chatbot unsupported query fallback: %s", query)
    return _unsupported_response("AI Race Assistant", UNSUPPORTED_MESSAGE, intent="unsupported")
