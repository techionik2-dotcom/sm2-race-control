"""add tire inventory status

Revision ID: 0017_tire_status
Revises: 0016_warnings_default
Create Date: 2026-04-28 23:55:00.000000
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0017_tire_status"
down_revision = "0016_warnings_default"
branch_labels = None
depends_on = None

SCHEMA = "sm2racing"
TYPE_NAME = "sm2_tire_inventory_status"


def upgrade() -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            CREATE TYPE {SCHEMA}.{TYPE_NAME} AS ENUM ('ACTIVE', 'DISCARDED');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;
        """
    )
    op.execute(
        f"""
        ALTER TABLE {SCHEMA}.tire_inventory
        ADD COLUMN IF NOT EXISTS status {SCHEMA}.{TYPE_NAME} NOT NULL DEFAULT 'ACTIVE'
        """
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {SCHEMA}.tire_inventory DROP COLUMN IF EXISTS status")
    op.execute(f"DROP TYPE IF EXISTS {SCHEMA}.{TYPE_NAME}")
