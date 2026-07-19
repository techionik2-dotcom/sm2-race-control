"""add seance status default

Revision ID: 0029_seance_status_default
Revises: 0028_seance_identity_constraint
Create Date: 2026-07-19 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "0029_seance_status_default"
down_revision = "0028_seance_identity_constraint"
branch_labels = None
depends_on = None

SCHEMA = "sm2racing"
TABLE_NAME = "seances"


def upgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE {SCHEMA}.{TABLE_NAME}
            ALTER COLUMN status SET DEFAULT 'ACTIVE'::{SCHEMA}.sm2_status
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE {SCHEMA}.{TABLE_NAME}
            ALTER COLUMN status DROP DEFAULT
        """
    )
