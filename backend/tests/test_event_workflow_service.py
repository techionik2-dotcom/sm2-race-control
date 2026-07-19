from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.event_workflow_service import analyze_schedule_text, deep_merge, diff_dict


def test_analyze_schedule_text_detects_reviewable_sessions() -> None:
    event = SimpleNamespace(start_date=datetime(2026, 7, 1, tzinfo=timezone.utc))

    detected, ignored = analyze_schedule_text(
        """
        Wednesday July 1 8:30 AM Practice 1 RED
        July 1 2:15 PM Practice 2 RED
        July 2 9:00 AM Qualifying
        July 3 1:30 PM Race 1
        Dinner with team
        """,
        event,
    )

    assert [item.title for item in detected] == ["Practice 1", "Practice 2", "Qualifying", "Race 1"]
    assert detected[0].session_type == "PRACTICE"
    assert detected[0].run_group == "RED"
    assert detected[0].scheduled_at.month == 7
    assert detected[0].scheduled_at.day == 1
    assert detected[0].scheduled_at.hour == 8
    assert detected[0].scheduled_at.minute == 30
    assert ignored == ["Dinner with team"]


def test_deep_merge_carries_forward_unchanged_values() -> None:
    practice_1_final = {
        "pressures": {"front": 22, "rear": 21},
        "rear_wing": "Position 4",
        "alignment": "Baseline A",
    }
    practice_2_changes = {
        "pressures": {"front": 23},
        "rear_wing": "Position 5",
    }

    practice_2_final = deep_merge(practice_1_final, practice_2_changes)

    assert practice_2_final == {
        "pressures": {"front": 23, "rear": 21},
        "rear_wing": "Position 5",
        "alignment": "Baseline A",
    }
    assert diff_dict(practice_1_final, practice_2_final) == {
        "pressures": {"front": {"before": 22, "after": 23}},
        "rear_wing": {"before": "Position 4", "after": "Position 5"},
    }
