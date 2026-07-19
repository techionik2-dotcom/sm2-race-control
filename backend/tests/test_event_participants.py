from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import events as events_endpoints


class DummySession:
    def __init__(self, participant=None):
        self.participant = participant
        self.deleted = []
        self.commits = 0

    def get(self, _model, _id):
        return self.participant

    def delete(self, obj):
        self.deleted.append(obj)

    def commit(self):
        self.commits += 1


def test_remove_event_participant_deletes_matching_participant():
    event_id = uuid4()
    participant = SimpleNamespace(id=uuid4(), event_id=event_id)
    session = DummySession(participant)

    result = events_endpoints.remove_event_participant(
        event_id,
        participant.id,
        session,
        SimpleNamespace(id=uuid4()),
    )

    assert result is None
    assert session.deleted == [participant]
    assert session.commits == 1


def test_remove_event_participant_rejects_wrong_event():
    event_id = uuid4()
    participant = SimpleNamespace(id=uuid4(), event_id=uuid4())
    session = DummySession(participant)

    with pytest.raises(HTTPException) as exc_info:
        events_endpoints.remove_event_participant(
            event_id,
            participant.id,
            session,
            SimpleNamespace(id=uuid4()),
        )

    assert exc_info.value.status_code == 404
    assert session.deleted == []
    assert session.commits == 0
