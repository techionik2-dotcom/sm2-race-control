import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship, synonym

from app.core.database import Base
from app.models.base import TimestampMixin


class Vehicle(Base, TimestampMixin):
    __tablename__ = "vehicles"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    driver_id: Mapped[str | None] = mapped_column(
        String(32),
        ForeignKey("drivers.driver_id", onupdate="CASCADE"),
        nullable=True,
    )
    make: Mapped[str] = mapped_column(String(120), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vin: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    registration_number: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    vehicle_class: Mapped[str | None] = mapped_column("class", String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    active = synonym("is_active")

    driver = relationship("Driver", back_populates="vehicles")
    submissions = relationship("Submission", back_populates="vehicle")
