"""rename user roles to owner and driver

Revision ID: 0024_owner_driver_roles
Revises: 0023_tracks_backend_crud
Create Date: 2026-05-06 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0024_owner_driver_roles"
down_revision = "0023_tracks_backend_crud"
branch_labels = None
depends_on = None


TARGET_SCHEMA = "sm2racing"
TABLE_NAME = "users"
TYPE_NAME = "user_role"
PUBLIC_USERS_VIEW = "public.users"


def upgrade() -> None:
    op.execute(f"DROP VIEW IF EXISTS {PUBLIC_USERS_VIEW}")
    op.execute(f"ALTER TABLE {TARGET_SCHEMA}.{TABLE_NAME} ALTER COLUMN role DROP DEFAULT")
    op.execute(
        f"""
        ALTER TABLE {TARGET_SCHEMA}.{TABLE_NAME}
        ALTER COLUMN role TYPE text
        USING CASE
            WHEN role::text IN ('OWNER', 'ADMIN') THEN 'OWNER'
            WHEN role::text IN ('MECHANIC', 'WORKER') THEN 'DRIVER'
            ELSE upper(role::text)
        END
        """
    )
    op.execute(f"DROP TYPE IF EXISTS {TARGET_SCHEMA}.{TYPE_NAME}")
    op.execute(f"CREATE TYPE {TARGET_SCHEMA}.{TYPE_NAME} AS ENUM ('OWNER', 'DRIVER')")
    op.execute(
        f"""
        ALTER TABLE {TARGET_SCHEMA}.{TABLE_NAME}
        ALTER COLUMN role TYPE {TARGET_SCHEMA}.{TYPE_NAME}
        USING role::{TARGET_SCHEMA}.{TYPE_NAME}
        """
    )
    op.execute(
        f"""
        ALTER TABLE {TARGET_SCHEMA}.{TABLE_NAME}
        ALTER COLUMN role SET DEFAULT 'DRIVER'::{TARGET_SCHEMA}.{TYPE_NAME}
        """
    )
    op.execute(f"CREATE OR REPLACE VIEW {PUBLIC_USERS_VIEW} AS SELECT * FROM {TARGET_SCHEMA}.{TABLE_NAME}")


def downgrade() -> None:
    op.execute(f"DROP VIEW IF EXISTS {PUBLIC_USERS_VIEW}")
    op.execute(f"ALTER TABLE {TARGET_SCHEMA}.{TABLE_NAME} ALTER COLUMN role DROP DEFAULT")
    op.execute(
        f"""
        ALTER TABLE {TARGET_SCHEMA}.{TABLE_NAME}
        ALTER COLUMN role TYPE text
        USING CASE
            WHEN role::text = 'OWNER' THEN 'OWNER'
            ELSE 'MECHANIC'
        END
        """
    )
    op.execute(f"DROP TYPE IF EXISTS {TARGET_SCHEMA}.{TYPE_NAME}")
    op.execute(f"CREATE TYPE {TARGET_SCHEMA}.{TYPE_NAME} AS ENUM ('OWNER', 'MECHANIC', 'ADMIN')")
    op.execute(
        f"""
        ALTER TABLE {TARGET_SCHEMA}.{TABLE_NAME}
        ALTER COLUMN role TYPE {TARGET_SCHEMA}.{TYPE_NAME}
        USING role::{TARGET_SCHEMA}.{TYPE_NAME}
        """
    )
    op.execute(
        f"""
        ALTER TABLE {TARGET_SCHEMA}.{TABLE_NAME}
        ALTER COLUMN role SET DEFAULT 'MECHANIC'::{TARGET_SCHEMA}.{TYPE_NAME}
        """
    )
    op.execute(f"CREATE OR REPLACE VIEW {PUBLIC_USERS_VIEW} AS SELECT * FROM {TARGET_SCHEMA}.{TABLE_NAME}")
