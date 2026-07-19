"""add seance session identity constraint

Revision ID: 0028_seance_identity_constraint
Revises: 0027_user_approval_audit
Create Date: 2026-07-19 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "0028_seance_identity_constraint"
down_revision = "0027_user_approval_audit"
branch_labels = None
depends_on = None

SCHEMA = "sm2racing"
TABLE_NAME = "seances"
CONSTRAINT_NAME = "uq_session_identity"


def upgrade() -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint constraint_record
                JOIN pg_class table_record
                    ON table_record.oid = constraint_record.conrelid
                JOIN pg_namespace schema_record
                    ON schema_record.oid = table_record.relnamespace
                WHERE schema_record.nspname = '{SCHEMA}'
                  AND table_record.relname = '{TABLE_NAME}'
                  AND constraint_record.conname = '{CONSTRAINT_NAME}'
            ) THEN
                ALTER TABLE {SCHEMA}.{TABLE_NAME}
                    ADD CONSTRAINT {CONSTRAINT_NAME}
                    UNIQUE (
                        session_date,
                        session_time,
                        track,
                        driver_id,
                        vehicle_id,
                        session_type,
                        session_number
                    );
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        f"ALTER TABLE {SCHEMA}.{TABLE_NAME} DROP CONSTRAINT IF EXISTS {CONSTRAINT_NAME}"
    )
