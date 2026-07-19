"""track structured ingest status on submissions

Revision ID: 0015_structured_ingest_status
Revises: 0014_drop_session_idx
Create Date: 2026-04-28 22:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0015_structured_ingest_status"
down_revision = "0014_drop_session_idx"
branch_labels = None
depends_on = None

SCHEMA = "sm2racing"


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column(
            "structured_ingest_status",
            sa.String(length=32),
            nullable=False,
            server_default="skipped",
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "submissions",
        sa.Column("structured_ingest_warnings", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        "ck_submissions_structured_ingest_status",
        "submissions",
        "structured_ingest_status IN ('saved', 'saved_with_warnings', 'skipped')",
        schema=SCHEMA,
    )
    op.execute(
        """
        UPDATE sm2racing.submissions
        SET structured_ingest_status = 'skipped'
        WHERE structured_ingest_status IS NULL
        """
    )
    op.alter_column(
        "submissions",
        "structured_ingest_status",
        server_default=None,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_submissions_structured_ingest_status",
        "submissions",
        schema=SCHEMA,
        type_="check",
    )
    op.drop_column("submissions", "structured_ingest_warnings", schema=SCHEMA)
    op.drop_column("submissions", "structured_ingest_status", schema=SCHEMA)
