from types import SimpleNamespace
from uuid import uuid4

from app.api.v1.endpoints import users as users_endpoints
from app.core.enums import UserRole


class DummySession:
    def __init__(self, target_user=None):
        self.target_user = target_user
        self.executed = []
        self.deleted = []
        self.commits = 0
        self.rollbacks = 0

    def get(self, _model, _pk):
        return self.target_user

    def execute(self, statement, params=None):
        self.executed.append(str(statement))
        return SimpleNamespace(rowcount=1)

    def delete(self, obj):
        self.deleted.append(obj)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def build_user(role: UserRole) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        name=f"{role.value.title()} User",
        email=f"{role.value.lower()}@smracing.com",
        role=role,
    )


def test_admin_delete_cleans_user_history_and_removes_user():
    target_user = build_user(UserRole.MECHANIC)
    current_user = build_user(UserRole.ADMIN)
    session = DummySession(target_user=target_user)

    result = users_endpoints.delete_user(target_user.id, session, current_user)

    assert result is None
    assert session.commits == 1
    assert session.rollbacks == 0
    assert session.deleted == [target_user]
    assert any("chatbot_conversations" in statement for statement in session.executed)
    assert any("voice_note_sessions" in statement for statement in session.executed)
    assert any("events" in statement for statement in session.executed)
    assert any("run_groups" in statement for statement in session.executed)
    assert any("submissions" in statement for statement in session.executed)
    assert any("drivers" in statement for statement in session.executed)
