"""add user approval and rejection audit fields

Revision ID: 0027_user_approval_audit
Revises: 0026_event_first_workflow
Create Date: 2026-07-19 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0027_user_approval_audit"
down_revision = "0026_event_first_workflow"
branch_labels = None
depends_on = None

SCHEMA = "sm2racing"
TYPE_NAME = "user_approval_status"
TABLE_NAME = "users"
PUBLIC_USERS_VIEW = "public.users"


def upgrade() -> None:
    op.execute(f"DROP VIEW IF EXISTS {PUBLIC_USERS_VIEW}")

    with op.get_context().autocommit_block():
        op.execute(
            f"ALTER TYPE {SCHEMA}.{TYPE_NAME} ADD VALUE IF NOT EXISTS 'REJECTED'"
        )

    op.add_column(
        TABLE_NAME,
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        TABLE_NAME,
        sa.Column("approved_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        TABLE_NAME,
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        TABLE_NAME,
        sa.Column("rejected_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )

    op.create_foreign_key(
        "fk_users_approved_by_id_users",
        TABLE_NAME,
        TABLE_NAME,
        ["approved_by_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_users_rejected_by_id_users",
        TABLE_NAME,
        TABLE_NAME,
        ["rejected_by_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="SET NULL",
    )

    op.execute(f"CREATE OR REPLACE VIEW {PUBLIC_USERS_VIEW} AS SELECT * FROM {SCHEMA}.{TABLE_NAME}")


def downgrade() -> None:
    op.execute(f"DROP VIEW IF EXISTS {PUBLIC_USERS_VIEW}")
    op.drop_constraint(
        "fk_users_rejected_by_id_users",
        TABLE_NAME,
        type_="foreignkey",
        schema=SCHEMA,
    )
    op.drop_constraint(
        "fk_users_approved_by_id_users",
        TABLE_NAME,
        type_="foreignkey",
        schema=SCHEMA,
    )
    op.drop_column(TABLE_NAME, "rejected_by_id", schema=SCHEMA)
    op.drop_column(TABLE_NAME, "rejected_at", schema=SCHEMA)
    op.drop_column(TABLE_NAME, "approved_by_id", schema=SCHEMA)
    op.drop_column(TABLE_NAME, "approved_at", schema=SCHEMA)
    op.execute(f"CREATE OR REPLACE VIEW {PUBLIC_USERS_VIEW} AS SELECT * FROM {SCHEMA}.{TABLE_NAME}")
