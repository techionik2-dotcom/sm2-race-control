"""add status to structured audit logs

Revision ID: 0018_logs_status
Revises: 0017_tire_status
Create Date: 2026-04-29 00:05:00.000000
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0018_logs_status"
down_revision = "0017_tire_status"
branch_labels = None
depends_on = None

SCHEMA = "sm2racing"


def upgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE {SCHEMA}.logs
        ADD COLUMN IF NOT EXISTS status text
        """
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {SCHEMA}.logs DROP COLUMN IF EXISTS status")
