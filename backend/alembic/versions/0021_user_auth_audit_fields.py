"""add user auth audit timestamps

Revision ID: 0021_user_auth_audit_fields
Revises: 0020_voice_notes
Create Date: 2026-05-05 18:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0021_user_auth_audit_fields"
down_revision = "0020_voice_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("last_logout_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("CREATE OR REPLACE VIEW public.users AS SELECT * FROM sm2racing.users")


def downgrade() -> None:
    op.execute("CREATE OR REPLACE VIEW public.users AS SELECT * FROM sm2racing.users")
    op.drop_column("users", "last_logout_at")
    op.drop_column("users", "last_login_at")
