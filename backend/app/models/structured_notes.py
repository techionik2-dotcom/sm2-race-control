from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, Numeric, SmallInteger, String, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.db_schema import SM2RACING_SCHEMA
from app.core.enums import SeanceStatus, TireInventoryStatus
from app.models.track import Track


class TireInventory(Base):
    __tablename__ = "tire_inventory"
    __table_args__ = {"schema": SM2RACING_SCHEMA}

    tire_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    manufacturer: Mapped[str] = mapped_column(String(255), nullable=False)
    model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[str | None] = mapped_column(String(64), nullable=True)
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    heat_cycles: Mapped[int | None] = mapped_column(Integer, nullable=True)
    track_time_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[TireInventoryStatus] = mapped_column(
        Enum(TireInventoryStatus, name="sm2_tire_inventory_status", schema=SM2RACING_SCHEMA),
        nullable=False,
        default=TireInventoryStatus.ACTIVE,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class Seance(Base):
    __tablename__ = "seances"
    __table_args__ = {"schema": SM2RACING_SCHEMA}

    id_seance: Mapped[str] = mapped_column(String(120), primary_key=True)
    session_date: Mapped[date] = mapped_column(Date, nullable=False)
    session_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    track: Mapped[str] = mapped_column(
        String(255),
        ForeignKey(f"{SM2RACING_SCHEMA}.tracks.name", onupdate="CASCADE"),
        nullable=False,
    )
    driver_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey(f"{SM2RACING_SCHEMA}.drivers.driver_id", onupdate="CASCADE"),
        nullable=False,
    )
    vehicle_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(f"{SM2RACING_SCHEMA}.vehicles.vehicle_id", onupdate="CASCADE"),
        nullable=False,
    )
    session_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    session_number: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tire_set: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    status: Mapped[SeanceStatus] = mapped_column(
        Enum(SeanceStatus, name="sm2_status", schema=SM2RACING_SCHEMA),
        nullable=False,
        default=SeanceStatus.ACTIVE,
    )


class Pressure(Base):
    __tablename__ = "pressures"
    __table_args__ = {"schema": SM2RACING_SCHEMA}

    id_seance: Mapped[str] = mapped_column(
        String(120),
        ForeignKey(f"{SM2RACING_SCHEMA}.seances.id_seance", ondelete="CASCADE"),
        primary_key=True,
    )
    cold_fl: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    cold_fr: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    cold_rl: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    cold_rr: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    hot_fl: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    hot_fr: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    hot_rl: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    hot_rr: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)


class Suspension(Base):
    __tablename__ = "suspensions"
    __table_args__ = {"schema": SM2RACING_SCHEMA}

    id_seance: Mapped[str] = mapped_column(
        String(120),
        ForeignKey(f"{SM2RACING_SCHEMA}.seances.id_seance", ondelete="CASCADE"),
        primary_key=True,
    )
    rebound_fl: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    rebound_fr: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    rebound_rl: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    rebound_rr: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    bump_fl: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    bump_fr: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    bump_rl: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    bump_rr: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    sway_bar_f: Mapped[str | None] = mapped_column(Text, nullable=True)
    sway_bar_r: Mapped[str | None] = mapped_column(Text, nullable=True)
    wing_angle_deg: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)


class Alignment(Base):
    __tablename__ = "alignment"
    __table_args__ = {"schema": SM2RACING_SCHEMA}

    id_seance: Mapped[str] = mapped_column(
        String(120),
        ForeignKey(f"{SM2RACING_SCHEMA}.seances.id_seance", ondelete="CASCADE"),
        primary_key=True,
    )
    camber_fl: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    camber_fr: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    camber_rl: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    camber_rr: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    toe_front: Mapped[str | None] = mapped_column(Text, nullable=True)
    toe_rear: Mapped[str | None] = mapped_column(Text, nullable=True)
    caster_l: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    caster_r: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    ride_height_f: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    ride_height_r: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    corner_weight_fl: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    corner_weight_fr: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    corner_weight_rl: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    corner_weight_rr: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    cross_weight_pct: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    rake_mm: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    wheelbase_mm: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)


class TireTemperature(Base):
    __tablename__ = "tire_temperatures"
    __table_args__ = {"schema": SM2RACING_SCHEMA}

    id_seance: Mapped[str] = mapped_column(
        String(120),
        ForeignKey(f"{SM2RACING_SCHEMA}.seances.id_seance", ondelete="CASCADE"),
        primary_key=True,
    )
    fl_in: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    fl_mid: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    fl_out: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    fr_in: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    fr_mid: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    fr_out: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    rl_in: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    rl_mid: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    rl_out: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    rr_in: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    rr_mid: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    rr_out: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(Text, nullable=True)


class TireHistory(Base):
    __tablename__ = "tire_history"
    __table_args__ = {"schema": SM2RACING_SCHEMA}

    tire_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(f"{SM2RACING_SCHEMA}.tire_inventory.tire_id", onupdate="CASCADE"),
        primary_key=True,
    )
    id_seance: Mapped[str] = mapped_column(
        String(120),
        ForeignKey(f"{SM2RACING_SCHEMA}.seances.id_seance", ondelete="CASCADE"),
        primary_key=True,
    )
    usage_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    track: Mapped[str | None] = mapped_column(
        String(255),
        ForeignKey(f"{SM2RACING_SCHEMA}.tracks.name", onupdate="CASCADE"),
        nullable=True,
    )
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
