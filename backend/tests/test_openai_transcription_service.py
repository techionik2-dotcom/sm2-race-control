from __future__ import annotations

import json

import pytest

from app.services import openai_transcription_service
from app.services.openai_transcription_service import (
    OPENAI_TRANSCRIPTIONS_URL,
    OpenAITranscriptionError,
    extract_transcription_result,
    transcribe_audio_bytes,
)


class DummyOpenAIResponse:
    status = 200

    def __init__(self, payload: dict, headers: dict[str, str] | None = None) -> None:
        self._payload = payload
        self.headers = headers or {"x-request-id": "req_openai_test"}

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")


def test_transcribe_audio_bytes_posts_multipart_to_openai(monkeypatch) -> None:
    captured = {}

    monkeypatch.setattr(openai_transcription_service.settings, "openai_api_key", "test-openai-key")
    monkeypatch.setattr(openai_transcription_service.settings, "openai_transcription_model", "gpt-4o-transcribe")

    def fake_urlopen(req, timeout):
        captured["req"] = req
        captured["timeout"] = timeout
        return DummyOpenAIResponse({"text": "Car rotates better on entry."})

    monkeypatch.setattr(openai_transcription_service.request, "urlopen", fake_urlopen)

    payload, request_json = transcribe_audio_bytes(
        b"fake-audio",
        content_type="audio/webm;codecs=opus",
        audio_language="en-US",
        session_id="voice-session-1",
        file_name="driver note.webm",
    )

    req = captured["req"]
    body = req.data.decode("utf-8", errors="ignore")

    assert req.full_url == OPENAI_TRANSCRIPTIONS_URL
    assert req.get_method() == "POST"
    assert req.headers["Authorization"] == "Bearer test-openai-key"
    assert "multipart/form-data; boundary=" in req.headers["Content-type"]
    assert 'name="model"' in body
    assert "gpt-4o-transcribe" in body
    assert 'name="language"' in body
    assert "\r\nen\r\n" in body
    assert 'filename="driver-note.webm"' in body
    assert payload["text"] == "Car rotates better on entry."
    assert payload["_request_id"] == "req_openai_test"
    assert request_json["provider"] == "openai"
    assert request_json["model"] == "gpt-4o-transcribe"
    assert request_json["language"] == "en"
    assert request_json["request_id"] == "req_openai_test"


def test_transcribe_audio_bytes_requires_openai_key(monkeypatch) -> None:
    monkeypatch.setattr(openai_transcription_service.settings, "openai_api_key", None)

    with pytest.raises(OpenAITranscriptionError) as exc_info:
        transcribe_audio_bytes(b"fake-audio", content_type="audio/webm")

    assert exc_info.value.code == "OPENAI_NOT_CONFIGURED"
    assert exc_info.value.retryable is False


def test_extract_transcription_result_normalizes_openai_response(monkeypatch) -> None:
    monkeypatch.setattr(openai_transcription_service.settings, "openai_transcription_model", "gpt-4o-transcribe")

    result = extract_transcription_result(
        {
            "text": "Brake bias two clicks forward.",
            "_request_id": "req_openai_parse",
            "_model": "gpt-4o-transcribe",
            "usage": {"seconds": 3},
        }
    )

    assert result["transcript_text"] == "Brake bias two clicks forward."
    assert result["transcript_confidence"] is None
    assert result["transcript_word_count"] == 5
    assert result["openai_request_id"] == "req_openai_parse"
    assert result["openai_model"] == "gpt-4o-transcribe"
    assert result["transcript_json"]["provider"] == "openai"
