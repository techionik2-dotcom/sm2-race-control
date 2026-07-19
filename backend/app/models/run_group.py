import uuid

from sqlalchemy import Boolean, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, DB_SCHEMA
from app.core.enums import RunGroupCode
from app.models.base import TimestampMixin


class RunGroup(Base, TimestampMixin):
    __tablename__ = "run_groups"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), unique=True, nullable=False)
    raw_text: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized: Mapped[RunGroupCode] = mapped_column(
        Enum(RunGroupCode, name="run_group_code", schema=DB_SCHEMA),
        nullable=False,
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    event = relationship("Event", back_populates="run_group")
    created_by_user = relationship("User")
    submissions = relationship("Submission", back_populates="run_group")
