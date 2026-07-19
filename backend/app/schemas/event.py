from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.common import ORMModel, TimestampedModel


class EventCreate(ORMModel):
    name: str = Field(min_length=1, max_length=255)
    track: str = Field(min_length=1, max_length=255)
    start_date: datetime
    end_date: datetime
    run_group_raw_text: str = Field(min_length=1, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)


class EventUpdate(ORMModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    track: str | None = Field(default=None, min_length=1, max_length=255)
    start_date: datetime | None = None
    end_date: datetime | None = None
    run_group_raw_text: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None


class EventRead(TimestampedModel):
    name: str
    track: str
    start_date: datetime
    end_date: datetime
    notes: str | None = None
    created_by_id: UUID
    is_active: bool
