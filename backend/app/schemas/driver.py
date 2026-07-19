from uuid import UUID

from pydantic import Field

from app.schemas.common import ORMModel, TimestampedModel


class DriverCreate(ORMModel):
    driver_id: str | None = Field(default=None, max_length=32)
    driver_name: str | None = Field(default=None, max_length=255)
    aliases: list[str] = Field(default_factory=list)
    active: bool | None = None
    first_name: str | None = Field(default=None, min_length=1, max_length=120)
    last_name: str | None = Field(default=None, min_length=1, max_length=120)
    license_number: str | None = Field(default=None, max_length=120)
    team_name: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    is_active: bool | None = None


class DriverUpdate(ORMModel):
    driver_id: str | None = Field(default=None, max_length=32)
    driver_name: str | None = Field(default=None, max_length=255)
    aliases: list[str] | None = None
    active: bool | None = None
    first_name: str | None = Field(default=None, min_length=1, max_length=120)
    last_name: str | None = Field(default=None, min_length=1, max_length=120)
    license_number: str | None = Field(default=None, max_length=120)
    team_name: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    is_active: bool | None = None


class DriverRead(TimestampedModel):
    driver_id: str
    driver_name: str
    aliases: list[str]
    active: bool
    first_name: str
    last_name: str
    license_number: str | None
    team_name: str | None
    notes: str | None
    is_active: bool
    created_by_id: UUID | None = None
