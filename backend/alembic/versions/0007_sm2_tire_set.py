"""add tire set to sm2 seances

Revision ID: 0007_sm2_tire_set
Revises: 0006_fleet_master_data
Create Date: 2026-04-22 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0007_sm2_tire_set"
down_revision = "0006_fleet_master_data"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE sm2.seances
            ADD COLUMN IF NOT EXISTS tire_set text;
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'seances_tire_set_check'
                  AND conrelid = 'sm2.seances'::regclass
            ) THEN
                ALTER TABLE sm2.seances
                    ADD CONSTRAINT seances_tire_set_check
                    CHECK (tire_set IS NULL OR btrim(tire_set) <> '');
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE sm2.seances
            DROP CONSTRAINT IF EXISTS seances_tire_set_check,
            DROP COLUMN IF EXISTS tire_set;
        """
    )
