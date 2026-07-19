from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import users as users_endpoints
from app.core.enums import UserRole
from app.schemas.auth import UserRoleUpdate


class DummySession:
    def __init__(self, scalar_result=None):
        self.scalar_result = scalar_result
        self.added = []
        self.commits = 0
        self.refreshed = []

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.commits += 1

    def refresh(self, obj):
        self.refreshed.append(obj)

    def get(self, _model, _id):
        return self.scalar_result


def build_user(role: UserRole) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        name=f"{role.value.title()} User",
        email=f"{role.value.lower()}@smracing.com",
        role=role,
    )


def test_owner_can_change_user_role():
    target_user = build_user(UserRole.DRIVER)
    current_user = build_user(UserRole.OWNER)
    session = DummySession(scalar_result=target_user)

    updated_user = users_endpoints.update_user_role(
        target_user.id,
        UserRoleUpdate(role=UserRole.OWNER),
        session,
        current_user,
    )

    assert updated_user.role == UserRole.OWNER
    assert session.commits == 1
    assert target_user in session.added
    assert target_user in session.refreshed


def test_owner_can_assign_owner_role():
    target_user = build_user(UserRole.DRIVER)
    current_user = build_user(UserRole.OWNER)
    session = DummySession(scalar_result=target_user)

    updated_user = users_endpoints.update_user_role(
        target_user.id,
        UserRoleUpdate(role=UserRole.OWNER),
        session,
        current_user,
    )

    assert updated_user.role == UserRole.OWNER
    assert session.commits == 1


def test_owner_can_change_owner_account_role():
    target_user = build_user(UserRole.OWNER)
    current_user = build_user(UserRole.OWNER)
    session = DummySession(scalar_result=target_user)

    updated_user = users_endpoints.update_user_role(
        target_user.id,
        UserRoleUpdate(role=UserRole.DRIVER),
        session,
        current_user,
    )

    assert updated_user.role == UserRole.DRIVER
    assert session.commits == 1


def test_owner_cannot_change_own_role():
    current_user = build_user(UserRole.OWNER)
    session = DummySession(scalar_result=current_user)

    with pytest.raises(HTTPException) as exc_info:
        users_endpoints.update_user_role(
            current_user.id,
            UserRoleUpdate(role=UserRole.DRIVER),
            session,
            current_user,
        )

    assert exc_info.value.status_code == 403
    assert "own role" in exc_info.value.detail.lower()
    assert session.commits == 0
