import pytest
from pydantic import ValidationError

from app.core.config import Settings


def load_settings(monkeypatch: pytest.MonkeyPatch, *, environment_var="ENVIRONMENT", environment=None, secret=None) -> Settings:
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)

    if environment is not None:
        monkeypatch.setenv(environment_var, environment)

    if secret is not None:
        monkeypatch.setenv("JWT_SECRET_KEY", secret)

    return Settings(_env_file=None)


def test_missing_jwt_secret_fails_in_non_test_environment(monkeypatch: pytest.MonkeyPatch):
    with pytest.raises(ValidationError, match="Field required"):
        load_settings(monkeypatch, environment="development")


def test_empty_jwt_secret_fails_in_non_test_environment(monkeypatch: pytest.MonkeyPatch):
    with pytest.raises(ValidationError, match="JWT_SECRET_KEY must be set and cannot be empty"):
        load_settings(monkeypatch, environment="development", secret="   ")


def test_change_me_jwt_secret_fails_in_non_test_environment(monkeypatch: pytest.MonkeyPatch):
    with pytest.raises(ValidationError, match="JWT_SECRET_KEY must not use a default or placeholder value"):
        load_settings(monkeypatch, environment="development", secret="change-me")


def test_default_jwt_secret_fails_in_non_test_environment(monkeypatch: pytest.MonkeyPatch):
    with pytest.raises(ValidationError, match="JWT_SECRET_KEY must not use a default or placeholder value"):
        load_settings(monkeypatch, environment="development", secret="default")


def test_short_jwt_secret_fails_in_non_test_environment(monkeypatch: pytest.MonkeyPatch):
    with pytest.raises(ValidationError, match="JWT_SECRET_KEY must be at least 32 characters long"):
        load_settings(monkeypatch, environment="development", secret="short-secret")


def test_test_secret_fails_in_non_test_environment(monkeypatch: pytest.MonkeyPatch):
    with pytest.raises(ValidationError, match="JWT_SECRET_KEY=test-secret is allowed only when ENVIRONMENT or APP_ENV is set to 'test'"):
        load_settings(monkeypatch, environment="development", secret="test-secret")


def test_valid_long_jwt_secret_passes(monkeypatch: pytest.MonkeyPatch):
    settings = load_settings(
        monkeypatch,
        environment="development",
        secret="generate-a-long-random-64-character-secret-for-local-dev-1234",
    )

    assert settings.jwt_secret_key == "generate-a-long-random-64-character-secret-for-local-dev-1234"


def test_safe_test_secret_is_allowed_only_in_test_environment(monkeypatch: pytest.MonkeyPatch):
    settings = load_settings(
        monkeypatch,
        environment_var="APP_ENV",
        environment="test",
        secret="test-secret",
    )

    assert settings.environment == "test"
    assert settings.jwt_secret_key == "test-secret"
