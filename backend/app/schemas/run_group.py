from uuid import UUID

from pydantic import Field

from app.core.enums import RunGroupCode
from app.schemas.common import ORMModel, TimestampedModel


class RunGroupCreate(ORMModel):
    event_id: UUID
    raw_text: str = Field(min_length=1, max_length=255)


class RunGroupUpdate(ORMModel):
    raw_text: str = Field(min_length=1, max_length=255)
    locked: bool | None = None


class RunGroupRead(TimestampedModel):
    event_id: UUID
    raw_text: str
    normalized: RunGroupCode
    created_by_id: UUID
    locked: bool
