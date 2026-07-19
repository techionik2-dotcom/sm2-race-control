from datetime import datetime

from pydantic import Field

from app.schemas.common import ORMModel


class TrackCreate(ORMModel):
    name: str = Field(min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    short_code: str = Field(min_length=1, max_length=32)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    country: str = Field(min_length=1, max_length=120)
    notes: str | None = None
    active: bool | None = None
    is_active: bool | None = None


class TrackUpdate(ORMModel):
    name: str | None = Field(default=None, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    short_code: str | None = Field(default=None, max_length=32)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    country: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    active: bool | None = None
    is_active: bool | None = None


class TrackRead(ORMModel):
    name: str
    display_name: str | None = None
    short_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    country: str | None = None
    notes: str | None = None
    active: bool
    is_active: bool
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
