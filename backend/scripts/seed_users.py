from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import select, text


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.database import get_session_local
from app.core.enums import UserApprovalStatus, UserRole
from app.core.security import hash_password
from app.models.user import User


SEED_USERS = [
    {
        "name": "Admin",
        "email": "admin@smracing.com",
        "password": "123456",
        "role": UserRole.OWNER,
    },
    {
        "name": "Alex",
        "email": "alex@smracing.com",
        "password": "Alex@123",
        "role": UserRole.DRIVER,
    },
    {
        "name": "Mechanic",
        "email": "mec@smracing.com",
        "password": "Mech@123",
        "role": UserRole.DRIVER,
    },
]

LEGACY_OWNER_EMAIL = "owner@smracing.com"
CANONICAL_OWNER_EMAIL = "admin@smracing.com"
LEGACY_DRIVER_EMAIL = "driver@smracing.com"
CANONICAL_DRIVER_EMAIL = "mec@smracing.com"


def normalize_legacy_owner_account(db) -> None:
    legacy_owner = db.scalar(select(User).where(User.email == LEGACY_OWNER_EMAIL))
    if legacy_owner is None:
        return

    canonical_owner = db.scalar(select(User).where(User.email == CANONICAL_OWNER_EMAIL))
    if canonical_owner is not None and canonical_owner.id != legacy_owner.id:
        return

    legacy_owner.email = CANONICAL_OWNER_EMAIL
    legacy_owner.name = "Admin"
    legacy_owner.hashed_password = hash_password("123456")
    legacy_owner.role = UserRole.OWNER
    legacy_owner.approval_status = UserApprovalStatus.APPROVED
    legacy_owner.is_active = True
    db.flush()


def normalize_legacy_driver_account(db) -> None:
    legacy_driver = db.scalar(select(User).where(User.email == LEGACY_DRIVER_EMAIL))
    if legacy_driver is None:
        return

    canonical_driver = db.scalar(select(User).where(User.email == CANONICAL_DRIVER_EMAIL))
    if canonical_driver is not None and canonical_driver.id != legacy_driver.id:
        return

    legacy_driver.email = CANONICAL_DRIVER_EMAIL
    legacy_driver.name = "Mechanic"
    legacy_driver.hashed_password = hash_password("Mech@123")
    legacy_driver.role = UserRole.DRIVER
    legacy_driver.approval_status = UserApprovalStatus.APPROVED
    legacy_driver.is_active = True
    db.flush()


def normalize_role_aliases(db) -> None:
    schema = User.__table__.schema or "public"
    db.execute(
        text(f"UPDATE {schema}.users SET role = 'DRIVER' WHERE role::text IN ('MECHANIC', 'WORKER')")
    )
    db.execute(text(f"UPDATE {schema}.users SET role = 'OWNER' WHERE role::text = 'ADMIN'"))


def upsert_users() -> tuple[list[str], list[str]]:
    session_local = get_session_local()
    db = session_local()
    created: list[str] = []
    updated: list[str] = []

    try:
        normalize_role_aliases(db)
        normalize_legacy_owner_account(db)
        normalize_legacy_driver_account(db)

        for user_data in SEED_USERS:
            email = user_data["email"].lower()
            existing = db.scalar(select(User).where(User.email == email))

            if existing is None:
                db.add(
                    User(
                        name=user_data["name"],
                        email=email,
                        hashed_password=hash_password(user_data["password"]),
                        role=user_data["role"],
                        approval_status=UserApprovalStatus.APPROVED,
                        is_active=True,
                    )
                )
                created.append(email)
                continue

            existing.name = user_data["name"]
            existing.hashed_password = hash_password(user_data["password"])
            existing.role = user_data["role"]
            existing.approval_status = UserApprovalStatus.APPROVED
            existing.is_active = True
            updated.append(email)

        db.commit()
        return created, updated
    finally:
        db.close()


def main() -> None:
    created, updated = upsert_users()
    print({"created": created, "updated": updated})


if __name__ == "__main__":
    main()
