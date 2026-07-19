from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.models.submission import Submission
from app.models.user import User
from app.schemas.submission_ai_summary import (
    SubmissionAiSummaryEntry,
    SubmissionAiSummaryResponse,
)
from app.services.submission_payload_service import get_session_payload


logger = logging.getLogger(__name__)

AI_SUMMARY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "keyObservations": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 6,
        },
        "needsReview": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 6,
        },
        "recommendedActions": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 6,
        },
    },
    "required": ["summary", "keyObservations", "needsReview", "recommendedActions"],
}

SETUP_SECTION_LABELS = {
    "pressures": "Tire pressures",
    "suspension": "Suspension",
    "alignment": "Alignment",
    "tire_temperatures": "Tire temperatures",
    "tire_history": "Tire history",
    "tire_inventory": "Tire inventory",
}

SESSION_FIELD_LABELS = {
    "date": "Date",
    "time": "Time",
    "session_type": "Session type",
    "session_number": "Session number",
    "duration_min": "Duration",
    "laps": "Laps",
    "conditions": "Conditions",
    "feedback": "Driver feedback",
    "best_lap": "Best lap",
    "wheelbase_mm": "Wheelbase",
}


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


def _clip_text(value: Any, limit: int = 1600) -> str | None:
    text_value = _clean_text(value)
    if not text_value:
        return None
    if len(text_value) <= limit:
        return text_value
    return f"{text_value[:limit].rstrip()}..."


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


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _safe_deepcopy_dict(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return deepcopy(value)


def _display_name(entity: Any, *fields: str) -> str | None:
    for field in fields:
        value = _clean_text(getattr(entity, field, None))
        if value:
            return value
    return None


def _vehicle_label(vehicle: Any) -> str | None:
    if vehicle is None:
        return None
    registration = _display_name(vehicle, "registration_number", "registrationNumber", "number")
    chassis = _display_name(vehicle, "chassis_number", "chassisNumber", "vin")
    model = _display_name(vehicle, "model", "name")
    return " / ".join(item for item in (registration, model, chassis) if item) or None


def _submission_status(value: Any) -> str | None:
    raw_value = getattr(value, "value", value)
    return _clean_text(raw_value)


def _extract_nested_text(source: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, str):
            return _clip_text(value)
        if isinstance(value, dict):
            nested_value = _extract_nested_text(value, "text", "summary", "transcript")
            if nested_value:
                return nested_value
    return None


def _source_type_label(submission: Submission, analysis: dict[str, Any]) -> str:
    source_type = _clean_text(analysis.get("source_type") or analysis.get("sourceType"))
    if source_type:
        source_type = source_type.replace("_", " ").title()
    if submission.voice_session_id or getattr(submission, "voice_session", None):
        return "Voice"
    if analysis.get("voice_input_used") or analysis.get("voiceInputUsed"):
        return "Voice"
    if _extract_nested_text(analysis, "ocr_text", "ocrText", "extracted_text", "extractedText"):
        return "OCR"
    if _clean_text(getattr(submission, "image_url", None)):
        return "OCR"
    if _clean_text(getattr(submission, "raw_text", None)):
        return "Notes"
    return source_type or "Unknown"


def _voice_transcript(submission: Submission) -> str | None:
    voice_session = getattr(submission, "voice_session", None)
    if voice_session is None:
        return None
    return _clip_text(
        getattr(voice_session, "transcript_edited_text", None)
        or getattr(voice_session, "transcript_text", None)
    )


def _collect_validation_messages(
    analysis: dict[str, Any],
    structured_warnings: Any,
    submission: Submission,
) -> list[str]:
    messages: list[str] = []

    def append(value: Any) -> None:
        if isinstance(value, str):
            text_value = _clean_text(value)
            if text_value and text_value not in messages:
                messages.append(text_value)
            return
        if isinstance(value, dict):
            text_value = _clean_text(
                value.get("message")
                or value.get("msg")
                or value.get("detail")
                or value.get("field")
                or value.get("label")
            )
            if text_value and text_value not in messages:
                messages.append(text_value)
            return
        if value is not None:
            append(str(value))

    for key in (
        "validation_messages",
        "validationMessages",
        "warnings",
        "review_flags",
        "reviewFlags",
        "failed_fields",
        "failedFields",
        "missing_fields",
        "missingFields",
    ):
        value = analysis.get(key)
        if isinstance(value, list):
            for item in value:
                append(item)
        else:
            append(value)

    if isinstance(structured_warnings, list):
        for warning in structured_warnings:
            append(warning)

    append(getattr(submission, "error_message", None))
    return messages[:12]


def _session_metadata(submission: Submission, session_payload: dict[str, Any]) -> dict[str, Any]:
    event = getattr(submission, "event", None)
    run_group = getattr(submission, "run_group", None)
    driver = getattr(submission, "driver", None)
    return {
        "submissionId": str(getattr(submission, "id", "")),
        "submissionRef": getattr(submission, "submission_ref", None),
        "status": _submission_status(getattr(submission, "status", None)),
        "driver": _display_name(driver, "name", "full_name", "display_name", "driver_id"),
        "vehicle": _vehicle_label(getattr(submission, "vehicle", None)),
        "event": _display_name(event, "name", "title"),
        "track": _display_name(event, "track_name", "track", "location"),
        "runGroup": _display_name(run_group, "name", "label", "code"),
        "sessionType": session_payload.get("session_type") or session_payload.get("sessionType"),
        "date": session_payload.get("date"),
        "time": session_payload.get("time"),
        "lastUpdatedAt": getattr(submission, "updated_at", None).isoformat()
        if getattr(submission, "updated_at", None)
        else None,
    }


def _setup_presence(session_payload: dict[str, Any]) -> dict[str, Any]:
    present_sections: list[str] = []
    missing_sections: list[str] = []
    partial_sections: list[str] = []
    setup_data: dict[str, Any] = {}

    for key, label in SETUP_SECTION_LABELS.items():
        value = session_payload.get(key)
        if _has_meaningful_value(value):
            present_sections.append(label)
            setup_data[label] = value
            if isinstance(value, dict) and any(not _has_meaningful_value(item) for item in value.values()):
                partial_sections.append(label)
        else:
            missing_sections.append(label)

    return {
        "presentSections": present_sections,
        "missingSections": missing_sections,
        "partialSections": partial_sections,
        "setupData": setup_data,
    }


def _missing_session_fields(session_payload: dict[str, Any], submission: Submission) -> list[str]:
    missing = [
        label
        for key, label in SESSION_FIELD_LABELS.items()
        if key in {"date", "time", "session_type", "session_number", "duration_min"}
        and not _has_meaningful_value(session_payload.get(key))
    ]
    if getattr(submission, "driver", None) is None and not _has_meaningful_value(session_payload.get("driver")):
        missing.append("Driver")
    if getattr(submission, "vehicle", None) is None and not _has_meaningful_value(session_payload.get("vehicle")):
        missing.append("Vehicle")
    return missing


def _build_ai_context(submission: Submission) -> dict[str, Any]:
    analysis = _dict_or_empty(getattr(submission, "analysis_result", None))
    session_payload = get_session_payload(getattr(submission, "payload", None))
    source_type = _source_type_label(submission, analysis)
    source = {
        "submittedVia": None if source_type == "Unknown" else source_type,
        "driverComments": _clip_text(session_payload.get("feedback") or analysis.get("driver_comments")),
        "ownerAdminNotes": _clip_text(analysis.get("admin_comment") or analysis.get("comments")),
        "rawNote": _clip_text(getattr(submission, "raw_text", None)),
        "voiceTranscript": _voice_transcript(submission),
        "ocrExtractedText": _extract_nested_text(
            analysis,
            "ocr_text",
            "ocrText",
            "extracted_text",
            "extractedText",
            "ocr_result",
            "ocrResult",
        ),
    }
    setup = _setup_presence(session_payload)
    validation_issues = _collect_validation_messages(
        analysis,
        getattr(submission, "structured_ingest_warnings", None),
        submission,
    )
    missing_sections = [
        *setup["missingSections"],
        *_missing_session_fields(session_payload, submission),
    ]

    return {
        "metadata": _session_metadata(submission, session_payload),
        "source": {key: value for key, value in source.items() if _has_meaningful_value(value)},
        "session": {
            SESSION_FIELD_LABELS.get(key, key): value
            for key, value in session_payload.items()
            if key in SESSION_FIELD_LABELS and _has_meaningful_value(value)
        },
        "setup": setup["setupData"],
        "completeSections": setup["presentSections"],
        "partialSections": setup["partialSections"],
        "missingOrPartialData": list(dict.fromkeys(missing_sections)),
        "validationIssues": validation_issues,
    }


def _has_enough_context(context: dict[str, Any]) -> bool:
    return any(
        _has_meaningful_value(context.get(key))
        for key in ("source", "session", "setup", "validationIssues")
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


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    normalized: list[str] = []
    for item in value:
        text_value = _clean_text(item)
        if text_value:
            normalized.append(text_value)
    return normalized[:6]


def _normalize_ai_response(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    summary = _clean_text(payload.get("summary"))
    if not summary:
        return None
    return {
        "summary": summary,
        "key_observations": _normalize_string_list(
            payload.get("keyObservations") or payload.get("key_observations"),
        ),
        "needs_review": _normalize_string_list(payload.get("needsReview") or payload.get("needs_review")),
        "recommended_actions": _normalize_string_list(
            payload.get("recommendedActions") or payload.get("recommended_actions"),
        ),
    }


def _load_submission(db: Session, submission_id: UUID) -> Submission | None:
    return db.scalar(
        select(Submission)
        .where(Submission.id == submission_id)
        .options(
            joinedload(Submission.event),
            joinedload(Submission.run_group),
            joinedload(Submission.driver),
            joinedload(Submission.vehicle),
            joinedload(Submission.voice_session),
        )
    )


def _current_user_label(user: User | None) -> str:
    if user is None:
        return "Admin"
    return _display_name(user, "name", "email") or "Admin"


def _persist_summary_entry(
    *,
    db: Session,
    submission: Submission,
    normalized_summary: dict[str, Any],
    context: dict[str, Any],
    current_user: User | None,
) -> dict[str, Any]:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    analysis = _safe_deepcopy_dict(getattr(submission, "analysis_result", None))
    existing_history = analysis.get("ai_summary_history")
    if not isinstance(existing_history, list):
        existing_history = []

    entry = {
        "summary_id": str(uuid4()),
        "generated_at": now.isoformat(),
        "summary": normalized_summary["summary"],
        "key_observations": normalized_summary["key_observations"],
        "needs_review": normalized_summary["needs_review"],
        "recommended_actions": normalized_summary["recommended_actions"],
        "generated_by": _current_user_label(current_user),
        "generated_by_id": str(getattr(current_user, "id", "")) if current_user is not None else None,
        "model": settings.openai_model,
        "source_summary": {
            "submitted_via": context.get("source", {}).get("submittedVia"),
            "missing_or_partial_count": len(context.get("missingOrPartialData") or []),
            "validation_issue_count": len(context.get("validationIssues") or []),
        },
    }
    history = [entry, *[item for item in existing_history if isinstance(item, dict)]][:10]
    analysis["ai_summary_current"] = entry
    analysis["ai_summary_history"] = history
    analysis["ai_summary_count"] = len(history)
    analysis["ai_summary_last_generated_at"] = entry["generated_at"]
    analysis["ai_summary_last_generated_by"] = entry["generated_by"]

    submission.analysis_result = analysis
    db.add(submission)
    db.commit()
    db.refresh(submission)
    return entry


def _entry_schema(entry: dict[str, Any]) -> SubmissionAiSummaryEntry:
    return SubmissionAiSummaryEntry(
        summaryId=entry.get("summary_id") or entry.get("summaryId"),
        generatedAt=entry.get("generated_at") or entry.get("generatedAt"),
        summary=entry.get("summary") or "",
        keyObservations=entry.get("key_observations") or entry.get("keyObservations") or [],
        needsReview=entry.get("needs_review") or entry.get("needsReview") or [],
        recommendedActions=entry.get("recommended_actions") or entry.get("recommendedActions") or [],
        generatedBy=entry.get("generated_by") or entry.get("generatedBy"),
        model=entry.get("model"),
    )


def generate_submission_ai_summary(
    db: Session,
    submission_id: UUID,
    current_user: User | None,
) -> SubmissionAiSummaryResponse:
    submission = _load_submission(db, submission_id)
    if submission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SUBMISSION_NOT_FOUND", "message": "Submission not found."},
        )

    context = _build_ai_context(submission)
    if not _has_enough_context(context):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "AI_SUMMARY_INSUFFICIENT_DATA",
                "message": "Not enough session data is available to generate a useful summary.",
            },
        )

    parsed, error = _call_openai_json(
        system_prompt=(
            "You are the SM-2 Race Control AI summary assistant. "
            "Generate a concise, professional, admin-facing session summary. "
            "Use only the provided session data. Do not invent missing values. "
            "Clearly mention missing or partial data. "
            "Focus on what Admin should review before saving or updating the session, "
            "and include practical improvement recommendations supported by the data. "
            "Do not mention internal backend field names. Return only JSON matching the schema."
        ),
        user_prompt=(
            "Create an AI Summary for this one session/submission only.\n\n"
            f"Session data:\n{json.dumps(context, default=str, ensure_ascii=False, indent=2)}"
        ),
        schema_name="sm2_session_ai_summary",
        schema=AI_SUMMARY_SCHEMA,
        log_label="submission AI summary",
    )
    normalized_summary = _normalize_ai_response(parsed)
    if normalized_summary is None:
        logger.warning(
            "AI summary generation failed for submission_id=%s: reason=%s",
            submission_id,
            error or "invalid_payload",
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "AI_SUMMARY_GENERATION_FAILED",
                "message": "Could not generate AI summary. Please try again.",
            },
        )

    entry = _persist_summary_entry(
        db=db,
        submission=submission,
        normalized_summary=normalized_summary,
        context=context,
        current_user=current_user,
    )
    analysis = _dict_or_empty(getattr(submission, "analysis_result", None))
    history = [
        _entry_schema(item)
        for item in analysis.get("ai_summary_history", [])
        if isinstance(item, dict)
    ]

    return SubmissionAiSummaryResponse(
        submissionId=submission.id,
        submissionRef=submission.submission_ref,
        summaryId=entry["summary_id"],
        generatedAt=entry["generated_at"],
        summary=entry["summary"],
        keyObservations=entry["key_observations"],
        needsReview=entry["needs_review"],
        recommendedActions=entry["recommended_actions"],
        generatedBy=entry["generated_by"],
        model=entry["model"],
        summaryHistory=history,
        submission=submission,
    )
