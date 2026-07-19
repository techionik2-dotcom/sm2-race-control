from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.enums import SubmissionStatus, UserRole
from app.services import submission_ai_summary_service as service


class FakeSession:
    def __init__(self, submission):
        self.submission = submission
        self.commits = 0
        self.added = []

    def scalar(self, _statement):
        return self.submission

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.commits += 1

    def refresh(self, _value):
        return None


def make_submission(**overrides):
    submission_id = overrides.pop("id", uuid4())
    defaults = {
        "id": submission_id,
        "submission_ref": "SM2-TEST-001",
        "status": SubmissionStatus.SENT,
        "event_id": uuid4(),
        "run_group_id": uuid4(),
        "created_by_id": uuid4(),
        "voice_session_id": None,
        "raw_text": "S2 PF 20/21/20/22 hot 24/25/24/26 best 1:42.331 driver reports mid-corner push.",
        "image_url": None,
        "payload": {
            "date": "2026-06-11",
            "time": "14:10",
            "session_type": "Practice",
            "session_number": 2,
            "duration_min": 20,
            "feedback": "Mid-corner understeer on long right-handers.",
            "pressures": {
                "unit": "psi",
                "cold": {"fl": 20, "fr": 21, "rl": 20, "rr": 22},
                "hot": {"fl": 24, "fr": 25, "rl": 24, "rr": 26},
            },
        },
        "analysis_result": {
            "admin_comment": "Check pressure split before update.",
            "validation_messages": ["Alignment section is incomplete."],
        },
        "structured_ingest_status": "parsed",
        "structured_ingest_warnings": [],
        "error_message": None,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
        "event": None,
        "run_group": None,
        "driver": None,
        "vehicle": None,
        "voice_session": None,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_user():
    return SimpleNamespace(id=uuid4(), role=UserRole.OWNER, name="Owner Admin", email="owner@example.com")


@pytest.fixture(autouse=True)
def openai_settings(monkeypatch):
    monkeypatch.setattr(
        service,
        "get_settings",
        lambda: SimpleNamespace(
            openai_api_key="test-key",
            openai_model="gpt-test",
            openai_request_timeout_seconds=8,
        ),
    )


def test_generate_submission_ai_summary_persists_history(monkeypatch):
    submission = make_submission(
        analysis_result={
            "ai_summary_history": [
                {
                    "summary_id": "previous",
                    "generated_at": "2026-06-10T12:00:00+00:00",
                    "summary": "Previous summary",
                    "key_observations": [],
                    "needs_review": [],
                    "recommended_actions": [],
                    "generated_by": "Owner Admin",
                    "model": "gpt-test",
                }
            ]
        }
    )
    db = FakeSession(submission)

    monkeypatch.setattr(
        service,
        "_call_openai_json",
        lambda **_kwargs: (
            {
                "summary": "Practice session with useful pressure and feedback data.",
                "keyObservations": ["Hot pressures increased evenly."],
                "needsReview": ["Alignment section is incomplete."],
                "recommendedActions": ["Review alignment before saving."],
            },
            None,
        ),
    )

    result = service.generate_submission_ai_summary(db, submission.id, make_user())

    assert result.summary == "Practice session with useful pressure and feedback data."
    assert result.key_observations == ["Hot pressures increased evenly."]
    assert db.commits == 1
    assert submission.analysis_result["ai_summary_current"]["summary"] == result.summary
    assert len(submission.analysis_result["ai_summary_history"]) == 2
    assert submission.analysis_result["ai_summary_history"][1]["summary_id"] == "previous"


def test_generate_submission_ai_summary_returns_not_found():
    db = FakeSession(None)

    with pytest.raises(HTTPException) as exc_info:
        service.generate_submission_ai_summary(db, uuid4(), make_user())

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail["code"] == "SUBMISSION_NOT_FOUND"


def test_generate_submission_ai_summary_rejects_insufficient_data():
    submission = make_submission(
        raw_text="",
        payload={},
        analysis_result={},
        structured_ingest_warnings=[],
        event=None,
        run_group=None,
        driver=None,
        vehicle=None,
    )
    db = FakeSession(submission)

    with pytest.raises(HTTPException) as exc_info:
        service.generate_submission_ai_summary(db, submission.id, make_user())

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["message"] == "Not enough session data is available to generate a useful summary."


def test_generate_submission_ai_summary_handles_openai_failure(monkeypatch):
    submission = make_submission()
    db = FakeSession(submission)
    monkeypatch.setattr(service, "_call_openai_json", lambda **_kwargs: (None, "http_500"))

    with pytest.raises(HTTPException) as exc_info:
        service.generate_submission_ai_summary(db, submission.id, make_user())

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail["message"] == "Could not generate AI summary. Please try again."
    assert db.commits == 0
