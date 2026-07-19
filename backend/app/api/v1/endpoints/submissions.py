import json
import logging
import secrets
from collections.abc import Mapping
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Body, Depends, Header, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_roles
from app.core.config import get_ocr_config_status, get_settings
from app.core.database import get_db
from app.core.enums import SubmissionStatus, UserRole, VoiceNoteStatus
from app.models.driver import Driver
from app.models.event import Event
from app.models.run_group import RunGroup
from app.models.structured_notes import Seance
from app.models.submission import Submission
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.voice_note import VoiceNoteSession
from app.schemas.submission import (
    OcrPreviewCreate,
    OcrPreviewRead,
    OcrStagedDraftRead,
    OcrWebhookIngestRead,
    RawSubmissionCreate,
    RawSubmissionResult,
    SubmissionCreate,
    SubmissionRead,
    SubmissionUpdate,
)
from app.services.ocr_service import (
    analyze_submission_image,
    extract_normalized_inbound_analysis,
    normalize_image_analysis_result,
)
from app.services.raw_note_llm_service import extract_raw_note_via_openai
from app.services.raw_submission_service import (
    RawSubmissionValidationError,
    build_raw_submission_payload,
    describe_raw_exception,
    parse_raw_note,
    resolve_driver_alias,
    resolve_vehicle_alias,
    validate_raw_submission_payload,
)
from app.services.raw_submission_current_schema_service import (
    lookup_raw_duplicate_current_schema,
    persist_raw_submission_current_schema,
    write_raw_audit_log_current_schema,
)
from app.services.run_group_service import normalize_run_group
from app.services.submission_delivery_service import (
    enqueue_submission_delivery,
    process_submission_delivery,
    process_submission_delivery_task,
)
from app.services.submission_ingest_service import (
    _insert_media_file,
    _insert_ocr_result,
    _insert_submission_input,
    _write_audit_log,
    persist_structured_submission,
    record_image_analysis_result,
    stage_submission_input,
)
from app.services.submission_payload_service import (
    get_session_payload,
    merge_submission_analysis,
    normalize_optional_text,
    should_persist_structured_submission,
)
from app.services.voice_note_service import confirm_voice_session, get_voice_session_for_user


router = APIRouter()
settings = get_settings()
logger = logging.getLogger(__name__)
MAX_OCR_SOURCE_IMAGES = 3


def _normalize_image_url_list(*values: object, limit: int | None = MAX_OCR_SOURCE_IMAGES) -> list[str]:
    image_urls: list[str] = []

    def append_image_url(value: object) -> None:
        if not isinstance(value, str):
            return
        normalized_value = value.strip()
        if not normalized_value or normalized_value in image_urls:
            return
        image_urls.append(normalized_value)

    def consume(value: object) -> None:
        if value in (None, ""):
            return

        if limit is not None and len(image_urls) >= limit:
            return

        if isinstance(value, list):
            for item in value:
                consume(item)
                if limit is not None and len(image_urls) >= limit:
                    break
            return

        if isinstance(value, str):
            append_image_url(value)
            return

        if isinstance(value, Mapping):
            append_image_url(
                value.get("image_url")
                or value.get("imageUrl")
                or value.get("image")
                or value.get("data_url")
                or value.get("dataUrl")
                or value.get("url")
            )

            nested_image = value.get("image")
            if nested_image is not None:
                consume(nested_image)

            base64_value = normalize_optional_text(value.get("base64"))
            mime_type = normalize_optional_text(value.get("mime_type") or value.get("mimeType"))
            if base64_value and mime_type:
                append_image_url(f"data:{mime_type};base64,{base64_value}")

            consume(value.get("image_urls") or value.get("imageUrls"))
            consume(value.get("source_documents") or value.get("sourceDocuments"))

    for value in values:
        consume(value)
        if limit is not None and len(image_urls) >= limit:
            break

    return image_urls


def _merge_payload_image_urls(payload: object, image_urls: list[str]) -> dict[str, Any]:
    payload_map = _dict_or_empty(payload)
    if not image_urls:
        if "image_urls" not in payload_map:
            return payload_map
        next_payload = dict(payload_map)
        next_payload.pop("image_urls", None)
        return next_payload

    return {
        **payload_map,
        "image_urls": image_urls,
    }


def _submission_error(
    status_code: int,
    code: str,
    message: str,
    *,
    detail: dict | None = None,
) -> HTTPException:
    payload: dict[str, object] = {"code": code, "message": message}
    if detail is not None:
        payload["detail"] = detail
    return HTTPException(status_code=status_code, detail=payload)


def _submission_log_summary(
    *,
    submission_ref: str | None,
    correlation_id: str | None,
    event_id: UUID | None,
    run_group_id: UUID | None,
    driver_id: str | None,
    vehicle_id: str | None,
    current_user_id: UUID | None,
    payload: dict | None = None,
) -> str:
    session_payload = get_session_payload(payload)
    session_date = normalize_optional_text(session_payload.get("date"))
    session_time = normalize_optional_text(session_payload.get("time"))
    session_number = session_payload.get("session_number")
    session_type = normalize_optional_text(session_payload.get("session_type"))

    return (
        f"submission_ref={submission_ref or 'none'} "
        f"correlation_id={correlation_id or 'none'} "
        f"event_id={event_id or 'none'} "
        f"run_group_id={run_group_id or 'none'} "
        f"driver_id={driver_id or 'none'} "
        f"vehicle_id={vehicle_id or 'none'} "
        f"user_id={current_user_id or 'none'} "
        f"session_date={session_date or 'none'} "
        f"session_time={session_time or 'none'} "
        f"session_type={session_type or 'none'} "
        f"session_number={session_number if session_number not in (None, '') else 'none'}"
    )


def _with_suffix(value: str, suffix: str, max_length: int) -> str:
    if len(suffix) >= max_length:
        return suffix[:max_length]
    return f"{value[: max_length - len(suffix)]}{suffix}"


def _ensure_unique_submission_ref(db: Session, submission_ref: str | None) -> str:
    candidate = (normalize_optional_text(submission_ref) or str(uuid4()))[:120]
    while db.scalar(select(Submission.id).where(Submission.submission_ref == candidate)) is not None:
        candidate = _with_suffix(candidate, f"-{uuid4().hex[:8]}", 120)
    return candidate


def _ensure_unique_correlation_id(db: Session, correlation_id: str | None) -> str:
    candidate = (normalize_optional_text(correlation_id) or str(uuid4()))[:36]
    while db.scalar(select(Submission.id).where(Submission.correlation_id == candidate)) is not None:
        candidate = str(uuid4())
    return candidate


def _is_integrity_duplicate_error(exc: IntegrityError) -> bool:
    message = " ".join(str(part) for part in getattr(exc, "args", ()) or (str(exc),)).lower()
    if "duplicate key" in message:
        return True
    if "unique constraint" in message:
        return True
    if "uq_submissions_session_fingerprint" in message:
        return True
    if "ux_submissions_correlation_id" in message:
        return True
    return False


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None

    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)


def _is_midnight(value: datetime) -> bool:
    return (
        value.hour == 0
        and value.minute == 0
        and value.second == 0
        and value.microsecond == 0
    )


def _event_submission_start_to_utc(event: Event) -> datetime | None:
    return _as_utc(getattr(event, "start_date", None))


def _event_submission_end_to_utc(event: Event) -> datetime | None:
    end_date = _as_utc(getattr(event, "end_date", None))
    if end_date is None:
        return None

    # Admin events are date-based, so a midnight end date should stay open through that full day.
    if _is_midnight(end_date):
        return end_date + timedelta(days=1)

    return end_date


def _submission_options():
    return (
        joinedload(Submission.event),
        joinedload(Submission.run_group),
        joinedload(Submission.driver),
        joinedload(Submission.vehicle),
        joinedload(Submission.voice_session).joinedload(VoiceNoteSession.attempts),
    )


def _submission_stmt():
    return select(Submission).options(*_submission_options()).order_by(Submission.created_at.desc())


def _load_submission(db: Session, submission_id: UUID) -> Submission | None:
    stmt = select(Submission).options(*_submission_options()).where(Submission.id == submission_id)
    return db.scalar(stmt)


def _validate_submission_update_relations(
    db: Session,
    submission_in: SubmissionUpdate,
) -> tuple[Driver | None, Vehicle | None]:
    driver_code = normalize_optional_text(submission_in.driver_id)
    vehicle_code = normalize_optional_text(submission_in.vehicle_id)

    if bool(driver_code) ^ bool(vehicle_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Driver and vehicle must be updated together",
        )

    driver = None
    vehicle = None

    if driver_code and vehicle_code:
        driver = db.scalar(select(Driver).where(Driver.driver_id == driver_code))
        if not driver:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")
        if not driver.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver is archived")

        vehicle = db.scalar(select(Vehicle).where(Vehicle.vehicle_id == vehicle_code))
        if not vehicle:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
        if not vehicle.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Vehicle is archived")

        if vehicle.driver_id != driver.driver_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Vehicle does not belong to the selected driver",
            )

    return driver, vehicle


def _validate_submission_relations(
    db: Session,
    submission_in: SubmissionCreate,
) -> tuple[Driver | None, Vehicle | None]:
    driver = None
    vehicle = None

    if submission_in.driver_id and not submission_in.vehicle_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vehicle is required when a driver is selected",
        )
    if submission_in.vehicle_id and not submission_in.driver_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Driver is required when a vehicle is selected",
        )

    if submission_in.driver_id:
        driver_code = submission_in.driver_id.strip()
        driver = db.scalar(select(Driver).where(Driver.driver_id == driver_code))
        if not driver:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")
        if not driver.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver is archived")

    if submission_in.vehicle_id:
        vehicle_code = submission_in.vehicle_id.strip()
        vehicle = db.scalar(select(Vehicle).where(Vehicle.vehicle_id == vehicle_code))
        if not vehicle:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
        if not vehicle.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Vehicle is archived")

    if driver and vehicle and vehicle.driver_id != driver.driver_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vehicle does not belong to the selected driver",
        )

    return driver, vehicle


def _validate_ocr_preview_relations(
    db: Session,
    preview_in: OcrPreviewCreate,
) -> tuple[Driver | None, Vehicle | None]:
    driver = None
    vehicle = None

    if preview_in.driver_id:
        driver_code = preview_in.driver_id.strip()
        driver = db.scalar(select(Driver).where(Driver.driver_id == driver_code))
        if not driver:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")
        if not driver.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver is archived")

    if preview_in.vehicle_id:
        vehicle_code = preview_in.vehicle_id.strip()
        vehicle = db.scalar(select(Vehicle).where(Vehicle.vehicle_id == vehicle_code))
        if not vehicle:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
        if not vehicle.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Vehicle is archived")

    if driver and vehicle and vehicle.driver_id != driver.driver_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vehicle does not belong to the selected driver",
        )

    return driver, vehicle


def _dict_or_empty(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _list_or_empty(value: object) -> list:
    return value if isinstance(value, list) else []


def _json_dict_or_empty(value: object) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _preview_text(value: object) -> str:
    return normalize_optional_text(value) or ""


def _preview_session_text(session_type: object, session_number: object) -> str:
    session_type_value = _preview_text(session_type)
    session_number_value = _preview_text(session_number)
    if session_type_value and session_number_value:
        return f"{session_type_value} S{session_number_value}"
    return session_type_value or session_number_value


def _precomputed_image_analysis(analysis_result: object) -> dict | None:
    analysis = _dict_or_empty(analysis_result)
    image_analysis = analysis.get("image_analysis") or analysis.get("imageAnalysis")
    return image_analysis if isinstance(image_analysis, dict) else None


def _build_ocr_failure_analysis(message: str) -> dict[str, object]:
    return {
        "status": "extraction_failed",
        "message": message,
        "document_type": "unknown",
        "confidence": 0.0,
        "has_values": False,
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
        "warnings": ["Manual review required"],
        "recommended_review_status": "PENDING",
    }


def _build_ocr_waiting_analysis(message: str | None = None) -> dict[str, object]:
    waiting_message = (
        normalize_optional_text(message)
        or "Submitted to Make.com. Waiting for the OCR draft response."
    )
    return {
        "status": "submitted_to_make",
        "message": waiting_message,
        "document_type": "unknown",
        "confidence": 0.0,
        "has_values": False,
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
        "summary": waiting_message,
        "model": "make.com",
        "fallback_model_used": False,
    }


def _build_ocr_preview_response(
    *,
    image_analysis: dict | None,
    image_url: str | None,
    image_urls: list[str] | None,
    context: dict | None,
    event: Event | None,
    run_group: RunGroup | None,
    driver: Driver | None,
    vehicle: Vehicle | None,
    submission_ref: str | None = None,
    correlation_id: str | None = None,
    source: str | None = None,
) -> OcrPreviewRead:
    analysis = normalize_image_analysis_result(image_analysis)
    preview_context = _dict_or_empty(context)
    normalized_image_urls = _normalize_image_url_list(image_url, image_urls, limit=MAX_OCR_SOURCE_IMAGES)
    setup = _dict_or_empty(analysis.get("setup"))
    alignment = _dict_or_empty(setup.get("alignment"))
    suspension = _dict_or_empty(setup.get("suspension"))
    tire_temperatures = _dict_or_empty(setup.get("tire_temperatures"))
    raw_pressures = _dict_or_empty(setup.get("pressures"))
    sheet_fields = _dict_or_empty(setup.get("sheet_fields"))
    post_session = _dict_or_empty(setup.get("post_session"))
    shock_setup = _dict_or_empty(setup.get("shock_setup"))
    extracted_metadata = _dict_or_empty(analysis.get("metadata"))
    template_name = _preview_text(analysis.get("template_name"))
    preview_driver_name = _preview_text(
        preview_context.get("driver_name") or preview_context.get("driverName")
    )
    preview_driver_id = _preview_text(
        preview_context.get("driver_id") or preview_context.get("driverId")
    )
    preview_vehicle_id = _preview_text(
        preview_context.get("vehicle_id") or preview_context.get("vehicleId")
    )
    preview_vehicle_text = _preview_text(
        preview_context.get("vehicle_text") or preview_context.get("vehicleText")
    )

    notes = [_preview_text(note) for note in _list_or_empty(setup.get("notes")) if _preview_text(note)]

    context_note = _preview_text(preview_context.get("notes") or preview_context.get("note"))
    if context_note and context_note not in notes:
        notes.append(context_note)

    metadata = {
        "driver_text": (
            _preview_text(extracted_metadata.get("driver_text"))
            or _preview_text(getattr(driver, "driver_name", None))
            or preview_driver_name
            or _preview_text(getattr(driver, "driver_id", None))
            or preview_driver_id
        ),
        "vehicle_text": (
            _preview_text(extracted_metadata.get("vehicle_text"))
            or preview_vehicle_text
            or _preview_text(getattr(vehicle, "vehicle_id", None))
            or preview_vehicle_id
        ),
        "track_text": _preview_text(extracted_metadata.get("track_text"))
        or _preview_text(preview_context.get("track"))
        or _preview_text(getattr(event, "track", None)),
        "session_text": _preview_text(extracted_metadata.get("session_text"))
        or _preview_session_text(preview_context.get("session_type"), preview_context.get("session_number")),
        "event_name": _preview_text(extracted_metadata.get("event_name")) or _preview_text(getattr(event, "name", None)),
        "run_group": _preview_text(extracted_metadata.get("run_group"))
        or _preview_text(getattr(run_group, "normalized", None) or getattr(run_group, "raw_text", None)),
        "template_name": template_name,
    }

    structured_data = {
        "session": {
            "date": _preview_text(preview_context.get("date")),
            "time": _preview_text(preview_context.get("time")),
            "track": metadata["track_text"],
            "session_type": _preview_text(preview_context.get("session_type")),
            "session_number": _preview_text(preview_context.get("session_number")),
            "duration_min": _preview_text(preview_context.get("duration_min")),
            "driver_id": _preview_text(getattr(driver, "driver_id", None)) or preview_driver_id,
            "vehicle_id": _preview_text(getattr(vehicle, "vehicle_id", None)) or preview_vehicle_id,
        },
        "alignment": {
            "rh_fl": _preview_text(alignment.get("rh_fl")),
            "rh_fr": _preview_text(alignment.get("rh_fr")),
            "rh_rl": _preview_text(alignment.get("rh_rl")),
            "rh_rr": _preview_text(alignment.get("rh_rr")),
            "ride_height_f": _preview_text(alignment.get("ride_height_f")),
            "ride_height_r": _preview_text(alignment.get("ride_height_r")),
            "camber_fl": _preview_text(alignment.get("camber_fl")),
            "camber_fr": _preview_text(alignment.get("camber_fr")),
            "camber_rl": _preview_text(alignment.get("camber_rl")),
            "camber_rr": _preview_text(alignment.get("camber_rr")),
            "toe_fl": _preview_text(alignment.get("toe_fl")),
            "toe_fr": _preview_text(alignment.get("toe_fr")),
            "toe_rl": _preview_text(alignment.get("toe_rl")),
            "toe_rr": _preview_text(alignment.get("toe_rr")),
            "toe_front": _preview_text(alignment.get("toe_front")),
            "toe_rear": _preview_text(alignment.get("toe_rear")),
            "caster_l": _preview_text(alignment.get("caster_l")),
            "caster_r": _preview_text(alignment.get("caster_r")),
            "rake_mm": _preview_text(alignment.get("rake_mm")),
            "wheelbase_mm": _preview_text(alignment.get("wheelbase_mm")),
        },
        "pressures": {
            "cold": {
                "fl": _preview_text(raw_pressures.get("cold_fl")),
                "fr": _preview_text(raw_pressures.get("cold_fr")),
                "rl": _preview_text(raw_pressures.get("cold_rl")),
                "rr": _preview_text(raw_pressures.get("cold_rr")),
            },
            "hot": {
                "fl": _preview_text(raw_pressures.get("hot_fl")),
                "fr": _preview_text(raw_pressures.get("hot_fr")),
                "rl": _preview_text(raw_pressures.get("hot_rl")),
                "rr": _preview_text(raw_pressures.get("hot_rr")),
            },
        },
        "suspension": {key: _preview_text(value) for key, value in suspension.items()},
        "suspensions": {key: _preview_text(value) for key, value in suspension.items()},
        "tire_temperatures": {key: _preview_text(value) for key, value in tire_temperatures.items()},
        "sheet_fields": {key: _preview_text(value) for key, value in sheet_fields.items()},
        "post_session": {key: _preview_text(value) for key, value in post_session.items()},
        "shock_setup": {
            corner: {key: _preview_text(value) for key, value in _dict_or_empty(values).items()}
            for corner, values in shock_setup.items()
        },
        "notes": notes,
    }

    return OcrPreviewRead(
        status=_preview_text(analysis.get("status")) or "success",
        message=_preview_text(analysis.get("message")) or None,
        submission_ref=_preview_text(submission_ref) or None,
        correlation_id=_preview_text(correlation_id) or None,
        source=_preview_text(source) or None,
        image_url=_preview_text(normalized_image_urls[0] if normalized_image_urls else image_url) or None,
        image_urls=normalized_image_urls,
        doc_type=_preview_text(analysis.get("document_type")) or "unknown",
        template_name=template_name or None,
        confidence=analysis.get("confidence"),
        model_used=_preview_text(analysis.get("model")) or None,
        fallback_used=bool(analysis.get("fallback_model_used")),
        metadata=metadata,
        raw_evidence=_dict_or_empty(analysis.get("raw_evidence")),
        field_evidence=_list_or_empty(analysis.get("field_evidence")),
        normalized_sections=_dict_or_empty(analysis.get("normalized_sections")),
        preprocessing=_dict_or_empty(analysis.get("preprocessing")),
        structured_data=structured_data,
        raw_text=_preview_text(analysis.get("raw_text")) or None,
        review_flags=[_preview_text(flag) for flag in _list_or_empty(analysis.get("warnings")) if _preview_text(flag)],
        extracted_text=_preview_text(analysis.get("extracted_text")) or None,
        summary=_preview_text(analysis.get("summary")) or None,
        recommended_review_status=_preview_text(analysis.get("recommended_review_status")) or "PENDING",
        parser_version=_preview_text(analysis.get("parser_version")) or None,
        model=_preview_text(analysis.get("model")) or None,
    )


def _payload_shape(value: Any) -> str:
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "object"
    return "scalar"


def _extract_inbound_webhook_parts(body: Any) -> tuple[dict[str, Any], Any]:
    if isinstance(body, dict) and any(
        key in body for key in ("payload", "raw_payload", "analysis_payload", "ocr_payload")
    ):
        envelope = body
        raw_payload = (
            envelope.get("payload")
            or envelope.get("raw_payload")
            or envelope.get("analysis_payload")
            or envelope.get("ocr_payload")
        )
    else:
        envelope = {}
        raw_payload = body

    if raw_payload in (None, "", [], {}):
        raise _submission_error(
            status.HTTP_400_BAD_REQUEST,
            "INVALID_OCR_WEBHOOK_PAYLOAD",
            "OCR webhook payload is required.",
        )

    return envelope, raw_payload


def _template_hint_from_payload(payload: Any) -> str | None:
    if isinstance(payload, dict):
        return normalize_optional_text(
            payload.get("template_type")
            or payload.get("template_name")
            or payload.get("document_type")
            or payload.get("type")
        )
    if isinstance(payload, list) and payload:
        return _template_hint_from_payload(payload[0])
    return None


def _inbound_webhook_image_url(envelope: dict[str, Any], raw_payload: Any) -> str | None:
    image_urls = _inbound_webhook_image_urls(envelope, raw_payload)
    return image_urls[0] if image_urls else None


def _inbound_webhook_image_urls(envelope: dict[str, Any], raw_payload: Any) -> list[str]:
    if isinstance(raw_payload, dict):
        return _normalize_image_url_list(
            envelope.get("image_url"),
            envelope.get("image"),
            envelope.get("image_urls"),
            envelope.get("imageUrls"),
            raw_payload.get("image_url"),
            raw_payload.get("imageUrl"),
            raw_payload.get("image"),
            raw_payload.get("image_urls"),
            raw_payload.get("imageUrls"),
            raw_payload.get("source_documents"),
            raw_payload.get("sourceDocuments"),
            limit=MAX_OCR_SOURCE_IMAGES,
        )

    return _normalize_image_url_list(
        envelope.get("image_url"),
        envelope.get("image"),
        envelope.get("image_urls"),
        envelope.get("imageUrls"),
        limit=MAX_OCR_SOURCE_IMAGES,
    )


def _inbound_webhook_metadata(envelope: dict[str, Any]) -> dict[str, Any]:
    metadata = _dict_or_empty(envelope.get("metadata"))
    passthrough_fields = (
        "event_id",
        "event_name",
        "run_group_id",
        "run_group",
        "driver_id",
        "driver_name",
        "vehicle_id",
        "vehicle_text",
        "track",
        "session_type",
        "session_number",
    )
    for field_name in passthrough_fields:
        value = envelope.get(field_name)
        if value not in (None, "") and field_name not in metadata:
            metadata[field_name] = value
    return metadata


def _validate_inbound_webhook_secret(secret_header: str | None) -> None:
    configured_secret = normalize_optional_text(getattr(settings, "make_inbound_webhook_secret", None))
    if not configured_secret:
        raise _submission_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "OCR_WEBHOOK_DISABLED",
            "Inbound OCR webhook is disabled because the webhook secret is not configured.",
        )

    provided_secret = normalize_optional_text(secret_header)
    if not provided_secret or not secrets.compare_digest(provided_secret, configured_secret):
        raise _submission_error(
            status.HTTP_403_FORBIDDEN,
            "INVALID_WEBHOOK_SECRET",
            "Webhook secret is invalid.",
        )


def _normalize_submission_input_source(source_value: object) -> str:
    normalized_source = normalize_optional_text(source_value)
    if not normalized_source:
        return "make"

    normalized_key = normalized_source.strip().lower().replace("-", "_").replace(".", "_")
    aliases = {
        "make": "make",
        "make_http": "make",
        "make_webhook": "make",
        "make_com": "make",
        "api": "api",
        "pwa": "pwa",
        "admin": "admin",
        "offline_sync": "offline_sync",
        "photo": "photo",
    }
    return aliases.get(normalized_key, "make")


def _ocr_intake_snapshot_from_submission_row(
    db: Session,
    submission_row: Mapping[str, Any] | None,
    *,
    fallback_correlation_id: str | None = None,
) -> dict[str, Any] | None:
    if not submission_row:
        return None

    submission_input_id = int(submission_row["submission_id"])
    payload_snapshot = _json_dict_or_empty(submission_row.get("raw_payload_json"))
    metadata = dict(_dict_or_empty(payload_snapshot.get("metadata")))
    payload_body = _dict_or_empty(payload_snapshot.get("payload"))
    payload_context = _dict_or_empty(payload_body.get("context"))
    payload_data = _dict_or_empty(payload_snapshot.get("data"))

    passthrough_fields = (
        "event_id",
        "event_name",
        "run_group_id",
        "run_group",
        "driver_id",
        "vehicle_id",
        "track",
        "session_type",
        "session_number",
        "duration_min",
        "date",
        "time",
    )
    for field_name in passthrough_fields:
        if normalize_optional_text(metadata.get(field_name)) is not None:
            continue
        for source in (payload_snapshot, payload_context, payload_data):
            value = normalize_optional_text(source.get(field_name))
            if value is not None:
                metadata[field_name] = value
                break

    if normalize_optional_text(metadata.get("notes")) is None:
        note_value = normalize_optional_text(
            payload_context.get("notes")
            or payload_context.get("note")
            or payload_snapshot.get("notes")
            or payload_snapshot.get("note")
        )
        if note_value is not None:
            metadata["notes"] = note_value

    ocr_row = db.execute(
        text(
            """
            SELECT ocr_id, review_status, extracted_json
            FROM sm2racing.ocr_results
            WHERE submission_id = :submission_id
            ORDER BY created_at DESC, ocr_id DESC
            LIMIT 1
            """
        ),
        {"submission_id": submission_input_id},
    ).mappings().first()

    extracted_json = _json_dict_or_empty(ocr_row.get("extracted_json")) if ocr_row else {}
    normalized_analysis = _json_dict_or_empty(payload_snapshot.get("normalized_analysis"))
    if not normalized_analysis and extracted_json:
        normalized_analysis = extracted_json

    return {
        "submission_input_id": submission_input_id,
        "submission_ref": normalize_optional_text(payload_snapshot.get("submission_ref")),
        "correlation_id": normalize_optional_text(payload_snapshot.get("correlation_id")) or fallback_correlation_id,
        "source": normalize_optional_text(payload_snapshot.get("source")) or "make-webhook",
        "image_url": normalize_optional_text(payload_snapshot.get("image_url")),
        "image_urls": _normalize_image_url_list(
            payload_snapshot.get("image_urls"),
            payload_snapshot.get("image_url"),
            limit=MAX_OCR_SOURCE_IMAGES,
        ),
        "metadata": metadata,
        "raw_text": normalize_optional_text(payload_snapshot.get("raw_text")),
        "normalized_analysis": normalized_analysis,
        "created_at": submission_row.get("created_at"),
        "created_by": normalize_optional_text(submission_row.get("created_by")),
        "validation_status": normalize_optional_text(submission_row.get("validation_status")) or "PENDING",
        "validation_message": normalize_optional_text(submission_row.get("validation_message")),
        "ocr_id": int(ocr_row["ocr_id"]) if ocr_row and ocr_row.get("ocr_id") is not None else None,
        "review_status": normalize_optional_text(ocr_row.get("review_status")) if ocr_row else None,
        "template_type": normalize_optional_text(payload_snapshot.get("template_type")),
        "payload_shape": normalize_optional_text(payload_snapshot.get("payload_shape")) or _payload_shape(payload_snapshot.get("ocr_payload")),
    }


def _latest_ocr_intake_snapshot_by_correlation_id(
    db: Session,
    correlation_id: str,
) -> dict[str, Any] | None:
    normalized_correlation_id = normalize_optional_text(correlation_id)
    if not normalized_correlation_id:
        return None

    submission_row = db.execute(
        text(
            """
            SELECT submission_id, raw_payload_json, created_at, created_by, validation_status, validation_message
            FROM sm2racing.submission_inputs
            WHERE raw_payload_json ->> 'correlation_id' = :correlation_id
            ORDER BY submission_id DESC
            LIMIT 1
            """
        ),
        {"correlation_id": normalized_correlation_id},
    ).mappings().first()

    return _ocr_intake_snapshot_from_submission_row(
        db,
        submission_row,
        fallback_correlation_id=normalized_correlation_id,
    )


def _latest_ocr_intake_snapshot_by_event_id(
    db: Session,
    event_id: str,
) -> dict[str, Any] | None:
    normalized_event_id = normalize_optional_text(event_id)
    if not normalized_event_id:
        return None

    submission_row = db.execute(
        text(
            """
            SELECT submission_id, raw_payload_json, created_at, created_by, validation_status, validation_message
            FROM sm2racing.submission_inputs
            WHERE raw_payload_json -> 'metadata' ->> 'event_id' = :event_id
            ORDER BY submission_id DESC
            LIMIT 1
            """
        ),
        {"event_id": normalized_event_id},
    ).mappings().first()

    return _ocr_intake_snapshot_from_submission_row(db, submission_row)


def _list_ocr_intake_snapshots(
    db: Session,
    *,
    event_id: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    normalized_event_id = normalize_optional_text(event_id)
    normalized_limit = max(1, min(limit, 200))

    if normalized_event_id:
        rows = db.execute(
            text(
                """
                SELECT submission_id, raw_payload_json, created_at, created_by, validation_status, validation_message
                FROM sm2racing.submission_inputs
                WHERE source = 'make'
                  AND raw_payload_json -> 'metadata' ->> 'event_id' = :event_id
                ORDER BY submission_id DESC
                LIMIT :limit
                """
            ),
            {"event_id": normalized_event_id, "limit": normalized_limit},
        ).mappings().all()
    else:
        rows = db.execute(
            text(
                """
                SELECT submission_id, raw_payload_json, created_at, created_by, validation_status, validation_message
                FROM sm2racing.submission_inputs
                WHERE source = 'make'
                ORDER BY submission_id DESC
                LIMIT :limit
                """
            ),
            {"limit": normalized_limit},
        ).mappings().all()

    snapshots: list[dict[str, Any]] = []
    for row in rows:
        snapshot = _ocr_intake_snapshot_from_submission_row(db, row)
        if snapshot is not None:
            snapshots.append(snapshot)
    return snapshots


def _build_ocr_preview_from_snapshot(
    snapshot: dict[str, Any],
    *,
    default_message: str,
    source_fallback: str,
    event_id_override: str | None = None,
) -> OcrPreviewRead:
    normalized_analysis = _dict_or_empty(snapshot.get("normalized_analysis"))
    if not normalized_analysis:
        message = normalize_optional_text(snapshot.get("validation_message")) or default_message
        normalized_analysis = _build_ocr_failure_analysis(message)
        raw_text = normalize_optional_text(snapshot.get("raw_text"))
        if raw_text:
            normalized_analysis["raw_text"] = raw_text
            normalized_analysis["extracted_text"] = raw_text

    context = _dict_or_empty(snapshot.get("metadata"))
    if event_id_override:
        context = {**context, "event_id": event_id_override}
    snapshot_source = normalize_optional_text(snapshot.get("source"))
    preview_source = snapshot_source or source_fallback
    if (
        normalize_optional_text(normalized_analysis.get("status")) == "submitted_to_make"
        and snapshot_source
        and not snapshot_source.lower().startswith("make")
    ):
        preview_source = source_fallback

    return _build_ocr_preview_response(
        image_analysis=normalized_analysis,
        image_url=normalize_optional_text(snapshot.get("image_url")),
        image_urls=_normalize_image_url_list(
            snapshot.get("image_urls"),
            snapshot.get("image_url"),
            limit=MAX_OCR_SOURCE_IMAGES,
        ),
        context=context,
        event=None,
        run_group=None,
        driver=None,
        vehicle=None,
        submission_ref=normalize_optional_text(snapshot.get("submission_ref")),
        correlation_id=normalize_optional_text(snapshot.get("correlation_id")),
        source=preview_source,
    )


def _build_ocr_staged_draft_response(snapshot: dict[str, Any]) -> OcrStagedDraftRead:
    metadata = _dict_or_empty(snapshot.get("metadata"))
    normalized_analysis = _dict_or_empty(snapshot.get("normalized_analysis"))

    return OcrStagedDraftRead(
        submission_input_id=int(snapshot.get("submission_input_id")),
        ocr_id=snapshot.get("ocr_id"),
        submission_ref=normalize_optional_text(snapshot.get("submission_ref")) or None,
        correlation_id=normalize_optional_text(snapshot.get("correlation_id")) or None,
        source=normalize_optional_text(snapshot.get("source")) or None,
        image_url=normalize_optional_text(snapshot.get("image_url")) or None,
        image_urls=_normalize_image_url_list(
            snapshot.get("image_urls"),
            snapshot.get("image_url"),
            limit=MAX_OCR_SOURCE_IMAGES,
        ),
        raw_text=normalize_optional_text(snapshot.get("raw_text")) or None,
        created_at=snapshot.get("created_at"),
        created_by=normalize_optional_text(snapshot.get("created_by")) or None,
        validation_status=normalize_optional_text(snapshot.get("validation_status")) or "PENDING",
        validation_message=normalize_optional_text(snapshot.get("validation_message")) or None,
        review_status=normalize_optional_text(snapshot.get("review_status")) or None,
        template_type=normalize_optional_text(snapshot.get("template_type")) or None,
        payload_shape=normalize_optional_text(snapshot.get("payload_shape")) or "object",
        normalized=bool(normalized_analysis),
        confidence=normalized_analysis.get("confidence")
        if isinstance(normalized_analysis.get("confidence"), (int, float))
        else None,
        document_type=normalize_optional_text(normalized_analysis.get("document_type"))
        or normalize_optional_text(snapshot.get("template_type"))
        or None,
        event_id=normalize_optional_text(metadata.get("event_id")) or None,
        event_name=normalize_optional_text(metadata.get("event_name")) or None,
        run_group=normalize_optional_text(metadata.get("run_group")) or None,
        track=normalize_optional_text(metadata.get("track")) or None,
        session_type=normalize_optional_text(metadata.get("session_type")) or None,
        session_number=normalize_optional_text(metadata.get("session_number")) or None,
        driver_id=normalize_optional_text(metadata.get("driver_id")) or None,
        vehicle_id=normalize_optional_text(metadata.get("vehicle_id")) or None,
        metadata=metadata,
    )


def _build_submission_candidate(
    submission_in: SubmissionCreate,
    current_user: User,
    event: Event,
    run_group: RunGroup,
    driver: Driver | None,
    vehicle: Vehicle | None,
    correlation_id: str,
    voice_session: VoiceNoteSession | None = None,
) -> Submission:
    raw_text = normalize_optional_text(submission_in.raw_text)
    if raw_text is None and voice_session is not None:
        raw_text = (
            normalize_optional_text(voice_session.transcript_edited_text)
            or normalize_optional_text(voice_session.transcript_text)
        )
    image_url = normalize_optional_text(submission_in.image_url)
    analysis_result = merge_submission_analysis(
        submission_in.payload,
        raw_text,
        image_url,
        submission_in.analysis_result,
    )

    if voice_session is not None:
        analysis_result = {
            **analysis_result,
            "source_type": "voice",
            "has_voice_notes": True,
            "voice_input_used": True,
            "raw_input_mode": "voice",
            "voice_session_id": str(voice_session.id),
            "voice_session_status": (
                voice_session.status.value if hasattr(voice_session.status, "value") else voice_session.status
            ),
            "voice_transcript_confidence": voice_session.transcript_confidence,
            "voice_validation_status": voice_session.validation_status,
        }

    submission = Submission(
        submission_ref=submission_in.submission_ref,
        event_id=event.id,
        run_group_id=run_group.id,
        driver_id=driver.id if driver else None,
        vehicle_id=vehicle.id if vehicle else None,
        voice_session_id=voice_session.id if voice_session is not None else None,
        created_by_id=current_user.id,
        correlation_id=correlation_id,
        raw_text=raw_text,
        image_url=image_url,
        payload=submission_in.payload,
        analysis_result=analysis_result,
        structured_ingest_status="skipped",
        structured_ingest_warnings=[],
        status=SubmissionStatus.PENDING,
    )
    submission.event = event
    submission.run_group = run_group
    submission.driver = driver
    submission.vehicle = vehicle
    return submission


def _raw_request_user_label(user: User | None, fallback: str) -> str:
    if user is None:
        return fallback
    return normalize_optional_text(user.name) or normalize_optional_text(user.email) or fallback


def _resolve_raw_created_by_user(
    db: Session,
    *,
    created_by: str,
    current_user: User,
) -> User:
    normalized_created_by = normalize_optional_text(created_by)
    if not normalized_created_by:
        raise RawSubmissionValidationError(
            "created_by must exist",
            errors=[{"field": "created_by", "message": "created_by must exist"}],
        )

    matched_user = db.scalar(
        select(User).where(
            or_(
                func.lower(User.name) == normalized_created_by.lower(),
                func.lower(User.email) == normalized_created_by.lower(),
            )
        )
    )
    if matched_user is None:
        raise RawSubmissionValidationError(
            "created_by does not exist",
            errors=[{"field": "created_by", "message": "created_by does not exist"}],
        )

    if matched_user.id != current_user.id and current_user.role not in (UserRole.OWNER, UserRole.ADMIN):
        raise RawSubmissionValidationError(
            "created_by does not match the authenticated user",
            errors=[
                {
                    "field": "created_by",
                    "message": "created_by does not match the authenticated user",
                }
            ],
        )

    return matched_user


def _resolve_raw_event(db: Session, event_identifier: str) -> Event:
    normalized_identifier = normalize_optional_text(event_identifier)
    if not normalized_identifier:
        raise RawSubmissionValidationError(
            "eventId is required",
            errors=[{"field": "eventId", "message": "eventId is required"}],
        )

    event: Event | None = None
    try:
        event = db.get(Event, UUID(normalized_identifier))
    except ValueError:
        event = None

    if event is None:
        event = db.scalar(select(Event).where(func.lower(Event.name) == normalized_identifier.lower()))

    if event is None:
        raise RawSubmissionValidationError(
            "eventId was not found",
            errors=[{"field": "eventId", "message": "eventId was not found"}],
        )
    if not event.is_active:
        raise RawSubmissionValidationError(
            "event is archived",
            errors=[{"field": "eventId", "message": "event is archived"}],
        )

    return event


def _resolve_raw_run_group(
    db: Session,
    *,
    event: Event,
    requested_run_group: str,
) -> RunGroup:
    run_group = db.scalar(select(RunGroup).where(RunGroup.event_id == event.id))
    if run_group is None:
        raise RawSubmissionValidationError(
            "runGroup is not configured for this event",
            errors=[{"field": "runGroup", "message": "runGroup is not configured for this event"}],
        )

    normalized_requested_run_group = normalize_run_group(requested_run_group)
    if normalized_requested_run_group is None:
        raise RawSubmissionValidationError(
            "runGroup is invalid",
            errors=[{"field": "runGroup", "message": "runGroup is invalid"}],
        )

    if run_group.normalized != normalized_requested_run_group:
        raise RawSubmissionValidationError(
            "runGroup does not match the event run group",
            errors=[{"field": "runGroup", "message": "runGroup does not match the event run group"}],
        )

    return run_group


def _validate_raw_event_submission_window(event: Event) -> None:
    now = datetime.now(timezone.utc)
    event_start_date = _event_submission_start_to_utc(event)
    event_end_date = _event_submission_end_to_utc(event)
    if event_start_date is not None and now < event_start_date:
        raise RawSubmissionValidationError(
            "submission notes open when the event start date arrives",
            errors=[
                {
                    "field": "eventId",
                    "message": "submission notes open when the event start date arrives",
                }
            ],
        )
    if event_end_date is not None and now >= event_end_date:
        raise RawSubmissionValidationError(
            "submission notes close after the event end date passes",
            errors=[
                {
                    "field": "eventId",
                    "message": "submission notes close after the event end date passes",
                }
            ],
        )


def _raw_duplicate_lookup(
    db: Session,
    *,
    session_data: dict[str, object],
    raw_text: str,
) -> Seance | None:
    session_date = date.fromisoformat(str(session_data["date"]))
    session_time = time.fromisoformat(str(session_data["time"]))
    stmt = select(Seance).where(
        Seance.session_date == session_date,
        Seance.session_time == session_time,
        Seance.track == str(session_data["track"]),
        Seance.driver_id == str(session_data["driver_id"]),
        Seance.vehicle_id == str(session_data["vehicle_id"]),
        Seance.session_type == str(session_data["session_type"]),
        Seance.session_number == int(session_data["session_number"]),
        Seance.notes == raw_text,
    )
    return db.scalar(stmt)


def _raw_submission_response(
    *,
    status_code: int,
    status_value: str,
    message: str,
    id_seance: str | None = None,
    errors: list[dict[str, object]] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "status": status_value,
            "id_seance": id_seance,
            "message": message,
            "errors": errors or [],
        },
    )


def _finalize_delivery(
    db: Session,
    submission: Submission,
    *,
    submission_input_id: int | None = None,
    background_tasks: BackgroundTasks | None = None,
) -> Submission:
    if not settings.make_webhook_url:
        final_submission = process_submission_delivery(
            db,
            submission.id,
            submission_input_id=submission_input_id,
        )
        return final_submission or submission

    try:
        enqueue_submission_delivery(
            db,
            submission,
            submission_input_id=submission_input_id,
        )
        db.commit()
        db.refresh(submission)
    except Exception:
        db.rollback()
        if isinstance(submission.structured_ingest_warnings, list):
            submission.structured_ingest_warnings = [
                *submission.structured_ingest_warnings,
                {
                    "section": "delivery",
                    "code": "MAKE_WEBHOOK_ENQUEUE_FAILED",
                    "message": "The note was saved, but Make.com delivery queueing failed. Review backend delivery logs before relying on webhook delivery.",
                },
            ]
        logger.exception(
            "Submission delivery enqueue failed after canonical submission save (%s)",
            _submission_log_summary(
                submission_ref=submission.submission_ref,
                correlation_id=submission.correlation_id,
                event_id=submission.event_id,
                run_group_id=submission.run_group_id,
                driver_id=getattr(submission.driver, "driver_id", None),
                vehicle_id=getattr(submission.vehicle, "vehicle_id", None),
                current_user_id=submission.created_by_id,
                payload=submission.payload,
            ),
        )
        return submission

    if background_tasks is not None:
        background_tasks.add_task(
            process_submission_delivery_task,
            submission.id,
            submission_input_id=submission_input_id,
        )

    return submission


@router.get("", response_model=list[SubmissionRead])
def list_submissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Submission]:
    stmt = _submission_stmt()
    if current_user.role not in (UserRole.OWNER, UserRole.ADMIN):
        stmt = stmt.where(Submission.created_by_id == current_user.id)
    return list(db.scalars(stmt).unique().all())


@router.get("/event/{event_id}", response_model=list[SubmissionRead])
def list_submissions_by_event(
    event_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Submission]:
    event = db.scalar(select(Event).options(joinedload(Event.run_group)).where(Event.id == event_id))
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    stmt = _submission_stmt().where(Submission.event_id == event_id)
    if event.run_group:
        stmt = stmt.where(Submission.run_group_id == event.run_group.id)
    if current_user.role not in (UserRole.OWNER, UserRole.ADMIN):
        stmt = stmt.where(Submission.created_by_id == current_user.id)
    return list(db.scalars(stmt).unique().all())


@router.get("/user/{user_id}", response_model=list[SubmissionRead])
def list_submissions_by_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Submission]:
    if current_user.role not in (UserRole.OWNER, UserRole.ADMIN) and current_user.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    stmt = _submission_stmt().where(Submission.created_by_id == user_id)
    return list(db.scalars(stmt).unique().all())


@router.post("/ocr-intake", response_model=OcrWebhookIngestRead, status_code=status.HTTP_201_CREATED)
def ingest_ocr_webhook_payload(
    body: Any = Body(...),
    x_sm2_webhook_secret: str | None = Header(default=None, alias="X-SM2-Webhook-Secret"),
    db: Session = Depends(get_db),
) -> OcrWebhookIngestRead:
    _validate_inbound_webhook_secret(x_sm2_webhook_secret)

    envelope, raw_payload = _extract_inbound_webhook_parts(body)
    normalized_analysis = extract_normalized_inbound_analysis(raw_payload)
    payload_shape = _payload_shape(raw_payload)
    image_url = _inbound_webhook_image_url(envelope, raw_payload)
    image_urls = _inbound_webhook_image_urls(envelope, raw_payload)
    metadata = _inbound_webhook_metadata(envelope)
    source = (normalize_optional_text(envelope.get("source")) or "make-webhook")[:32]
    submission_input_source = _normalize_submission_input_source(source)
    created_by = (normalize_optional_text(envelope.get("created_by")) or "make-webhook")[:255]
    submission_ref = (normalize_optional_text(envelope.get("submission_ref")) or f"MAKE-OCR-{uuid4().hex[:12]}")[:120]
    correlation_id = (normalize_optional_text(envelope.get("correlation_id")) or str(uuid4()))[:36]
    raw_text = (
        normalize_optional_text(envelope.get("raw_text"))
        or (normalize_optional_text(raw_payload) if isinstance(raw_payload, str) else None)
        or (
            normalize_optional_text(normalized_analysis.get("raw_text"))
            if normalized_analysis is not None
            else None
        )
    )
    template_type = (
        normalize_optional_text(envelope.get("template_type"))
        or (
            normalize_optional_text(normalized_analysis.get("document_type"))
            if normalized_analysis is not None
            else None
        )
        or _template_hint_from_payload(raw_payload)
    )
    review_status = (
        normalize_optional_text(normalized_analysis.get("recommended_review_status"))
        if normalized_analysis is not None
        else None
    ) or "PENDING"
    parser_version = (
        normalize_optional_text(normalized_analysis.get("parser_version"))
        if normalized_analysis is not None
        else None
    )
    confidence = (
        normalized_analysis.get("confidence")
        if normalized_analysis is not None and isinstance(normalized_analysis.get("confidence"), (int, float))
        else None
    )

    payload_snapshot = {
        "submission_ref": submission_ref,
        "correlation_id": correlation_id,
        "source": source,
        "template_type": template_type,
        "payload_shape": payload_shape,
        "image_url": image_url,
        "image_urls": image_urls,
        "raw_text": raw_text,
        "metadata": metadata,
        "ocr_payload": raw_payload,
        "normalized_analysis": normalized_analysis,
        "received_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        submission_input_id = _insert_submission_input(
            db,
            id_seance=None,
            submission_type="detail",
            source=submission_input_source,
            raw_text=raw_text,
            raw_payload=payload_snapshot,
            confidence=confidence,
            created_by=created_by,
            validation_status="PENDING",
            validation_message=(
                "Normalized OCR payload staged for review."
                if normalized_analysis is not None
                else "Raw OCR payload stored without a recognized template mapping."
            ),
        )
        if image_url:
            _insert_media_file(
                db,
                submission_id=submission_input_id,
                submission_ref=submission_ref,
                image_url=image_url,
                uploaded_by=created_by,
            )

        ocr_id = None
        if normalized_analysis is not None:
            ocr_id = _insert_ocr_result(
                db,
                submission_input_id=submission_input_id,
                raw_ocr_text=raw_text,
                cleaned_ocr_text=raw_text,
                extracted_json=normalized_analysis,
                ocr_confidence=confidence,
                parser_version=parser_version,
                review_status=review_status,
            )

        _write_audit_log(
            db,
            action="submission.stage.ocr_webhook",
            status="SUCCESS",
            message=f"Stored inbound OCR webhook payload {submission_ref}",
            payload={
                "submission_ref": submission_ref,
                "correlation_id": correlation_id,
                "submission_input_id": submission_input_id,
                "ocr_id": ocr_id,
                "source": source,
                "template_type": template_type,
                "payload_shape": payload_shape,
                "normalized": normalized_analysis is not None,
            },
            user=created_by,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Inbound OCR webhook storage failed: submission_ref=%s source=%s", submission_ref, source)
        raise _submission_error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "OCR_WEBHOOK_STORE_FAILED",
            "Inbound OCR webhook payload could not be stored.",
            detail={"error": str(exc)},
        )

    return OcrWebhookIngestRead(
        status="success",
        message=(
            "OCR payload stored and normalized for review."
            if normalized_analysis is not None
            else "OCR payload stored as raw JSON. No template mapping was recognized yet."
        ),
        submission_input_id=submission_input_id,
        ocr_id=ocr_id,
        submission_ref=submission_ref,
        correlation_id=correlation_id,
        source=source,
        payload_shape=payload_shape,
        template_type=template_type,
        normalized=normalized_analysis is not None,
        review_status=review_status,
    )


@router.get("/ocr-preview/{correlation_id}", response_model=OcrPreviewRead)
def get_ocr_preview_status(
    correlation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OcrPreviewRead:
    snapshot = _latest_ocr_intake_snapshot_by_correlation_id(db, correlation_id)
    normalized_correlation_id = normalize_optional_text(correlation_id) or correlation_id

    if snapshot is None:
        return _build_ocr_preview_response(
            image_analysis=_build_ocr_waiting_analysis(),
            image_url=None,
            image_urls=[],
            context={},
            event=None,
            run_group=None,
            driver=None,
            vehicle=None,
            correlation_id=normalized_correlation_id,
            source="make.com",
        )

    preview = _build_ocr_preview_from_snapshot(
        snapshot,
        default_message="Make.com callback arrived, but no recognized OCR draft was stored.",
        source_fallback="make.com",
    )
    if not preview.correlation_id:
        preview.correlation_id = normalized_correlation_id
    return preview


@router.get("/ocr-preview/latest/event/{event_id}", response_model=OcrPreviewRead)
def get_latest_ocr_preview_for_event(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OcrPreviewRead:
    snapshot = _latest_ocr_intake_snapshot_by_event_id(db, event_id)
    normalized_event_id = normalize_optional_text(event_id) or event_id

    if snapshot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No staged OCR draft found for this event",
        )

    return _build_ocr_preview_from_snapshot(
        snapshot,
        default_message="Make.com callback arrived, but no recognized OCR draft was stored.",
        source_fallback="make.com",
        event_id_override=normalized_event_id,
    )


@router.get("/ocr-intake", response_model=list[OcrStagedDraftRead])
def list_ocr_intake_drafts(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> list[OcrStagedDraftRead]:
    snapshots = _list_ocr_intake_snapshots(db)
    return [_build_ocr_staged_draft_response(snapshot) for snapshot in snapshots]


@router.get("/ocr-intake/event/{event_id}", response_model=list[OcrStagedDraftRead])
def list_ocr_intake_drafts_by_event(
    event_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[OcrStagedDraftRead]:
    snapshots = _list_ocr_intake_snapshots(db, event_id=str(event_id))
    return [_build_ocr_staged_draft_response(snapshot) for snapshot in snapshots]


@router.post("/ocr-preview", response_model=OcrPreviewRead)
def preview_ocr_submission(
    preview_in: OcrPreviewCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OcrPreviewRead | JSONResponse:
    preview_image_urls = _normalize_image_url_list(
        preview_in.image_url,
        preview_in.image_urls,
        limit=None,
    )
    logger.info(
        "OCR preview endpoint called: event_id=%s run_group_id=%s image_count=%s context_keys=%s",
        preview_in.event_id,
        preview_in.run_group_id,
        len(preview_image_urls),
        sorted(_dict_or_empty(preview_in.context).keys()),
    )
    if not preview_image_urls:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one OCR source image is required",
        )
    if len(preview_image_urls) > MAX_OCR_SOURCE_IMAGES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"OCR preview supports up to {MAX_OCR_SOURCE_IMAGES} source images",
        )

    ocr_config = get_ocr_config_status(settings)
    if ocr_config["missing_requirements"]:
        logger.warning(ocr_config["developer_message"])
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "error": "OCR_EXTRACTION_DISABLED",
                "message": ocr_config["user_safe_message"],
                "missing_requirements": ocr_config["missing_requirements"],
            },
        )

    event = db.get(Event, preview_in.event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if not event.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Event is archived")

    now = datetime.now(timezone.utc)
    event_start_date = _event_submission_start_to_utc(event)
    event_end_date = _event_submission_end_to_utc(event)
    if event_start_date is not None and now < event_start_date:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Submission notes open when the event start date arrives",
        )
    if event_end_date is not None and now >= event_end_date:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Submission notes close after the event end date passes",
        )

    run_group = db.get(RunGroup, preview_in.run_group_id)
    if not run_group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run group not found")
    if run_group.event_id != preview_in.event_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Run group does not belong to the event")

    driver, vehicle = _validate_ocr_preview_relations(db, preview_in)

    preview_submission = Submission(
        submission_ref=f"OCR-PREVIEW-{uuid4().hex[:8]}",
        event_id=event.id,
        run_group_id=run_group.id,
        driver_id=driver.id if driver else None,
        vehicle_id=vehicle.id if vehicle else None,
        created_by_id=current_user.id,
        correlation_id=str(uuid4()),
        raw_text=normalize_optional_text(preview_in.raw_text),
        image_url=preview_image_urls[0],
        payload={
            "context": preview_in.context,
            "image_urls": preview_image_urls,
        },
        analysis_result={"ocr_preview": True, "force_review_staging": True},
        structured_ingest_status="skipped",
        structured_ingest_warnings=[],
        status=SubmissionStatus.PENDING,
    )

    try:
        image_analysis = analyze_submission_image(
            submission=preview_submission,
            event=event,
            run_group=run_group,
            driver=driver,
            vehicle=vehicle,
        )
    except Exception as exc:
        logger.exception("OCR preview processing failed unexpectedly")
        image_analysis = _build_ocr_failure_analysis(
            "OCR extraction failed before a safe draft could be created. Retry with a clearer image or use manual correction."
        )
        image_analysis["warnings"] = [
            "OCR processing raised a backend exception",
            "Manual review required",
        ]
        image_analysis["message"] = (
            "OCR extraction failed before a safe draft could be created. Retry with a clearer image or use manual correction."
        )

    if not image_analysis:
        logger.warning("OCR preview finished without any normalized result; returning extraction_failed response")
        image_analysis = _build_ocr_failure_analysis(
            "OCR extraction failed before a safe draft could be created. Retry with a clearer image or use manual correction."
        )

    logger.info(
        "OCR preview returning: status=%s doc_type=%s confidence=%s",
        image_analysis.get("status") or "success",
        image_analysis.get("document_type") or "unknown",
        image_analysis.get("confidence"),
    )

    analysis_status = normalize_optional_text(image_analysis.get("status")) or "success"
    if analysis_status == "submitted_to_make":
        preview_submission.analysis_result = {
            **(preview_submission.analysis_result or {}),
            "has_image_analysis": True,
            "image_analysis_review_status": image_analysis.get("recommended_review_status") or "PENDING",
            "image_analysis": image_analysis,
        }
        try:
            stage_submission_input(
                db,
                submission=preview_submission,
                event=event,
                run_group=run_group,
                driver=driver,
                vehicle=vehicle,
                current_user=current_user,
                source="pwa",
            )
            commit = getattr(db, "commit", None)
            if callable(commit):
                commit()
        except Exception:
            rollback = getattr(db, "rollback", None)
            if callable(rollback):
                rollback()
            logger.warning(
                "OCR preview staging failed while waiting for Make callback (correlation_id=%s)",
                preview_submission.correlation_id,
                exc_info=True,
            )

    return _build_ocr_preview_response(
        image_analysis=image_analysis,
        image_url=preview_image_urls[0],
        image_urls=preview_image_urls,
        context=preview_in.context,
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        submission_ref=preview_submission.submission_ref,
        correlation_id=preview_submission.correlation_id,
        source="make.com",
    )


@router.post("", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
def create_submission(
    submission_in: SubmissionCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Submission:
    voice_session = None
    event = db.get(Event, submission_in.event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if not event.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Event is archived")
    now = datetime.now(timezone.utc)
    event_start_date = _event_submission_start_to_utc(event)
    event_end_date = _event_submission_end_to_utc(event)
    if event_start_date is not None and now < event_start_date:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Submission notes open when the event start date arrives",
        )
    if event_end_date is not None and now >= event_end_date:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Submission notes close after the event end date passes",
        )

    run_group = db.get(RunGroup, submission_in.run_group_id)
    if not run_group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run group not found")
    if run_group.event_id != submission_in.event_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Run group does not belong to the event")

    driver, vehicle = _validate_submission_relations(db, submission_in)

    if submission_in.voice_session_id is not None:
        voice_session = get_voice_session_for_user(
            db,
            submission_in.voice_session_id,
            current_user=current_user,
            load_attempts=True,
        )
        if voice_session.event_id != submission_in.event_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Voice session does not belong to the event")
        if voice_session.run_group_id != submission_in.run_group_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Voice session does not belong to the run group")
        if voice_session.status == VoiceNoteStatus.ARCHIVED:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Voice session is archived")
        if voice_session.status == VoiceNoteStatus.SUBMITTED or voice_session.submission_id is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Voice session is already linked to a submission")
        if voice_session.status == VoiceNoteStatus.TRANSCRIPTION_FAILED:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Voice transcription failed and cannot be submitted")
        if not normalize_optional_text(submission_in.raw_text):
            submission_in = submission_in.model_copy(
                update={
                    "raw_text": (
                        normalize_optional_text(voice_session.transcript_edited_text)
                        or normalize_optional_text(voice_session.transcript_text)
                    )
                }
            )
        if not normalize_optional_text(submission_in.raw_text):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Voice transcript is empty")

    submission_image_urls = _normalize_image_url_list(
        submission_in.image_url,
        submission_in.image_urls,
        limit=None,
    )
    if len(submission_image_urls) > MAX_OCR_SOURCE_IMAGES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"OCR review supports up to {MAX_OCR_SOURCE_IMAGES} source images",
        )

    submission_ref = _ensure_unique_submission_ref(db, submission_in.submission_ref)
    correlation_id = _ensure_unique_correlation_id(db, submission_in.correlation_id)
    submission_input = submission_in.model_copy(
        update={
            "submission_ref": submission_ref,
            "correlation_id": correlation_id,
            "image_url": submission_image_urls[0] if submission_image_urls else None,
            "image_urls": submission_image_urls,
            "payload": _merge_payload_image_urls(submission_in.payload, submission_image_urls),
        }
    )
    submission_log_summary = _submission_log_summary(
        submission_ref=submission_ref,
        correlation_id=correlation_id,
        event_id=submission_input.event_id,
        run_group_id=submission_input.run_group_id,
        driver_id=submission_input.driver_id,
        vehicle_id=submission_input.vehicle_id,
        current_user_id=current_user.id,
        payload=submission_input.payload,
    )

    submission = _build_submission_candidate(
        submission_input,
        current_user,
        event,
        run_group,
        driver,
        vehicle,
        correlation_id,
        voice_session=voice_session,
    )

    db.add(submission)
    submission_input_id = None
    try:
        db.flush()

        if should_persist_structured_submission(submission.analysis_result):
            try:
                structured_result = persist_structured_submission(
                    db,
                    submission=submission,
                    event=event,
                    run_group=run_group,
                    driver=driver,
                    vehicle=vehicle,
                    current_user=current_user,
                )
                submission_input_id = structured_result.submission_input_id
                submission.structured_ingest_status = structured_result.status
                submission.structured_ingest_warnings = structured_result.warnings
            except Exception:
                submission_input_id = None
                submission.structured_ingest_status = "skipped"
                submission.structured_ingest_warnings = [
                    {
                        "section": "structured_ingest",
                        "code": "STRUCTURED_INGEST_FAILED",
                        "message": "Structured normalization failed unexpectedly. The canonical note was still saved.",
                    }
                ]
                logger.exception(
                    "Structured submission persistence failed; continuing with raw submission only (%s)",
                    submission_log_summary,
                )
        else:
            submission.structured_ingest_status = "skipped"
            submission.structured_ingest_warnings = []

        if voice_session is not None:
            now = datetime.now(timezone.utc)
            voice_session.transcript_edited_text = normalize_optional_text(submission.raw_text)
            if not voice_session.transcript_text:
                voice_session.transcript_text = normalize_optional_text(submission.raw_text)
            voice_session.confirmed_at = voice_session.confirmed_at or now
            voice_session.submitted_at = now
            voice_session.status = VoiceNoteStatus.SUBMITTED
            voice_session.validation_status = "VALIDATED"
            voice_session.validation_message = "Transcript confirmed and submission created."
            voice_session.submission = submission
            voice_session.submission_id = submission.id
            db.add(voice_session)

        if submission.image_url and submission_input_id is None:
            try:
                image_analysis = _precomputed_image_analysis(submission.analysis_result)
                if image_analysis is None:
                    image_analysis = analyze_submission_image(
                        submission=submission,
                        event=event,
                        run_group=run_group,
                        driver=driver,
                        vehicle=vehicle,
                    )
                if image_analysis:
                    submission.analysis_result = {
                        **(submission.analysis_result or {}),
                        "has_image_analysis": True,
                        "image_analysis_review_status": image_analysis.get("recommended_review_status") or "PENDING",
                        "image_analysis": image_analysis,
                    }
                submission_input_id = stage_submission_input(
                    db,
                    submission=submission,
                    event=event,
                    run_group=run_group,
                    driver=driver,
                    vehicle=vehicle,
                    current_user=current_user,
                    source="photo",
                )
                record_image_analysis_result(
                    db,
                    submission_input_id=submission_input_id,
                    image_analysis=image_analysis,
                )
                submission.structured_ingest_status = "pending_review"
                submission.structured_ingest_warnings = [
                    *submission.structured_ingest_warnings,
                    {
                        "section": "image_analysis",
                        "code": "IMAGE_STAGED_FOR_REVIEW",
                        "message": "Image input was staged for review before any structured event/session/setup data is applied.",
                    },
                ]
            except Exception:
                logger.exception(
                    "Image submission staging failed; continuing with canonical submission only (%s)",
                    submission_log_summary,
                )
                submission.structured_ingest_warnings = [
                    *submission.structured_ingest_warnings,
                    {
                        "section": "image_analysis",
                        "code": "IMAGE_STAGE_FAILED",
                        "message": "Image analysis or staging failed unexpectedly. The canonical submission was still saved.",
                    },
                ]

        delivery_enqueue_available = True
        if settings.make_webhook_url:
            try:
                enqueue_submission_delivery(
                    db,
                    submission,
                    submission_input_id=submission_input_id,
                )
            except Exception:
                delivery_enqueue_available = False
                submission.structured_ingest_warnings = [
                    *submission.structured_ingest_warnings,
                    {
                        "section": "delivery",
                        "code": "MAKE_WEBHOOK_ENQUEUE_FAILED",
                        "message": "The note was saved, but Make.com delivery queueing failed. Review backend delivery logs before relying on webhook delivery.",
                    },
                ]
                logger.exception(
                    "Submission delivery enqueue failed; continuing with canonical submission only (%s)",
                    submission_log_summary,
                )

        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if not _is_integrity_duplicate_error(exc):
            logger.exception(
                "Unexpected submission integrity error while saving (%s)",
                submission_log_summary,
            )
            raise _submission_error(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "SUBMISSION_SAVE_FAILED",
                "Failed to save submission",
            ) from exc

        logger.warning(
            "Submission duplicate integrity conflict while saving (%s)",
            submission_log_summary,
        )
        raise _submission_error(
            status.HTTP_409_CONFLICT,
            "SUBMISSION_DUPLICATE",
            "Submission already exists or conflicts with an existing session",
        ) from exc
    except HTTPException as exc:
        db.rollback()
        logger.warning(
            "Submission rejected after entering save pipeline (%s): %s",
            submission_log_summary,
            getattr(exc, "detail", exc),
        )
        raise
    except Exception as exc:
        db.rollback()
        logger.exception(
            "Unexpected submission save failure (%s)",
            submission_log_summary,
        )
        raise _submission_error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "SUBMISSION_SAVE_FAILED",
            "Failed to save submission",
        ) from exc

    db.refresh(submission)

    loaded_submission = _load_submission(db, submission.id)
    if loaded_submission is None:
        logger.error(
            "Submission saved but failed to reload from database (%s)",
            submission_log_summary,
        )
        raise _submission_error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "SUBMISSION_LOAD_FAILED",
            "Failed to load submission",
        )

    if settings.make_webhook_url:
        if delivery_enqueue_available:
            background_tasks.add_task(
                process_submission_delivery_task,
                loaded_submission.id,
                submission_input_id=submission_input_id,
            )
        return loaded_submission

    return _finalize_delivery(
        db,
        loaded_submission,
        submission_input_id=submission_input_id,
    )


@router.post("/raw", response_model=RawSubmissionResult, status_code=status.HTTP_201_CREATED)
def create_raw_submission(
    submission_in: RawSubmissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JSONResponse:
    request_payload = submission_in.model_dump(by_alias=True)
    request_user_label = submission_in.created_by
    parser_mode = "deterministic"

    try:
        created_by_user = _resolve_raw_created_by_user(
            db,
            created_by=submission_in.created_by,
            current_user=current_user,
        )
        request_user_label = _raw_request_user_label(created_by_user, submission_in.created_by)

        event = _resolve_raw_event(db, submission_in.event_id)
        _validate_raw_event_submission_window(event)
        run_group = _resolve_raw_run_group(
            db,
            event=event,
            requested_run_group=submission_in.run_group,
        )

        # Parse the shorthand note into deterministic structured session data first.
        try:
            parsed_note = parse_raw_note(submission_in.raw_text)
        except RawSubmissionValidationError as parse_error:
            # Keep OpenAI as a backend-only fallback for notes the deterministic parser cannot read.
            fallback_result = extract_raw_note_via_openai(submission_in.raw_text)
            if fallback_result is None:
                raise parse_error
            parsed_note = fallback_result.parsed_note
            parser_mode = "openai"
            submission_confidence = fallback_result.confidence
            logger.info(
                "Raw submission parse used OpenAI fallback: event_id=%s session_number=%s",
                submission_in.event_id,
                parsed_note.session_number,
            )
        else:
            submission_confidence = submission_in.confidence

        driver = resolve_driver_alias(
            db.scalars(select(Driver).where(Driver.is_active.is_(True))).all(),
            parsed_note.driver_alias,
        )
        vehicle = resolve_vehicle_alias(
            db.scalars(
                select(Vehicle).where(
                    Vehicle.is_active.is_(True),
                    Vehicle.driver_id == driver.driver_id,
                )
            ).all(),
            parsed_note.vehicle_alias,
        )

        captured_at = datetime.now(timezone.utc)
        payload, analysis_result, id_seance = build_raw_submission_payload(
            parsed_note,
            driver_id=driver.driver_id,
            vehicle_id=vehicle.vehicle_id,
            track=event.track,
            run_group=run_group.normalized.value,
            created_by=request_user_label,
            captured_at=captured_at,
            confidence=submission_confidence,
        )

        # Validate the backend-owned structured payload before any database write.
        validation_errors = validate_raw_submission_payload(
            created_by=request_user_label,
            raw_text=submission_in.raw_text,
            payload=payload,
            analysis_result=analysis_result,
        )
        if vehicle.driver_id != driver.driver_id:
            validation_errors.append(
                {"field": "vehicle_id", "message": "vehicle_id does not belong to driver_id"}
            )
        if validation_errors:
            raise RawSubmissionValidationError(
                validation_errors[0]["message"],
                errors=validation_errors,
            )

        duplicate_session_id = lookup_raw_duplicate_current_schema(
            db,
            id_seance=id_seance,
            raw_text=submission_in.raw_text,
        )
        if duplicate_session_id is not None:
            write_raw_audit_log_current_schema(
                db,
                action="submission.ingest.raw",
                status="SUCCESS",
                entity_type="seance",
                entity_id=duplicate_session_id,
                message=f"Duplicate raw submission ignored for {duplicate_session_id}",
                payload={
                    **request_payload,
                    "parser_mode": parser_mode,
                    "id_seance": duplicate_session_id,
                    "duplicate": True,
                },
                actor_user_id=current_user.id,
                correlation_id=None,
            )
            db.commit()
            return _raw_submission_response(
                status_code=status.HTTP_200_OK,
                status_value="SUCCESS",
                id_seance=duplicate_session_id,
                message="Duplicate session ignored",
            )

        submission_ref = _ensure_unique_submission_ref(db, f"RAW-{id_seance}")
        correlation_id = _ensure_unique_correlation_id(db, str(uuid4()))
        submission_payload = SubmissionCreate(
            submission_ref=submission_ref,
            correlation_id=correlation_id,
            event_id=event.id,
            run_group_id=run_group.id,
            driver_id=driver.driver_id,
            vehicle_id=vehicle.vehicle_id,
            raw_text=submission_in.raw_text,
            payload=payload,
            analysis_result=analysis_result,
        )
        raw_submission = _build_submission_candidate(
            submission_payload,
            created_by_user,
            event,
            run_group,
            driver,
            vehicle,
            correlation_id,
        )

        db.add(raw_submission)
        db.flush()

        # Persist the normalized raw submission against the current sm2racing schema.
        persist_result = persist_raw_submission_current_schema(
            db,
            submission=raw_submission,
            event=event,
            run_group=run_group,
            driver=driver,
            vehicle=vehicle,
            current_user=created_by_user,
            source=(normalize_optional_text(submission_in.source) or "pwa").lower(),
            payload=payload,
            analysis_result=analysis_result,
            id_seance=id_seance,
            captured_at=captured_at,
        )
        raw_submission.structured_ingest_status = persist_result.status
        raw_submission.structured_ingest_warnings = persist_result.warnings
        raw_submission.status = SubmissionStatus.SENT
        raw_submission.error_message = None

        if not persist_result.saved_sections:
            raise RuntimeError("Raw submission did not persist any structured sections")

        stored_session_id = persist_result.id_seance or id_seance

        write_raw_audit_log_current_schema(
            db,
            action="submission.ingest.raw",
            status="SUCCESS",
            entity_type="seance",
            entity_id=stored_session_id,
            message=f"Raw submission stored successfully for {stored_session_id}",
            payload={
                **request_payload,
                "parser_mode": parser_mode,
                "submission_ref": raw_submission.submission_ref,
                "correlation_id": raw_submission.correlation_id,
                "id_seance": stored_session_id,
                "submission_input_id": str(persist_result.submission_input_id) if persist_result.submission_input_id else None,
                "seance_db_id": str(persist_result.seance_id) if persist_result.seance_id else None,
                "structured_status": persist_result.status,
                "structured_warnings": persist_result.warnings,
                "saved_sections": persist_result.saved_sections,
                "skipped_sections": persist_result.skipped_sections,
            },
            actor_user_id=current_user.id,
            correlation_id=raw_submission.correlation_id,
        )
        db.commit()

        return _raw_submission_response(
            status_code=status.HTTP_201_CREATED,
            status_value="SUCCESS",
            id_seance=stored_session_id,
            message="Session stored successfully",
        )
    except HTTPException:
        db.rollback()
        raise
    except RawSubmissionValidationError as exc:
        db.rollback()
        write_raw_audit_log_current_schema(
            db,
            action="submission.ingest.raw",
            status="VALIDATION_FAILED",
            entity_type="submission",
            entity_id=str(request_payload.get("raw_text") or submission_in.event_id),
            message=exc.message,
            payload={
                **request_payload,
                "parser_mode": parser_mode,
                "errors": exc.errors,
            },
            actor_user_id=current_user.id,
            correlation_id=None,
        )
        db.commit()
        return _raw_submission_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            status_value="VALIDATION_FAILED",
            message=exc.message,
            errors=exc.errors,
        )
    except Exception as exc:
        db.rollback()
        error_context = describe_raw_exception(exc)
        unexpected_message = (
            f"Raw submission ingest failed unexpectedly: {error_context['display_message']}"
        )
        logger.exception("Raw submission ingest failed (%s)", error_context["display_message"])
        write_raw_audit_log_current_schema(
            db,
            action="submission.ingest.raw",
            status="ERROR",
            entity_type="submission",
            entity_id=str(request_payload.get("raw_text") or submission_in.event_id),
            message=unexpected_message,
            payload={
                **request_payload,
                "parser_mode": parser_mode,
                **error_context,
            },
            actor_user_id=current_user.id,
            correlation_id=None,
        )
        db.commit()
        return _raw_submission_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            status_value="ERROR",
            message=unexpected_message,
            errors=[{"field": "raw_text", "message": unexpected_message, **error_context}],
        )


@router.get("/{submission_id}", response_model=SubmissionRead)
def read_submission(
    submission_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Submission:
    submission = _load_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    if current_user.role not in (UserRole.OWNER, UserRole.ADMIN) and submission.created_by_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return submission


@router.post("/{submission_id}/retry", response_model=SubmissionRead)
def retry_submission(
    submission_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> Submission:
    submission = _load_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    retry_log_summary = _submission_log_summary(
        submission_ref=submission.submission_ref,
        correlation_id=submission.correlation_id,
        event_id=submission.event_id,
        run_group_id=submission.run_group_id,
        driver_id=getattr(submission.driver, "driver_id", None),
        vehicle_id=getattr(submission.vehicle, "vehicle_id", None),
        current_user_id=current_user.id,
        payload=submission.payload,
    )

    submission.status = SubmissionStatus.PENDING
    submission.error_message = None
    try:
        db.add(submission)
        if settings.make_webhook_url:
            enqueue_submission_delivery(db, submission)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if not _is_integrity_duplicate_error(exc):
            logger.exception(
                "Unexpected submission integrity error while retrying (%s)",
                retry_log_summary,
            )
            raise _submission_error(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "SUBMISSION_RETRY_FAILED",
                "Failed to retry submission",
            ) from exc

        logger.warning(
            "Submission duplicate integrity conflict while retrying (%s)",
            retry_log_summary,
        )
        raise _submission_error(
            status.HTTP_409_CONFLICT,
            "SUBMISSION_DUPLICATE",
            "Submission already exists or conflicts with an existing session",
        ) from exc
    except HTTPException as exc:
        db.rollback()
        logger.warning(
            "Submission retry rejected after entering save pipeline (%s): %s",
            retry_log_summary,
            getattr(exc, "detail", exc),
        )
        raise
    except Exception as exc:
        db.rollback()
        logger.exception(
            "Unexpected submission retry failure (%s)",
            retry_log_summary,
        )
        raise _submission_error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "SUBMISSION_RETRY_FAILED",
            "Failed to retry submission",
        ) from exc

    db.refresh(submission)

    if settings.make_webhook_url:
        background_tasks.add_task(process_submission_delivery_task, submission.id)
    else:
        process_submission_delivery(db, submission.id)

    return _load_submission(db, submission_id) or submission


@router.put("/{submission_id}", response_model=SubmissionRead)
def update_submission(
    submission_id: UUID,
    submission_in: SubmissionUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Submission:
    submission = _load_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    if current_user.role not in (UserRole.OWNER, UserRole.ADMIN) and submission.created_by_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    update_data = submission_in.model_dump(exclude_unset=True)
    driver = submission.driver
    vehicle = submission.vehicle
    driver_code = normalize_optional_text(submission_in.driver_id)
    vehicle_code = normalize_optional_text(submission_in.vehicle_id)
    if driver_code or vehicle_code:
        driver, vehicle = _validate_submission_update_relations(db, submission_in)
        if driver is not None:
            update_data["driver_id"] = driver.id
        if vehicle is not None:
            update_data["vehicle_id"] = vehicle.id
    else:
        update_data.pop("driver_id", None)
        update_data.pop("vehicle_id", None)

    previous_state = {
        "driver_id": str(submission.driver_id) if submission.driver_id else None,
        "vehicle_id": str(submission.vehicle_id) if submission.vehicle_id else None,
        "raw_text": submission.raw_text,
        "image_url": submission.image_url,
        "payload": submission.payload,
        "analysis_result": submission.analysis_result,
        "status": submission.status.value if hasattr(submission.status, "value") else submission.status,
        "error_message": submission.error_message,
    }

    for key, value in update_data.items():
        setattr(submission, key, value)

    submission_input_id = None
    try:
        session_payload = get_session_payload(submission.payload)
        if session_payload:
            try:
                structured_result = persist_structured_submission(
                    db,
                    submission=submission,
                    event=submission.event,
                    run_group=submission.run_group,
                    driver=driver or submission.driver,
                    vehicle=vehicle or submission.vehicle,
                    current_user=current_user,
                )
                submission_input_id = structured_result.submission_input_id
                submission.structured_ingest_status = structured_result.status
                submission.structured_ingest_warnings = structured_result.warnings
            except Exception:
                submission.structured_ingest_status = "skipped"
                submission.structured_ingest_warnings = [
                    {
                        "section": "structured_ingest",
                        "code": "STRUCTURED_INGEST_FAILED",
                        "message": "Structured normalization failed unexpectedly while overwriting the submission.",
                    }
                ]
                logger.exception(
                    "Structured submission overwrite failed; continuing with canonical update only (%s)",
                    _submission_log_summary(
                        submission_ref=submission.submission_ref,
                        correlation_id=submission.correlation_id,
                        event_id=submission.event_id,
                        run_group_id=submission.run_group_id,
                        driver_id=getattr(submission.driver, "driver_id", None),
                        vehicle_id=getattr(submission.vehicle, "vehicle_id", None),
                        current_user_id=current_user.id,
                        payload=submission.payload,
                    ),
                )
        else:
            submission.structured_ingest_status = "skipped"
            submission.structured_ingest_warnings = []

        db.add(submission)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if not _is_integrity_duplicate_error(exc):
            logger.exception("Unexpected submission integrity error while overwriting")
            raise _submission_error(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "SUBMISSION_SAVE_FAILED",
                "Failed to save submission",
            ) from exc

        raise _submission_error(
            status.HTTP_409_CONFLICT,
            "SUBMISSION_DUPLICATE",
            "Submission already exists or conflicts with an existing session",
        ) from exc
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Unexpected submission overwrite failure")
        raise _submission_error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "SUBMISSION_SAVE_FAILED",
            "Failed to save submission",
        ) from exc

    db.refresh(submission)
    loaded_submission = _load_submission(db, submission_id)
    if loaded_submission is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load submission")

    finalized_submission = _finalize_delivery(
        db,
        loaded_submission,
        submission_input_id=submission_input_id,
        background_tasks=background_tasks,
    )

    _write_audit_log(
        db,
        action="submission.overwrite",
        status="SUCCESS",
        message=f"Overwrote submission {submission.submission_ref}",
        payload={
            "submission_id": str(submission.id),
            "submission_ref": submission.submission_ref,
            "correlation_id": submission.correlation_id,
            "actor_user_id": str(current_user.id),
            "actor_role": current_user.role.value,
            "before": previous_state,
            "after": {
                "driver_id": str(finalized_submission.driver_id) if finalized_submission.driver_id else None,
                "vehicle_id": str(finalized_submission.vehicle_id) if finalized_submission.vehicle_id else None,
                "raw_text": finalized_submission.raw_text,
                "image_url": finalized_submission.image_url,
                "payload": finalized_submission.payload,
                "analysis_result": finalized_submission.analysis_result,
                "status": finalized_submission.status.value if hasattr(finalized_submission.status, "value") else finalized_submission.status,
                "error_message": finalized_submission.error_message,
            },
            "submission_input_id": submission_input_id,
        },
        user=current_user.name or current_user.email or str(current_user.id),
    )
    db.commit()

    return finalized_submission


@router.delete("/{submission_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_submission(
    submission_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> None:
    submission = db.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    db.delete(submission)
    db.commit()
