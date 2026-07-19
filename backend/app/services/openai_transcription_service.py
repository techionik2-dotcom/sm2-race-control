from __future__ import annotations

import json
import logging
import mimetypes
import re
import secrets
from typing import Any
from urllib import error, request

from app.core.config import get_settings


OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions"

settings = get_settings()
logger = logging.getLogger(__name__)


class OpenAITranscriptionError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str,
        retryable: bool,
        status_code: int | None = None,
        detail: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.status_code = status_code
        self.detail = detail


def _safe_filename(file_name: str | None, content_type: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", (file_name or "").strip()).strip(".-")
    if cleaned:
        return cleaned[:120]

    extension = mimetypes.guess_extension(content_type.split(";")[0].strip().lower()) or ".webm"
    if extension == ".jpe":
        extension = ".jpg"
    return f"voice-note{extension}"


def _normalize_language(language: str | None) -> str | None:
    cleaned = (language or "").strip()
    if not cleaned:
        cleaned = (settings.openai_transcription_language or "").strip()
    if not cleaned:
        return None

    # OpenAI transcription accepts ISO-639-1, while browsers often send values such as en-US.
    primary_language = cleaned.replace("_", "-").split("-", 1)[0].lower()
    return primary_language if len(primary_language) == 2 else cleaned


def _multipart_form_data(
    *,
    fields: dict[str, str],
    file_field: str,
    file_name: str,
    content_type: str,
    file_bytes: bytes,
) -> tuple[str, bytes]:
    boundary = f"sm2-openai-{secrets.token_hex(16)}"
    chunks: list[bytes] = []

    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                str(value).encode("utf-8"),
                b"\r\n",
            ]
        )

    chunks.extend(
        [
            f"--{boundary}\r\n".encode("utf-8"),
            (
                f'Content-Disposition: form-data; name="{file_field}"; '
                f'filename="{file_name}"\r\n'
            ).encode("utf-8"),
            f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
            file_bytes,
            b"\r\n",
            f"--{boundary}--\r\n".encode("utf-8"),
        ]
    )
    return boundary, b"".join(chunks)


def _load_error_detail(exc: error.HTTPError) -> Any:
    try:
        payload = exc.read().decode("utf-8", errors="replace")
    except Exception:
        return None

    try:
        return json.loads(payload)
    except Exception:
        return payload or None


def transcribe_audio_bytes(
    audio_bytes: bytes,
    *,
    content_type: str,
    audio_language: str | None = None,
    session_id: str | None = None,
    file_name: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not settings.openai_api_key:
        raise OpenAITranscriptionError(
            "OpenAI API key is not configured",
            code="OPENAI_NOT_CONFIGURED",
            retryable=False,
        )

    normalized_content_type = content_type.split(";")[0].strip().lower() or "audio/webm"
    model = settings.openai_transcription_model
    language = _normalize_language(audio_language)
    safe_file_name = _safe_filename(file_name, normalized_content_type)

    fields = {
        "model": model,
        "response_format": "json",
    }
    if language:
        fields["language"] = language

    boundary, body = _multipart_form_data(
        fields=fields,
        file_field="file",
        file_name=safe_file_name,
        content_type=normalized_content_type,
        file_bytes=audio_bytes,
    )
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }
    req = request.Request(
        OPENAI_TRANSCRIPTIONS_URL,
        data=body,
        headers=headers,
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=settings.voice_transcription_timeout_seconds) as response:
            response_bytes = response.read()
            request_id = response.headers.get("x-request-id") or response.headers.get("openai-request-id")
            try:
                payload = json.loads(response_bytes.decode("utf-8"))
            except json.JSONDecodeError as exc:
                raise OpenAITranscriptionError(
                    "OpenAI returned an invalid JSON response",
                    code="OPENAI_INVALID_RESPONSE",
                    retryable=True,
                    status_code=response.status,
                ) from exc
    except error.HTTPError as exc:
        detail = _load_error_detail(exc)
        retryable = exc.code in {408, 409, 425, 429} or exc.code >= 500
        raise OpenAITranscriptionError(
            f"OpenAI returned HTTP {exc.code}",
            code="OPENAI_HTTP_ERROR",
            retryable=retryable,
            status_code=exc.code,
            detail=detail,
        ) from exc
    except error.URLError as exc:
        raise OpenAITranscriptionError(
            f"OpenAI request failed: {exc.reason if hasattr(exc, 'reason') else exc}",
            code="OPENAI_NETWORK_ERROR",
            retryable=True,
        ) from exc
    except TimeoutError as exc:
        raise OpenAITranscriptionError(
            "OpenAI transcription timed out",
            code="OPENAI_TIMEOUT",
            retryable=True,
        ) from exc
    except OpenAITranscriptionError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Unexpected OpenAI transcription failure")
        raise OpenAITranscriptionError(
            f"OpenAI transcription failed: {exc}",
            code="OPENAI_UNEXPECTED_ERROR",
            retryable=False,
        ) from exc

    payload["_request_id"] = request_id
    payload["_model"] = model
    return payload, {
        "url": OPENAI_TRANSCRIPTIONS_URL,
        "provider": "openai",
        "model": model,
        "language": language,
        "response_format": "json",
        "audio_bytes": len(audio_bytes),
        "content_type": normalized_content_type,
        "file_name": safe_file_name,
        "session_id": session_id,
        "request_id": request_id,
    }


def extract_transcription_result(response_payload: dict[str, Any]) -> dict[str, Any]:
    transcript_text = str(response_payload.get("text") or "").strip()
    usage = response_payload.get("usage") if isinstance(response_payload, dict) else None
    segments = response_payload.get("segments") if isinstance(response_payload, dict) else None
    words = response_payload.get("words") if isinstance(response_payload, dict) else None

    if isinstance(words, list) and words:
        word_count = len(words)
    else:
        word_count = len(transcript_text.split())

    audio_language = response_payload.get("language")

    return {
        "transcript_text": transcript_text,
        "transcript_confidence": None,
        "transcript_word_count": word_count,
        "audio_language": audio_language,
        "openai_request_id": response_payload.get("_request_id"),
        "openai_model": response_payload.get("_model") or settings.openai_transcription_model,
        "transcript_json": {
            "provider": "openai",
            "text": transcript_text,
            "language": audio_language,
            "segments": segments,
            "words": words,
            "usage": usage,
            "raw_response": response_payload,
        },
    }
