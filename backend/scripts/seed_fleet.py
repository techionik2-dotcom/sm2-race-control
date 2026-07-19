from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import select


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.database import get_session_local
from app.core.fleet_ids import split_name
from app.models.driver import Driver
from app.models.vehicle import Vehicle


SEED_DRIVERS = [
    {
        "driver_id": "NG",
        "driver_name": "Nicolas Guigère",
        "aliases": ["nicolas", "nico"],
        "active": True,
    },
    {
        "driver_id": "JFB",
        "driver_name": "J-F Breton",
        "aliases": ["jf", "jeff"],
        "active": True,
    },
    {
        "driver_id": "JA",
        "driver_name": "Jean Audet",
        "aliases": ["jean"],
        "active": True,
    },
]


SEED_VEHICLES = [
    {
        "vehicle_id": "NG-GT4-2025",
        "driver_id": "NG",
        "make": "Porsche",
        "model": "GT4 RS Clubsport",
        "year": 2025,
        "vehicle_class": "GT4",
        "notes": None,
        "active": True,
    },
    {
        "vehicle_id": "JFB-GT4-2025",
        "driver_id": "JFB",
        "make": "Porsche",
        "model": "GT4 RS Clubsport",
        "year": 2025,
        "vehicle_class": "GT4",
        "notes": None,
        "active": True,
    },
    {
        "vehicle_id": "JA-997-2012",
        "driver_id": "JA",
        "make": "Porsche",
        "model": "997.2 Cup",
        "year": 2012,
        "vehicle_class": "Cup",
        "notes": None,
        "active": True,
    },
    {
        "vehicle_id": "JA-400Z-2025",
        "driver_id": "JA",
        "make": "Nissan",
        "model": "400Z",
        "year": 2025,
        "vehicle_class": None,
        "notes": None,
        "active": True,
    },
    {
        "vehicle_id": "JA-MICRA-2017",
        "driver_id": "JA",
        "make": "Nissan",
        "model": "Micra",
        "year": 2017,
        "vehicle_class": None,
        "notes": None,
        "active": True,
    },
]


def upsert_drivers() -> tuple[list[str], list[str]]:
    session_local = get_session_local()
    db = session_local()
    created: list[str] = []
    updated: list[str] = []

    try:
        for entry in SEED_DRIVERS:
            driver_code = entry["driver_id"].strip().upper()
            driver_name = entry["driver_name"].strip()
            first_name, last_name = split_name(driver_name)
            existing = db.scalar(select(Driver).where(Driver.driver_id == driver_code))

            if existing is None:
                db.add(
                    Driver(
                        driver_id=driver_code,
                        driver_name=driver_name,
                        aliases=list(entry["aliases"]),
                        first_name=first_name,
                        last_name=last_name,
                        license_number=None,
                        team_name=None,
                        notes=None,
                        is_active=bool(entry["active"]),
                    )
                )
                created.append(driver_code)
                continue

            existing.driver_name = driver_name
            existing.aliases = list(entry["aliases"])
            existing.first_name = first_name
            existing.last_name = last_name
            existing.license_number = None
            existing.team_name = None
            existing.notes = None
            existing.is_active = bool(entry["active"])
            updated.append(driver_code)

        db.commit()
        return created, updated
    finally:
        db.close()


def upsert_vehicles() -> tuple[list[str], list[str]]:
    session_local = get_session_local()
    db = session_local()
    created: list[str] = []
    updated: list[str] = []

    try:
        for entry in SEED_VEHICLES:
            vehicle_code = entry["vehicle_id"].strip().upper()
            driver_code = entry["driver_id"].strip().upper()
            driver = db.scalar(select(Driver).where(Driver.driver_id == driver_code))
            if driver is None:
                raise RuntimeError(f"Missing driver {driver_code} for vehicle {vehicle_code}")

            existing = db.scalar(select(Vehicle).where(Vehicle.vehicle_id == vehicle_code))
            if existing is None:
                db.add(
                    Vehicle(
                        vehicle_id=vehicle_code,
                        driver_id=driver_code,
                        make=entry["make"],
                        model=entry["model"],
                        year=entry["year"],
                        vehicle_class=entry["vehicle_class"],
                        notes=entry["notes"],
                        is_active=bool(entry["active"]),
                    )
                )
                created.append(vehicle_code)
                continue

            existing.driver_id = driver_code
            existing.make = entry["make"]
            existing.model = entry["model"]
            existing.year = entry["year"]
            existing.vehicle_class = entry["vehicle_class"]
            existing.notes = entry["notes"]
            existing.is_active = bool(entry["active"])
            updated.append(vehicle_code)

        db.commit()
        return created, updated
    finally:
        db.close()


def main() -> None:
    created_drivers, updated_drivers = upsert_drivers()
    created_vehicles, updated_vehicles = upsert_vehicles()
    print(
        {
            "drivers_created": created_drivers,
            "drivers_updated": updated_drivers,
            "vehicles_created": created_vehicles,
            "vehicles_updated": updated_vehicles,
        }
    )


if __name__ == "__main__":
    main()
