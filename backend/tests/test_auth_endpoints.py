from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api import deps as auth_deps
from app.api.v1.endpoints import auth as auth_endpoints
from app.api.v1.endpoints import users as users_endpoints
from app.core.enums import UserApprovalStatus, UserRole
from app.schemas.auth import UserLogin


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

    def scalar(self, _query):
        return self.scalar_result

    def get(self, _model, _id):
        return self.scalar_result


class TokenSession:
    def __init__(self, user):
        self.user = user

    def scalar(self, _query):
        return None

    def get(self, _model, _id):
        return self.user


def build_user(role: UserRole) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        email=f"{role.value.lower()}@smracing.com",
        role=role,
        approval_status=UserApprovalStatus.APPROVED,
        last_login_at=None,
        last_logout_at=None,
        approved_at=None,
        approved_by_id=None,
        rejected_at=None,
        rejected_by_id=None,
        is_active=True,
    )


def test_admin_login_rejects_non_admin_role(monkeypatch):
    user = build_user(UserRole.MECHANIC)
    session = DummySession()

    monkeypatch.setattr(auth_endpoints, "authenticate_user", lambda *_args, **_kwargs: user)

    with pytest.raises(HTTPException) as exc_info:
        auth_endpoints.admin_login(UserLogin(email=user.email, password="password123"), session)

    assert exc_info.value.status_code == 403
    assert session.commits == 0
    assert user.last_login_at is None


def test_login_rejects_pending_signup(monkeypatch):
    user = build_user(UserRole.MECHANIC)
    user.approval_status = UserApprovalStatus.PENDING
    user.is_active = False
    session = DummySession()

    monkeypatch.setattr(auth_endpoints, "authenticate_user", lambda *_args, **_kwargs: user)

    with pytest.raises(HTTPException) as exc_info:
        auth_endpoints.login(UserLogin(email=user.email, password="password123"), session)

    assert exc_info.value.status_code == 403
    assert "waiting for owner approval" in exc_info.value.detail.lower()
    assert session.commits == 0


def test_login_rejects_rejected_signup(monkeypatch):
    user = build_user(UserRole.MECHANIC)
    user.approval_status = UserApprovalStatus.REJECTED
    user.is_active = False
    session = DummySession()

    monkeypatch.setattr(auth_endpoints, "authenticate_user", lambda *_args, **_kwargs: user)

    with pytest.raises(HTTPException) as exc_info:
        auth_endpoints.login(UserLogin(email=user.email, password="password123"), session)

    assert exc_info.value.status_code == 403
    assert "rejected" in exc_info.value.detail.lower()
    assert session.commits == 0


def test_signup_creates_pending_account(monkeypatch):
    created_args = {}

    def fake_create_user(db, user_in, role, is_active=True, approval_status=None):
        created_args["role"] = role
        created_args["is_active"] = is_active
        created_args["approval_status"] = approval_status
        return build_user(UserRole.MECHANIC)

    monkeypatch.setattr(auth_endpoints, "create_user", fake_create_user)

    user = auth_endpoints.register_user(
        auth_endpoints.UserSignup(name="Alex Tech", email="alex@smracing.com", password="password123"),
        DummySession(),
    )

    assert user.role == UserRole.MECHANIC
    assert created_args["role"] == UserRole.MECHANIC
    assert created_args["is_active"] is False
    assert created_args["approval_status"] == UserApprovalStatus.PENDING


def test_admin_can_approve_pending_user():
    pending_user = build_user(UserRole.MECHANIC)
    pending_user.approval_status = UserApprovalStatus.PENDING
    pending_user.is_active = False
    owner_user = build_user(UserRole.OWNER)
    session = DummySession(scalar_result=pending_user)

    approved_user = users_endpoints.approve_user(pending_user.id, session, owner_user)

    assert approved_user.is_active is True
    assert approved_user.approval_status == UserApprovalStatus.APPROVED
    assert approved_user.approved_at is not None
    assert approved_user.approved_by_id == owner_user.id
    assert session.commits == 1
    assert pending_user in session.added


def test_admin_can_reject_pending_user():
    pending_user = build_user(UserRole.MECHANIC)
    pending_user.approval_status = UserApprovalStatus.PENDING
    pending_user.is_active = False
    owner_user = build_user(UserRole.OWNER)
    session = DummySession(scalar_result=pending_user)

    rejected_user = users_endpoints.reject_user(pending_user.id, session, owner_user)

    assert rejected_user.is_active is False
    assert rejected_user.approval_status == UserApprovalStatus.REJECTED
    assert rejected_user.rejected_at is not None
    assert rejected_user.rejected_by_id == owner_user.id
    assert session.commits == 1
    assert pending_user in session.added


def test_pending_user_token_is_rejected_by_current_user_dependency(monkeypatch):
    pending_user = build_user(UserRole.MECHANIC)
    pending_user.approval_status = UserApprovalStatus.PENDING
    pending_user.is_active = False

    monkeypatch.setattr(
        auth_deps,
        "decode_access_token",
        lambda _token: {"jti": "jti-123", "sub": str(pending_user.id)},
    )

    with pytest.raises(HTTPException) as exc_info:
        auth_deps.get_current_user(TokenSession(pending_user), "signed-token")

    assert exc_info.value.status_code == 401


def test_admin_login_updates_audit_timestamp_and_returns_token(monkeypatch):
    user = build_user(UserRole.ADMIN)
    session = DummySession()

    monkeypatch.setattr(auth_endpoints, "authenticate_user", lambda *_args, **_kwargs: user)
    monkeypatch.setattr(auth_endpoints, "create_access_token", lambda **_kwargs: "admin-token")

    token = auth_endpoints.admin_login(UserLogin(email=user.email, password="password123"), session)

    assert token.access_token == "admin-token"
    assert token.token_type == "bearer"
    assert user.last_login_at is not None
    assert user.last_login_at.tzinfo == timezone.utc
    assert session.commits == 1
    assert session.refreshed == [user]


def test_logout_revokes_token_and_records_logout(monkeypatch):
    user = build_user(UserRole.ADMIN)
    session = DummySession()
    now = datetime(2026, 5, 4, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        auth_endpoints,
        "decode_access_token",
        lambda _token: {"jti": "jti-123", "exp": int(now.timestamp())},
    )

    result = auth_endpoints.logout(
        token="signed-token",
        db=session,
        current_user=user,
    )

    assert result == {"message": "Logged out successfully"}
    assert user.last_logout_at is not None
    assert user.last_logout_at.tzinfo == timezone.utc
    assert session.commits == 1
    assert any(getattr(obj, "jti", None) == "jti-123" for obj in session.added)
    assert user in session.added
