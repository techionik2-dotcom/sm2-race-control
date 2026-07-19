from datetime import datetime
from uuid import UUID

from pydantic import EmailStr, Field

from app.core.enums import UserApprovalStatus, UserRole
from app.schemas.common import ORMModel, TimestampedModel


class UserCreate(ORMModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.DRIVER


class UserSignup(ORMModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserLogin(ORMModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserPasswordReset(ORMModel):
    password: str = Field(min_length=8, max_length=128)


class UserRoleUpdate(ORMModel):
    role: UserRole


class UserRead(TimestampedModel):
    name: str
    email: EmailStr
    role: UserRole
    approval_status: UserApprovalStatus
    is_active: bool
    last_login_at: datetime | None = None
    last_logout_at: datetime | None = None
    active_event_id: UUID | None = None


class Token(ORMModel):
    access_token: str
    token_type: str = "bearer"
