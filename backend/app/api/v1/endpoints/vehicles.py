from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.core.enums import UserRole
from app.core.fleet_ids import generate_vehicle_id, normalize_text
from app.models.driver import Driver
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.vehicle import VehicleCreate, VehicleRead, VehicleUpdate


router = APIRouter()


@router.get("", response_model=list[VehicleRead])
def list_vehicles(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[Vehicle]:
    return list(db.scalars(select(Vehicle).order_by(Vehicle.created_at.desc())).all())


def _resolve_vehicle_values(
    db: Session,
    vehicle_in: VehicleCreate | VehicleUpdate,
    existing: Vehicle | None = None,
) -> dict:
    payload = vehicle_in.model_dump(exclude_unset=True)

    driver_id = normalize_text(payload.get("driver_id"))
    vehicle_id = normalize_text(payload.get("vehicle_id"))
    make = normalize_text(payload.get("make")) or (existing.make if existing is not None else "")
    model = normalize_text(payload.get("model")) or (existing.model if existing is not None else "")
    year = payload.get("year")
    if year is None and existing is not None:
        year = existing.year
    vehicle_class = normalize_text(payload.get("vehicle_class")) or None
    notes = normalize_text(payload.get("notes")) or None

    if existing is not None:
        if "vehicle_id" in payload and vehicle_id and vehicle_id != existing.vehicle_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Vehicle ID cannot be changed")
        vehicle_id = existing.vehicle_id
    elif not vehicle_id:
        vehicle_id = generate_vehicle_id(driver_id, make=make, model=model, year=year)

    if existing is None:
        existing_code = db.scalar(select(Vehicle).where(Vehicle.vehicle_id == vehicle_id))
        if existing_code is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Vehicle ID already exists")

    if driver_id:
        driver = db.scalar(select(Driver).where(Driver.driver_id == driver_id))
        if driver is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")
    elif existing is not None:
        driver_id = existing.driver_id

    active_value = payload.get("active")
    if active_value is None and "is_active" in payload:
        active_value = payload.get("is_active")
    if active_value is None:
        active_value = existing.is_active if existing is not None else True

    vin = normalize_text(payload.get("vin")) or None
    registration_number = normalize_text(payload.get("registration_number")) or None
    if existing is not None:
        if "vin" not in payload:
            vin = existing.vin
        if "registration_number" not in payload:
            registration_number = existing.registration_number
        if "vehicle_class" not in payload:
            vehicle_class = existing.vehicle_class
        if "notes" not in payload:
            notes = existing.notes

    return {
        "vehicle_id": vehicle_id,
        "driver_id": driver_id or None,
        "make": make,
        "model": model,
        "year": year,
        "vin": vin,
        "registration_number": registration_number,
        "vehicle_class": vehicle_class,
        "notes": notes,
        "is_active": bool(active_value),
    }


@router.post("", response_model=VehicleRead, status_code=status.HTTP_201_CREATED)
def create_vehicle(
    vehicle_in: VehicleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER)),
) -> Vehicle:
    values = _resolve_vehicle_values(db, vehicle_in)
    vehicle = Vehicle(**values)
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.get("/{vehicle_id}", response_model=VehicleRead)
def read_vehicle(
    vehicle_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Vehicle:
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    return vehicle


@router.put("/{vehicle_id}", response_model=VehicleRead)
def update_vehicle(
    vehicle_id: UUID,
    vehicle_in: VehicleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER)),
) -> Vehicle:
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")

    values = _resolve_vehicle_values(db, vehicle_in, existing=vehicle)
    for key, value in values.items():
        setattr(vehicle, key, value)

    db.commit()
    db.refresh(vehicle)
    return vehicle
