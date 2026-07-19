import uuid

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, JSON, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin


class EventParticipant(Base, TimestampMixin):
    __tablename__ = "event_participants"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), nullable=False)
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.id"), nullable=False)
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("vehicles.id"), nullable=True)
    baseline_setup: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    event = relationship("Event", back_populates="participants")
    driver = relationship("Driver")
    vehicle = relationship("Vehicle")
    sessions = relationship(
        "RaceSession",
        back_populates="participant",
        cascade="all, delete-orphan",
        order_by="RaceSession.session_number",
    )


class RaceSession(Base, TimestampMixin):
    __tablename__ = "race_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), nullable=False)
    participant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("event_participants.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    session_type: Mapped[str] = mapped_column(String(64), nullable=False)
    session_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PLANNED")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="schedule")
    setup_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    tire_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    lap_times: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    observations: Mapped[str | None] = mapped_column(Text, nullable=True)
    adjustments: Mapped[str | None] = mapped_column(Text, nullable=True)
    additional_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    carried_from_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("race_sessions.id"),
        nullable=True,
    )

    event = relationship("Event", back_populates="race_sessions")
    participant = relationship("EventParticipant", back_populates="sessions")
    carried_from_session = relationship("RaceSession", remote_side=[id])
    attachments = relationship(
        "SessionAttachment",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="SessionAttachment.created_at",
    )


class SessionAttachment(Base, TimestampMixin):
    __tablename__ = "session_attachments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("race_sessions.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    session = relationship("RaceSession", back_populates="attachments")
