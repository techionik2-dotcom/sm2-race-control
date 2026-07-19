from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import UserApprovalStatus, UserRole
from app.core.security import hash_password, password_needs_rehash, verify_password
from app.models.user import User
from app.schemas.auth import UserCreate, UserSignup

CANONICAL_OWNER_EMAIL = "admin@smracing.com"


def ensure_canonical_owner_access(db: Session, user: User | None) -> User | None:
    if user is None or user.email.lower() != CANONICAL_OWNER_EMAIL:
        return user

    changed = False
    if user.role != UserRole.OWNER:
        user.role = UserRole.OWNER
        changed = True
    if user.approval_status != UserApprovalStatus.APPROVED:
        user.approval_status = UserApprovalStatus.APPROVED
        changed = True
    if not user.is_active:
        user.is_active = True
        changed = True

    if changed:
        db.add(user)
        db.commit()
        db.refresh(user)

    return user


def create_user(
    db: Session,
    user_in: UserCreate | UserSignup,
    role: UserRole = UserRole.DRIVER,
    is_active: bool = True,
    approval_status: UserApprovalStatus | None = None,
) -> User:
    email = user_in.email.lower()
    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        raise ValueError("User already exists")

    next_approval_status = (
        approval_status
        if approval_status is not None
        else UserApprovalStatus.APPROVED
        if is_active
        else UserApprovalStatus.PENDING
    )

    user = User(
        name=user_in.name,
        email=email,
        hashed_password=hash_password(user_in.password),
        role=UserRole.OWNER if email == CANONICAL_OWNER_EMAIL else role,
        approval_status=(
            UserApprovalStatus.APPROVED
            if email == CANONICAL_OWNER_EMAIL
            else next_approval_status
        ),
        is_active=True if email == CANONICAL_OWNER_EMAIL else is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.lower()))


def authenticate_user(
    db: Session,
    email: str,
    password: str,
    allow_inactive: bool = False,
) -> User | None:
    user = get_user_by_email(db, email)
    if not user:
        return None
    user = ensure_canonical_owner_access(db, user)
    if not verify_password(password, user.hashed_password):
        return None
    if password_needs_rehash(user.hashed_password):
        user.hashed_password = hash_password(password)
        db.add(user)
        db.commit()
        db.refresh(user)
    if not allow_inactive and (
        not user.is_active or user.approval_status != UserApprovalStatus.APPROVED
    ):
        return None
    return user
