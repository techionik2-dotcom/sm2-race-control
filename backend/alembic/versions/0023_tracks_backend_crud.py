"""add backend-owned track metadata and archival fields

Revision ID: 0023_tracks_backend_crud
Revises: 0022_user_approval_status
Create Date: 2026-05-05 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0023_tracks_backend_crud"
down_revision = "0022_user_approval_status"
branch_labels = None
depends_on = None


TARGET_SCHEMA = "sm2racing"
TABLE_NAME = "tracks"


def upgrade() -> None:
    op.execute(
        sa.text(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.{TABLE_NAME}
                ADD COLUMN IF NOT EXISTS display_name varchar(255),
                ADD COLUMN IF NOT EXISTS short_code varchar(32),
                ADD COLUMN IF NOT EXISTS notes text,
                ADD COLUMN IF NOT EXISTS archived_at timestamptz
            """
        )
    )

    op.execute(
        sa.text(
            f"""
            UPDATE {TARGET_SCHEMA}.{TABLE_NAME}
            SET display_name = name
            WHERE display_name IS NULL OR btrim(display_name) = ''
            """
        )
    )

    op.execute(
        sa.text(
            f"""
            CREATE UNIQUE INDEX IF NOT EXISTS ux_tracks_name_ci
            ON {TARGET_SCHEMA}.{TABLE_NAME} (lower(name))
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            CREATE UNIQUE INDEX IF NOT EXISTS ux_tracks_short_code_ci
            ON {TARGET_SCHEMA}.{TABLE_NAME} (lower(short_code))
            WHERE short_code IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            f"DROP INDEX IF EXISTS {TARGET_SCHEMA}.ux_tracks_short_code_ci"
        )
    )
    op.execute(
        sa.text(
            f"DROP INDEX IF EXISTS {TARGET_SCHEMA}.ux_tracks_name_ci"
        )
    )
    op.drop_column(TABLE_NAME, "archived_at", schema=TARGET_SCHEMA)
    op.drop_column(TABLE_NAME, "notes", schema=TARGET_SCHEMA)
    op.drop_column(TABLE_NAME, "short_code", schema=TARGET_SCHEMA)
    op.drop_column(TABLE_NAME, "display_name", schema=TARGET_SCHEMA)
