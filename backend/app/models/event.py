import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin


class Event(Base, TimestampMixin):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    track: Mapped[str] = mapped_column(String(255), nullable=False)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_by_user = relationship("User", back_populates="created_events", foreign_keys=[created_by_id])
    run_group = relationship("RunGroup", back_populates="event", uselist=False)
    submissions = relationship("Submission", back_populates="event")
    participants = relationship(
        "EventParticipant",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by="EventParticipant.created_at",
    )
    race_sessions = relationship(
        "RaceSession",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by="RaceSession.session_number",
    )
