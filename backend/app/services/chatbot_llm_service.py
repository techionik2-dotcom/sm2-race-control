from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Iterable

from app.core.config import get_settings
from app.schemas.chatbot import ChatbotCard, ChatbotQuery, ChatbotResponse, ChatbotSection


logger = logging.getLogger(__name__)

CHATBOT_PERSONA_PROMPT = (
    "You are the AI Race Assistant for the SM-2 Racing system. "
    "Act as a highly skilled motorsport data analyst and race engineer. "
    "Be professional, authoritative, concise, objective, empathetic, and structured. "
    "Use only the structured backend data provided to you. "
    "Do not invent values, guess missing data, or claim records that are not present. "
    "When the user greets you or asks what you can do, what services you provide, or asks for help, "
    "respond with a professional capability overview instead of a minimal greeting. "
    "For data-heavy responses, write a concise executive summary followed by 1 to 3 short narrative paragraphs. "
    "Explain what changed, why it matters, and the likely performance impact. "
    "Use structured details only when they improve clarity, and keep the prose practical for race team users. "
    "Close with a few relevant next prompts. "
    "If the backend response indicates ambiguity or missing context, explain that clearly and ask for only the missing detail. "
    "If the request is outside the supported scope, say so briefly and offer the closest supported actions."
)

LLM_SUMMARY_ALLOWED_INTENTS = {"compare", "recommendation", "coaching", "unsupported"}

INTENT_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "intent": {"type": "string"},
        "confidence": {"type": "number"},
        "car_number": {"type": "string"},
        "session_number": {"type": "string"},
        "driver_query": {"type": "string"},
        "event_query": {"type": "string"},
        "date_filter": {"type": "string"},
        "time_window": {"type": "string"},
        "explanation": {"type": "string"},
    },
    "required": [
        "intent",
        "confidence",
        "car_number",
        "session_number",
        "driver_query",
        "event_query",
        "date_filter",
        "time_window",
        "explanation",
    ],
}

SUMMARY_RESPONSE_TYPES = [
    "greeting",
    "query_success",
    "not_found",
    "unsupported",
    "needs_more_context",
    "session_summary",
    "comparison_summary",
    "setup_summary",
    "latest_submissions",
    "latest_sessions",
    "recommendation_summary",
    "coaching_summary",
]

SUMMARY_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "follow_up": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 4,
        },
        "response_type": {"type": "string", "enum": SUMMARY_RESPONSE_TYPES},
    },
    "required": ["summary", "follow_up", "response_type"],
}


@dataclass(slots=True)
class ChatbotLLMIntentResult:
    intent: str
    confidence: float
    filters: dict[str, str]
    explanation: str = ""


@dataclass(slots=True)
class ChatbotLLMSummaryResult:
    summary: str
    follow_up: list[str]
    response_type: str
    used_openai: bool
    fallback_used: bool
    model: str | None = None
    error: str | None = None


@dataclass(slots=True)
class FinalizedChatbotResponse:
    response: ChatbotResponse
    summary_result: ChatbotLLMSummaryResult


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


def _clean_filter_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_summary_text(value: Any) -> str:
    text = " ".join(str(value or "").split()).strip()
    if not text:
        return ""

    return (
        text.replace("session(s)", "sessions")
        .replace("record(s)", "records")
        .replace("submission(s)", "submissions")
        .replace("event(s)", "events")
    )


def _normalize_summary_narrative(value: Any) -> str:
    text = str(value or "").replace("\r\n", "\n").strip()
    if not text:
        return ""

    paragraphs = []
    for paragraph in re.split(r"\n+", text):
        normalized = " ".join(paragraph.split()).strip()
        if normalized:
            paragraphs.append(normalized)

    if not paragraphs:
        return ""

    return (
        "\n\n".join(paragraphs)
        .replace("session(s)", "sessions")
        .replace("record(s)", "records")
        .replace("submission(s)", "submissions")
        .replace("event(s)", "events")
    )


def _dedupe_follow_up(items: Iterable[str], limit: int = 4) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()

    for item in items:
        value = _normalize_summary_text(item)
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(value)
        if len(cleaned) >= limit:
            break

    return cleaned


def _call_openai_json(
    *,
    system_prompt: str,
    user_prompt: str,
    schema_name: str,
    schema: dict[str, Any],
    log_label: str,
) -> tuple[dict[str, Any] | None, str | None]:
    settings = get_settings()
    if not settings.chatbot_nlp_enabled:
        return None, "disabled"
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


def classify_chatbot_intent(
    *,
    query: str,
    deterministic_intent: str,
    allowed_intents: list[str],
    confidence_threshold: float,
) -> ChatbotLLMIntentResult | None:
    parsed, error = _call_openai_json(
        system_prompt=(
            "You classify SM2 Racing admin chatbot requests for the AI Race Assistant. "
            "Return only JSON that matches the schema. "
            "You are the first-pass intent classifier before backend routing. "
            "Choose one allowed intent. Extract only explicit filters from the user's text. "
            "Do not invent session IDs, car numbers, driver names, event names, dates, or times. "
            "Map sloppy grammar, short wording, typos, or indirect phrasing to the closest supported intent when the meaning is clear. "
            "Use greeting for simple hellos, help_services for capability or services questions, thanks for gratitude, "
            "list_events for latest or all event requests, latest_sessions for latest session/results/runs requests, "
            "latest_submissions for notes or submissions, setup_latest_session for setup details, "
            "tire_pressures_by_session for pressure requests, suspension_data for suspension, alignment_by_car for alignment, "
            "tire_temperatures_by_session for tire temperature requests, tire_history_by_session for tire history, "
            "sessions_by_event for event-scoped sessions, sessions_by_driver for driver-scoped sessions, "
            "driver_vehicle_data for driver, user, or vehicle lookups, compare for comparisons, recommendation for best-choice questions, "
            "coaching for improvement guidance, and unsupported when nothing supported fits."
        ),
        user_prompt=(
            f"User query: {query}\n"
            f"Deterministic fallback intent: {deterministic_intent}\n"
            f"Allowed intents: {', '.join(allowed_intents)}\n"
            "Use empty strings for unknown filters."
        ),
        schema_name="sm_racing_chatbot_intent",
        schema=INTENT_RESPONSE_SCHEMA,
        log_label="intent classification",
    )
    if parsed is None:
        if error not in {"disabled", "missing_api_key"}:
            logger.info("Admin chatbot LLM intent fallback used: reason=%s", error)
        return None

    intent = _clean_filter_text(parsed.get("intent"))
    if intent not in allowed_intents:
        logger.warning("OpenAI intent classification returned unsupported intent: %s", intent)
        return None

    try:
        confidence = float(parsed.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(confidence, 1.0))

    result = ChatbotLLMIntentResult(
        intent=intent,
        confidence=confidence,
        filters={
            "car_number": _clean_filter_text(parsed.get("car_number")),
            "session_number": _clean_filter_text(parsed.get("session_number")),
            "driver_query": _clean_filter_text(parsed.get("driver_query")),
            "event_query": _clean_filter_text(parsed.get("event_query")),
            "date_filter": _clean_filter_text(parsed.get("date_filter")),
            "time_window": _clean_filter_text(parsed.get("time_window")),
        },
        explanation=_clean_filter_text(parsed.get("explanation")),
    )

    logger.info(
        "Admin chatbot LLM intent classified: intent=%s confidence=%.2f accepted=%s",
        result.intent,
        result.confidence,
        result.confidence >= confidence_threshold,
    )
    return result


def _summarize_fields(fields: Iterable[Any], limit: int = 10) -> list[dict[str, str]]:
    summarized: list[dict[str, str]] = []
    for field in list(fields)[:limit]:
        label = _normalize_summary_text(getattr(field, "label", None))
        value = _normalize_summary_text(getattr(field, "value", None))
        if not label or not value:
            continue
        summarized.append({"label": label, "value": value})
    return summarized


def _summarize_card(card: ChatbotCard) -> dict[str, Any]:
    return {
        "title": _normalize_summary_text(card.title),
        "subtitle": _normalize_summary_text(card.subtitle),
        "badge": _normalize_summary_text(card.badge),
        "fields": _summarize_fields(card.fields, limit=8),
    }


def _summarize_section(section: ChatbotSection) -> dict[str, Any]:
    section_payload: dict[str, Any] = {
        "title": _normalize_summary_text(section.title),
        "subtitle": _normalize_summary_text(section.subtitle),
        "variant": section.variant,
    }

    if section.variant == "fields":
        section_payload["fields"] = _summarize_fields(section.fields, limit=12)
    elif section.variant == "cards":
        section_payload["cards"] = [_summarize_card(card) for card in list(section.cards)[:8]]
        section_payload["card_count"] = len(section.cards)
    elif section.variant == "table":
        headers = [_normalize_summary_text(header) for header in list(section.table_headers)[:8]]
        rows: list[dict[str, str] | list[str]] = []
        for row in list(section.table_rows)[:20]:
            cleaned_row = [_normalize_summary_text(cell) for cell in row[:8]]
            if headers and len(headers) == len(cleaned_row):
                rows.append({header: value for header, value in zip(headers, cleaned_row, strict=False)})
            else:
                rows.append(cleaned_row)
        section_payload["rows"] = rows
        section_payload["row_count"] = len(section.table_rows)

    return section_payload


def build_openai_context_from_backend_result(
    *,
    backend_response: ChatbotResponse,
    request_scope: ChatbotQuery | dict[str, Any] | None = None,
) -> dict[str, Any]:
    scope_source = (
        request_scope.model_dump(mode="json", exclude_none=True)
        if hasattr(request_scope, "model_dump")
        else dict(request_scope or {})
    )
    sections = [_summarize_section(section) for section in list(backend_response.sections)[:6]]
    records_used = [
        {
            "kind": _normalize_summary_text(record.kind),
            "label": _normalize_summary_text(record.label),
            "details": _normalize_summary_text(record.details),
        }
        for record in list(backend_response.records_used)[:8]
    ]

    return {
        "title": _normalize_summary_text(backend_response.title),
        "kind": backend_response.kind,
        "intent": _normalize_summary_text(backend_response.intent),
        "status": backend_response.status,
        "data_found": bool(backend_response.data_found),
        "summary": _normalize_summary_text(backend_response.summary),
        "no_data_message": _normalize_summary_text(backend_response.no_data_message),
        "data": backend_response.data if isinstance(backend_response.data, (dict, list)) else None,
        "records_used": records_used,
        "record_count": len(backend_response.records_used or []),
        "follow_up": _dedupe_follow_up(backend_response.follow_up, limit=4),
        "scope": {
            key: _normalize_summary_text(value)
            for key, value in scope_source.items()
            if value not in (None, "", [])
            and key in {"event_id", "session_id", "driver_id", "vehicle_id", "car_number", "limit"}
        },
        "sections": sections,
    }


def _default_response_type(response: ChatbotResponse) -> str:
    if response.status == "not_found":
        return "not_found"
    if response.status == "unsupported":
        return "unsupported"
    if response.status == "needs_context":
        return "needs_more_context"
    if response.kind == "compare":
        return "comparison_summary"
    if response.kind == "setup":
        return "setup_summary"
    if response.kind == "submissions":
        return "latest_submissions"
    if response.kind == "sessions":
        return "latest_sessions"
    if response.kind == "recommendation":
        return "recommendation_summary"
    if response.kind == "coaching":
        return "coaching_summary"
    if response.intent in {"greeting", "help_services", "thanks", "help"}:
        return "greeting"
    return "query_success"


def fallback_plain_response(*, user_query: str, backend_response: ChatbotResponse) -> ChatbotLLMSummaryResult:
    record_count = len(backend_response.records_used or [])
    summary = _normalize_summary_narrative(backend_response.summary or backend_response.answer)
    response_type = _default_response_type(backend_response)
    is_help_services = backend_response.intent == "help_services"

    if response_type == "greeting" and is_help_services:
        summary = (
            summary
            or (
                "I can help you with SM Racing race data and setup tasks.\n"
                "Here are the main things I can do:\n"
                "- Show latest events, sessions, drivers, vehicles, and submissions\n"
                "- Display setup details for a selected or latest session\n"
                "- Compare sessions and highlight changes\n"
                "- Review tire pressures, temperatures, suspension, and alignment\n"
                "- Summarize race notes and submissions\n"
                "- Suggest setup improvements based on previous session data"
            )
        )
    elif response_type == "greeting":
        summary = (
            summary
            or (
                "Hello, and welcome to the SM Racing System. "
                "I can help you with SM Racing race data and setup tasks. "
                "How Can I help you?"
            )
        )
    elif response_type == "latest_sessions" and record_count:
        summary = summary or f"I found {record_count} recent sessions in the SM2 Racing database."
    elif response_type == "latest_submissions" and record_count:
        summary = summary or f"I found {record_count} recent submissions in the SM2 Racing database."
    elif response_type == "comparison_summary":
        summary = summary or "Here is the session comparison, with the most important differences highlighted first."
    elif response_type == "setup_summary":
        summary = summary or "Here is the session setup summary from the SM2 Racing database."
    elif response_type == "recommendation_summary":
        summary = summary or "Based on the available evidence, here is the strongest option."
    elif response_type == "coaching_summary":
        summary = summary or "Based on the available evidence, here are the main improvement areas."
    elif response_type == "needs_more_context":
        summary = summary or "I need one more detail before I can return the correct SM2 Racing result."
    elif response_type == "not_found":
        summary = summary or "I could not find a matching result in the SM2 Racing database."
    elif response_type == "unsupported":
        summary = summary or (
            "I can help with sessions, setup data, comparisons, submissions, and driver or vehicle lookups."
        )
    elif not summary:
        summary = "I reviewed the latest SM2 Racing data and prepared a response."

    return ChatbotLLMSummaryResult(
        summary=summary,
        follow_up=_dedupe_follow_up(backend_response.follow_up, limit=4),
        response_type=response_type,
        used_openai=False,
        fallback_used=True,
    )


def generate_summary_response(
    *,
    user_query: str,
    backend_response: ChatbotResponse,
    request_scope: ChatbotQuery | dict[str, Any] | None = None,
) -> ChatbotLLMSummaryResult:
    fallback = fallback_plain_response(user_query=user_query, backend_response=backend_response)
    settings = get_settings()
    if not settings.chatbot_nlp_enabled or not settings.openai_api_key:
        return fallback

    context = build_openai_context_from_backend_result(
        backend_response=backend_response,
        request_scope=request_scope,
    )
    parsed, error = _call_openai_json(
        system_prompt=CHATBOT_PERSONA_PROMPT,
        user_prompt=(
            f"User query: {user_query}\n"
            f"Backend result:\n{json.dumps(context, ensure_ascii=False)}\n"
            "Return an executive summary followed by 1 to 3 short narrative paragraphs, "
            "then up to four helpful next prompts."
        ),
        schema_name="sm_racing_chatbot_summary",
        schema=SUMMARY_RESPONSE_SCHEMA,
        log_label="response generation",
    )
    if parsed is None:
        return ChatbotLLMSummaryResult(
            summary=fallback.summary,
            follow_up=fallback.follow_up,
            response_type=fallback.response_type,
            used_openai=False,
            fallback_used=True,
            error=error,
        )

    summary = _normalize_summary_narrative(parsed.get("summary"))
    if not summary:
        return ChatbotLLMSummaryResult(
            summary=fallback.summary,
            follow_up=fallback.follow_up,
            response_type=fallback.response_type,
            used_openai=False,
            fallback_used=True,
            error="empty_summary",
        )

    response_type = _clean_filter_text(parsed.get("response_type")) or fallback.response_type
    if response_type not in SUMMARY_RESPONSE_TYPES:
        response_type = fallback.response_type

    follow_up = _dedupe_follow_up(parsed.get("follow_up") or fallback.follow_up, limit=4)
    if not follow_up:
        follow_up = fallback.follow_up

    return ChatbotLLMSummaryResult(
        summary=summary,
        follow_up=follow_up,
        response_type=response_type,
        used_openai=True,
        fallback_used=False,
        model=settings.openai_model,
    )


def generate_nlp_response(
    *,
    user_query: str,
    backend_response: ChatbotResponse,
    request_scope: ChatbotQuery | dict[str, Any] | None = None,
) -> ChatbotLLMSummaryResult:
    if backend_response.intent not in LLM_SUMMARY_ALLOWED_INTENTS:
        return fallback_plain_response(user_query=user_query, backend_response=backend_response)

    return generate_summary_response(
        user_query=user_query,
        backend_response=backend_response,
        request_scope=request_scope,
    )


def finalize_chatbot_response(
    *,
    user_query: str,
    backend_response: ChatbotResponse,
    request_scope: ChatbotQuery | dict[str, Any] | None = None,
) -> FinalizedChatbotResponse:
    summary_result = generate_nlp_response(
        user_query=user_query,
        backend_response=backend_response,
        request_scope=request_scope,
    )
    backend_response.summary = summary_result.summary
    backend_response.answer = summary_result.summary
    if summary_result.follow_up:
        backend_response.follow_up = summary_result.follow_up

    logger.info(
        "Admin chatbot response finalized: status=%s kind=%s intent=%s openai_used=%s fallback_used=%s response_type=%s error=%s",
        backend_response.status,
        backend_response.kind,
        backend_response.intent,
        summary_result.used_openai,
        summary_result.fallback_used,
        summary_result.response_type,
        summary_result.error,
    )

    return FinalizedChatbotResponse(response=backend_response, summary_result=summary_result)
