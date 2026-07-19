from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from app.services.raw_note_llm_service import extract_raw_note_via_openai


def test_extract_raw_note_via_openai_normalizes_make_style_payload() -> None:
    settings = SimpleNamespace(
        openai_api_key="test-key",
        openai_model="gpt-4o-mini",
        openai_request_timeout_seconds=8.0,
    )
    payload = {
        "confidence": 0.91,
        "data": {
            "session_number": 3,
            "duration_min": 30,
            "driver_id": "NG",
            "vehicle_id": "NG-GT4-2025",
            "tire_set": "Y S3",
            "pressures": {
                "cold": {"fl": 26, "fr": 26, "rl": 27, "rr": 27},
                "hot": {"fl": 31, "fr": 31, "rl": 32, "rr": 32},
            },
            "alignment": {
                "camber_fl": -3.2,
                "camber_fr": -3.1,
                "camber_rl": -2.8,
                "camber_rr": -2.8,
            },
            "suspensions": {
                "rebound_f": 7,
                "rebound_r": 7,
                "bump_f": 4,
                "bump_r": 3,
                "sway_bar_f": "P3",
                "sway_bar_r": "P3",
            },
            "wheelbase_mm": "2450",
            "best_lap_time": "118.300",
        },
    }

    with (
        patch("app.services.raw_note_llm_service.get_settings", return_value=settings),
        patch("app.services.raw_note_llm_service._call_openai_json", return_value=(payload, None)),
    ):
        result = extract_raw_note_via_openai("s3 30min nico gt4 Y-S3 pf 26/26/27/27 c -3.2/-3.1/-2.8/-2.8 wb 2450")

    assert result is not None
    assert result.used_openai is True
    assert result.confidence == 0.91
    assert result.parsed_note.session_number == 3
    assert result.parsed_note.driver_alias == "NG"
    assert result.parsed_note.vehicle_alias == "NG-GT4-2025"
    assert result.parsed_note.tire_set == "Y-S3"
    assert result.parsed_note.pressures["cold"]["fl"] == 26.0
    assert result.parsed_note.alignment["camber_rr"] == -2.8
    assert result.parsed_note.suspension["rebound_f"] == 7
    assert result.parsed_note.suspension["sway_bar_f"] == "P3"
    assert result.parsed_note.wheelbase_mm == 2450.0
    assert result.parsed_note.best_lap == "1:58.300"


def test_extract_raw_note_via_openai_returns_none_without_api_key() -> None:
    settings = SimpleNamespace(
        openai_api_key=None,
        openai_model="gpt-4o-mini",
        openai_request_timeout_seconds=8.0,
    )

    with patch("app.services.raw_note_llm_service.get_settings", return_value=settings):
        result = extract_raw_note_via_openai("s1 30min nico gt4 Y-S3 pf 27 wb 2450")

    assert result is None
