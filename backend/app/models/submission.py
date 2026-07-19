import uuid

from sqlalchemy import Enum, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, DB_SCHEMA
from app.core.enums import SubmissionStatus
from app.models.base import TimestampMixin


class Submission(Base, TimestampMixin):
    __tablename__ = "submissions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    submission_ref: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), nullable=False)
    run_group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("run_groups.id"), nullable=False)
    driver_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("drivers.id"), nullable=True)
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("vehicles.id"), nullable=True)
    voice_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("voice_note_sessions.id", ondelete="SET NULL"),
        unique=True,
        nullable=True,
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(36), unique=True, index=True, nullable=True)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    analysis_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    structured_ingest_status: Mapped[str] = mapped_column(String(32), nullable=False, default="skipped")
    structured_ingest_warnings: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[SubmissionStatus] = mapped_column(
        Enum(SubmissionStatus, name="submission_status", schema=DB_SCHEMA),
        nullable=False,
        default=SubmissionStatus.PENDING,
    )
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    event = relationship("Event", back_populates="submissions")
    run_group = relationship("RunGroup", back_populates="submissions")
    driver = relationship("Driver", back_populates="submissions")
    vehicle = relationship("Vehicle", back_populates="submissions")
    created_by_user = relationship("User", back_populates="submissions")
    voice_session = relationship(
        "VoiceNoteSession",
        foreign_keys=[voice_session_id],
        uselist=False,
    )
