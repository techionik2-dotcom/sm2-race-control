from __future__ import annotations

import json
from typing import Any
from urllib import error, request

from app.core.config import get_settings
from app.models.submission import Submission
from app.services.submission_payload_service import (
    get_session_payload,
    merge_submission_analysis,
    to_isoformat,
)


settings = get_settings()


class MakeWebhookDeliveryError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str,
        retryable: bool,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.status_code = status_code


def build_make_payload(submission: Submission, submission_input_id: int | None = None) -> dict[str, Any]:
    run_group_value = None
    if submission.run_group is not None:
        run_group_value = submission.run_group.normalized.value if hasattr(submission.run_group.normalized, "value") else submission.run_group.normalized

    driver_code = submission.driver.driver_id if submission.driver is not None else None
    vehicle_code = submission.vehicle.vehicle_id if submission.vehicle is not None else None
    session_payload = get_session_payload(submission.payload)
    analysis_payload = merge_submission_analysis(
        submission.payload,
        submission.raw_text,
        submission.image_url,
        submission.analysis_result,
    )
    raw_input_mode = analysis_payload.get("raw_input_mode")
    if raw_input_mode in {None, "", "none"} and analysis_payload.get("has_image"):
        raw_input_mode = "image"
    correlation_id = getattr(submission, "correlation_id", None) or submission.submission_ref
    voice_session = getattr(submission, "voice_session", None)
    voice_session_payload = None
    if voice_session is not None:
        voice_session_payload = {
            "id": str(voice_session.id),
            "submissionId": str(voice_session.submission_id) if voice_session.submission_id else None,
            "status": voice_session.status.value if hasattr(voice_session.status, "value") else voice_session.status,
            "validationStatus": voice_session.validation_status,
            "validationMessage": voice_session.validation_message,
            "audioStorageKey": voice_session.audio_storage_key,
            "audioFileName": voice_session.audio_file_name,
            "audioContentType": voice_session.audio_content_type,
            "audioSizeBytes": voice_session.audio_size_bytes,
            "audioDurationMs": voice_session.audio_duration_ms,
            "audioChecksum": voice_session.audio_checksum,
            "audioLanguage": voice_session.audio_language,
            "transcriptText": voice_session.transcript_edited_text or voice_session.transcript_text,
            "transcriptConfidence": voice_session.transcript_confidence,
            "transcriptWordCount": voice_session.transcript_word_count,
            "transcriptionProvider": "openai",
            "openaiRequestId": voice_session.deepgram_request_id,
            "openaiModel": voice_session.deepgram_model,
            "deepgramRequestId": voice_session.deepgram_request_id,
            "deepgramModel": voice_session.deepgram_model,
            "retryCount": voice_session.retry_count,
            "uploadedAt": to_isoformat(voice_session.uploaded_at),
            "transcribedAt": to_isoformat(voice_session.transcribed_at),
            "confirmedAt": to_isoformat(voice_session.confirmed_at),
            "submittedAt": to_isoformat(voice_session.submitted_at),
            "archivedAt": to_isoformat(voice_session.archived_at),
        }

    return {
        "submissionId": submission.submission_ref,
        "correlationId": correlation_id,
        "submissionInputId": submission_input_id,
        "status": submission.status.value if hasattr(submission.status, "value") else submission.status,
        "submittedAt": to_isoformat(submission.created_at),
        "updatedAt": to_isoformat(submission.updated_at),
        "submissionMode": analysis_payload.get("submission_mode"),
        "sourceType": analysis_payload.get("source_type"),
        "hasStructuredData": analysis_payload.get("has_structured_data"),
        "structuredOnly": analysis_payload.get("structured_only"),
        "hasRawText": analysis_payload.get("has_raw_text"),
        "hasImage": analysis_payload.get("has_image"),
        "hasVoiceNotes": analysis_payload.get("has_voice_notes"),
        "rawInputMode": raw_input_mode,
        "eventId": str(submission.event_id),
        "runGroup": run_group_value,
        "runGroupCode": run_group_value,
        "driverId": str(submission.driver_id) if submission.driver_id else None,
        "vehicleId": str(submission.vehicle_id) if submission.vehicle_id else None,
        "driverCode": driver_code,
        "vehicleCode": vehicle_code,
        "createdById": str(submission.created_by_id) if submission.created_by_id else None,
        "correlation_id": correlation_id,
        "raw_text": submission.raw_text,
        "image": submission.image_url,
        "data": session_payload,
        "analysis_result": analysis_payload,
        "event": {
            "id": str(submission.event.id) if submission.event is not None else str(submission.event_id),
            "name": submission.event.name if submission.event is not None else None,
            "track": submission.event.track if submission.event is not None else None,
            "startDate": to_isoformat(submission.event.start_date) if submission.event is not None else None,
            "endDate": to_isoformat(submission.event.end_date) if submission.event is not None else None,
        },
        "runGroupDetail": {
            "id": str(submission.run_group.id) if submission.run_group is not None else str(submission.run_group_id),
            "rawText": submission.run_group.raw_text if submission.run_group is not None else None,
            "normalized": run_group_value,
            "locked": submission.run_group.locked if submission.run_group is not None else None,
        },
        "driver": {
            "id": str(submission.driver.id) if submission.driver is not None else (str(submission.driver_id) if submission.driver_id else None),
            "driverCode": driver_code,
            "name": submission.driver.driver_name if submission.driver is not None else None,
            "firstName": submission.driver.first_name if submission.driver is not None else None,
            "lastName": submission.driver.last_name if submission.driver is not None else None,
            "teamName": submission.driver.team_name if submission.driver is not None else None,
        },
        "vehicle": {
            "id": str(submission.vehicle.id) if submission.vehicle is not None else (str(submission.vehicle_id) if submission.vehicle_id else None),
            "vehicleCode": vehicle_code,
            "make": submission.vehicle.make if submission.vehicle is not None else None,
            "model": submission.vehicle.model if submission.vehicle is not None else None,
            "year": submission.vehicle.year if submission.vehicle is not None else None,
            "class": submission.vehicle.vehicle_class if submission.vehicle is not None else None,
            "registrationNumber": submission.vehicle.registration_number if submission.vehicle is not None else None,
        },
        "notes": {
            "rawText": submission.raw_text,
            "imageUrl": submission.image_url,
        },
        "analysis": analysis_payload,
        "session": session_payload,
        "payload": session_payload,
        "voiceSession": voice_session_payload,
        "rawInput": {
            "rawText": submission.raw_text,
            "imageUrl": submission.image_url,
            "submissionPayload": submission.payload if isinstance(submission.payload, dict) else {},
            "analysisResult": analysis_payload,
            "correlationId": correlation_id,
        },
        "staging": {
            "submissionInputId": submission_input_id,
            "validationStatus": "PENDING",
            "source": "pwa",
            "correlationId": correlation_id,
        },
    }


def send_submission_to_make(submission: Submission, submission_input_id: int | None = None) -> None:
    if not settings.make_webhook_url:
        return

    payload = build_make_payload(submission, submission_input_id=submission_input_id)
    body = json.dumps(payload).encode("utf-8")
    correlation_id = payload.get("correlationId")
    req = request.Request(
        settings.make_webhook_url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-SM2-Submission-Ref": submission.submission_ref,
            **({"X-SM2-Correlation-Id": str(correlation_id)} if correlation_id else {}),
            **(
                {"X-SM2-Submission-Input-Id": str(submission_input_id)}
                if submission_input_id is not None
                else {}
            ),
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=8) as response:
            if response.status < 200 or response.status >= 300:
                raise MakeWebhookDeliveryError(
                    f"Webhook responded with status {response.status}",
                    code="MAKE_WEBHOOK_HTTP_ERROR",
                    retryable=response.status >= 500,
                    status_code=response.status,
                )
    except error.HTTPError as exc:
        raise MakeWebhookDeliveryError(
            f"Webhook responded with status {exc.code}",
            code="MAKE_WEBHOOK_HTTP_ERROR",
            retryable=exc.code >= 500,
            status_code=exc.code,
        ) from exc
    except error.URLError as exc:
        raise MakeWebhookDeliveryError(
            f"Webhook forwarding failed: {exc}",
            code="MAKE_WEBHOOK_NETWORK_ERROR",
            retryable=True,
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise MakeWebhookDeliveryError(
            f"Webhook forwarding failed: {exc}",
            code="MAKE_WEBHOOK_UNEXPECTED_ERROR",
            retryable=False,
        ) from exc
