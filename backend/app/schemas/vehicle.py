from uuid import UUID

from pydantic import Field

from app.schemas.common import ORMModel, TimestampedModel


class VehicleCreate(ORMModel):
    vehicle_id: str | None = Field(default=None, max_length=64)
    driver_id: str | None = Field(default=None, max_length=32)
    make: str = Field(min_length=1, max_length=120)
    model: str = Field(min_length=1, max_length=120)
    year: int | None = Field(default=None, ge=1900, le=2100)
    vin: str | None = Field(default=None, max_length=120)
    registration_number: str | None = Field(default=None, max_length=120)
    vehicle_class: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    active: bool | None = None
    is_active: bool | None = None


class VehicleUpdate(ORMModel):
    vehicle_id: str | None = Field(default=None, max_length=64)
    driver_id: str | None = Field(default=None, max_length=32)
    make: str | None = Field(default=None, min_length=1, max_length=120)
    model: str | None = Field(default=None, min_length=1, max_length=120)
    year: int | None = Field(default=None, ge=1900, le=2100)
    vin: str | None = Field(default=None, max_length=120)
    registration_number: str | None = Field(default=None, max_length=120)
    vehicle_class: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    active: bool | None = None
    is_active: bool | None = None


class VehicleRead(TimestampedModel):
    vehicle_id: str
    driver_id: str | None = None
    make: str
    model: str
    year: int | None
    vin: str | None
    registration_number: str | None
    vehicle_class: str | None
    notes: str | None
    active: bool
    is_active: bool
