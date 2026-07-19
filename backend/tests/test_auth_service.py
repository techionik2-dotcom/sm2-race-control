from types import SimpleNamespace
from uuid import uuid4

from passlib.hash import bcrypt

from app.core.enums import UserApprovalStatus, UserRole
from app.services import auth_service


class DummySession:
    def __init__(self):
        self.added = []
        self.commits = 0
        self.refreshed = []

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.commits += 1

    def refresh(self, obj):
        self.refreshed.append(obj)


def build_user(email: str, hashed_password: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        name="Test User",
        email=email,
        hashed_password=hashed_password,
        role=UserRole.DRIVER,
        approval_status=UserApprovalStatus.APPROVED,
        is_active=True,
    )


def test_authenticate_user_accepts_legacy_bcrypt_and_rehashes(monkeypatch):
    legacy_hash = bcrypt.hash("123456")
    user = build_user("mec@smracing.com", legacy_hash)
    session = DummySession()

    monkeypatch.setattr(auth_service, "get_user_by_email", lambda *_args, **_kwargs: user)

    authenticated = auth_service.authenticate_user(session, user.email, "123456")

    assert authenticated is user
    assert user.hashed_password != legacy_hash
    assert user.hashed_password.startswith("$pbkdf2-sha256$")
    assert session.commits == 1
    assert session.added == [user]
    assert session.refreshed == [user]


def test_authenticate_user_rejects_wrong_password_for_legacy_bcrypt(monkeypatch):
    legacy_hash = bcrypt.hash("123456")
    user = build_user("mec@smracing.com", legacy_hash)
    session = DummySession()

    monkeypatch.setattr(auth_service, "get_user_by_email", lambda *_args, **_kwargs: user)

    authenticated = auth_service.authenticate_user(session, user.email, "wrong-password")

    assert authenticated is None
    assert user.hashed_password == legacy_hash
    assert session.commits == 0
    assert session.added == []
    assert session.refreshed == []


def test_verify_password_returns_false_for_unknown_hash_format():
    assert auth_service.verify_password("123456", "not-a-valid-password-hash") is False
