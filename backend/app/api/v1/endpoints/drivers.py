from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.core.enums import UserRole
from app.core.fleet_ids import generate_driver_id, normalize_aliases, normalize_text, split_name
from app.models.driver import Driver
from app.models.user import User
from app.schemas.driver import DriverCreate, DriverRead, DriverUpdate


router = APIRouter()


@router.get("", response_model=list[DriverRead])
def list_drivers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[Driver]:
    return list(db.scalars(select(Driver).order_by(Driver.created_at.desc())).all())


def _resolve_driver_values(
    db: Session,
    driver_in: DriverCreate | DriverUpdate,
    existing: Driver | None = None,
) -> dict:
    payload = driver_in.model_dump(exclude_unset=True)

    explicit_name = normalize_text(payload.get("driver_name"))
    first_name = normalize_text(payload.get("first_name"))
    last_name = normalize_text(payload.get("last_name"))
    team_name = normalize_text(payload.get("team_name"))

    if explicit_name:
        driver_name = explicit_name
    elif first_name or last_name:
        driver_name = " ".join(part for part in [first_name, last_name] if part).strip()
    elif existing is not None:
        driver_name = existing.driver_name
    elif team_name:
        driver_name = team_name
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver name is required")

    if not first_name and not last_name:
        if existing is not None and not payload:
            first_name = existing.first_name
            last_name = existing.last_name
        else:
            first_name, last_name = split_name(driver_name)

    if existing is not None:
        if "driver_id" in payload and normalize_text(payload.get("driver_id")) and payload["driver_id"] != existing.driver_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver ID cannot be changed")
        driver_id = existing.driver_id
    else:
        driver_id = normalize_text(payload.get("driver_id")) or generate_driver_id(
            driver_name,
            first_name=first_name,
            last_name=last_name,
        )

    if existing is None:
        existing_code = db.scalar(select(Driver).where(Driver.driver_id == driver_id))
        if existing_code is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Driver ID already exists")

    if existing is not None:
        aliases = existing.aliases
        if "aliases" in payload:
            aliases = normalize_aliases(payload.get("aliases"))
        notes = existing.notes
        if "notes" in payload:
            notes = normalize_text(payload.get("notes")) or None
        license_number = existing.license_number
        if "license_number" in payload:
            license_number = normalize_text(payload.get("license_number")) or None
        team_name_value = existing.team_name
        if "team_name" in payload:
            team_name_value = team_name or None
        active_value = existing.is_active
        if "active" in payload:
            active_value = payload.get("active")
        elif "is_active" in payload:
            active_value = payload.get("is_active")
    else:
        aliases = normalize_aliases(payload.get("aliases"))
        notes = normalize_text(payload.get("notes")) or None
        license_number = normalize_text(payload.get("license_number")) or None
        team_name_value = team_name or None
        active_value = payload.get("active")
        if active_value is None and "is_active" in payload:
            active_value = payload.get("is_active")
        if active_value is None:
            active_value = True

    return {
        "driver_id": driver_id,
        "driver_name": driver_name,
        "first_name": first_name,
        "last_name": last_name,
        "license_number": license_number,
        "team_name": team_name_value,
        "aliases": aliases,
        "notes": notes,
        "is_active": bool(active_value),
    }


@router.post("", response_model=DriverRead, status_code=status.HTTP_201_CREATED)
def create_driver(
    driver_in: DriverCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER)),
) -> Driver:
    values = _resolve_driver_values(db, driver_in)
    driver = Driver(**values, created_by_id=current_user.id)
    db.add(driver)
    db.commit()
    db.refresh(driver)
    return driver


@router.get("/{driver_id}", response_model=DriverRead)
def read_driver(
    driver_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Driver:
    driver = db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")
    return driver


@router.put("/{driver_id}", response_model=DriverRead)
def update_driver(
    driver_id: UUID,
    driver_in: DriverUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER)),
) -> Driver:
    driver = db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")

    values = _resolve_driver_values(db, driver_in, existing=driver)
    for key, value in values.items():
        setattr(driver, key, value)

    db.commit()
    db.refresh(driver)
    return driver
