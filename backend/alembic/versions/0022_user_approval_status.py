"""add user approval status

Revision ID: 0022_user_approval_status
Revises: 0021_user_auth_audit_fields
Create Date: 2026-05-05 18:01:00.000000
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0022_user_approval_status"
down_revision = "0021_user_auth_audit_fields"
branch_labels = None
depends_on = None

SCHEMA = "sm2racing"
TYPE_NAME = "user_approval_status"


def upgrade() -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            CREATE TYPE {SCHEMA}.{TYPE_NAME} AS ENUM ('PENDING', 'APPROVED');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;
        """
    )
    op.execute(
        f"""
        ALTER TABLE {SCHEMA}.users
        ADD COLUMN IF NOT EXISTS approval_status {SCHEMA}.{TYPE_NAME} NOT NULL DEFAULT 'APPROVED'
        """
    )
    op.execute("CREATE OR REPLACE VIEW public.users AS SELECT * FROM sm2racing.users")


def downgrade() -> None:
    op.execute("CREATE OR REPLACE VIEW public.users AS SELECT * FROM sm2racing.users")
    op.execute(f"ALTER TABLE {SCHEMA}.users DROP COLUMN IF EXISTS approval_status")
    op.execute(f"DROP TYPE IF EXISTS {SCHEMA}.{TYPE_NAME}")
