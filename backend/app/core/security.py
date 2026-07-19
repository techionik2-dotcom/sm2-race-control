import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import jwt
from passlib.exc import MissingBackendError, PasslibSecurityError, UnknownHashError
from passlib.hash import bcrypt, pbkdf2_sha256

from app.core.config import get_settings


settings = get_settings()


def hash_password(password: str) -> str:
    # Keep local and deployed environments on the same password format.
    return pbkdf2_sha256.hash(password)


def identify_password_hash(hashed_password: str) -> str | None:
    if not isinstance(hashed_password, str) or not hashed_password.strip():
        return None

    if pbkdf2_sha256.identify(hashed_password):
        return "pbkdf2_sha256"

    if bcrypt.identify(hashed_password):
        return "bcrypt"

    return None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    scheme = identify_password_hash(hashed_password)

    try:
        if scheme == "pbkdf2_sha256":
            return pbkdf2_sha256.verify(plain_password, hashed_password)

        if scheme == "bcrypt":
            return bcrypt.verify(plain_password, hashed_password)
    except (MissingBackendError, PasslibSecurityError, UnknownHashError, TypeError, ValueError):
        return False

    return False


def password_needs_rehash(hashed_password: str) -> bool:
    return identify_password_hash(hashed_password) != "pbkdf2_sha256"


def create_access_token(subject: str, additional_claims: dict[str, Any] | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict[str, Any] = {"jti": str(uuid.uuid4()), "sub": subject, "exp": expire}

    if additional_claims:
        payload.update(additional_claims)

    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
