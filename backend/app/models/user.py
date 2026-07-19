import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, DB_SCHEMA
from app.core.enums import UserApprovalStatus, UserRole
from app.models.base import TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", schema=DB_SCHEMA),
        default=UserRole.DRIVER,
        nullable=False,
    )
    approval_status: Mapped[UserApprovalStatus] = mapped_column(
        Enum(UserApprovalStatus, name="user_approval_status", schema=DB_SCHEMA),
        default=UserApprovalStatus.APPROVED,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_logout_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    active_event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("events.id"), nullable=True)

    active_event = relationship("Event", foreign_keys=[active_event_id], lazy="joined")
    created_events = relationship("Event", back_populates="created_by_user", foreign_keys="Event.created_by_id")
    submissions = relationship("Submission", back_populates="created_by_user", foreign_keys="Submission.created_by_id")
