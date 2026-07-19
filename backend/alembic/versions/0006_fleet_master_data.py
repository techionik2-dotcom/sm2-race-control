"""fleet master data

Revision ID: 0006_fleet_master_data
Revises: 0005_event_notes
Create Date: 2026-04-22 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0006_fleet_master_data"
down_revision = "0005_event_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "drivers",
        sa.Column("driver_id", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "drivers",
        sa.Column("driver_name", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "drivers",
        sa.Column(
            "aliases",
            postgresql.ARRAY(sa.String(length=120)),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )
    op.add_column(
        "drivers",
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_drivers_driver_id", "drivers", ["driver_id"], unique=True)
    op.alter_column("drivers", "driver_id", nullable=False)
    op.alter_column("drivers", "driver_name", nullable=False)

    op.add_column(
        "vehicles",
        sa.Column("vehicle_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "vehicles",
        sa.Column("class", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "vehicles",
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.execute("ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_driver_id_fkey")
    op.alter_column(
        "vehicles",
        "driver_id",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(length=32),
        nullable=True,
        postgresql_using="driver_id::text",
    )
    op.create_foreign_key(
        "fk_vehicles_driver_id_drivers_driver_id",
        "vehicles",
        "drivers",
        ["driver_id"],
        ["driver_id"],
        onupdate="CASCADE",
    )
    op.create_index("ix_vehicles_driver_id", "vehicles", ["driver_id"], unique=False)
    op.create_index("ix_vehicles_vehicle_id", "vehicles", ["vehicle_id"], unique=True)
    op.alter_column("vehicles", "vehicle_id", nullable=False)


def downgrade() -> None:
    op.drop_index("ix_vehicles_vehicle_id", table_name="vehicles")
    op.drop_index("ix_vehicles_driver_id", table_name="vehicles")
    op.drop_constraint("fk_vehicles_driver_id_drivers_driver_id", "vehicles", type_="foreignkey")
    op.alter_column(
        "vehicles",
        "driver_id",
        existing_type=sa.String(length=32),
        type_=postgresql.UUID(as_uuid=True),
        nullable=True,
        postgresql_using="NULL::uuid",
    )
    op.create_foreign_key(
        "vehicles_driver_id_fkey",
        "vehicles",
        "drivers",
        ["driver_id"],
        ["id"],
    )
    op.drop_column("vehicles", "notes")
    op.drop_column("vehicles", "class")
    op.drop_column("vehicles", "vehicle_id")

    op.alter_column("drivers", "driver_name", nullable=True)
    op.alter_column("drivers", "driver_id", nullable=True)
    op.drop_column("drivers", "notes")
    op.drop_column("drivers", "aliases")
    op.drop_column("drivers", "driver_name")
    op.drop_index("ix_drivers_driver_id", table_name="drivers")
    op.drop_column("drivers", "driver_id")
