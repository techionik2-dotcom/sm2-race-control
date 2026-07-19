"""default structured ingest warnings to an empty list

Revision ID: 0016_warnings_default
Revises: 0015_structured_ingest_status
Create Date: 2026-04-28 23:45:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0016_warnings_default"
down_revision = "0015_structured_ingest_status"
branch_labels = None
depends_on = None

SCHEMA = "sm2racing"


def upgrade() -> None:
    op.execute(
        """
        UPDATE sm2racing.submissions
        SET structured_ingest_warnings = '[]'::jsonb
        WHERE structured_ingest_warnings IS NULL
        """
    )
    op.alter_column(
        "submissions",
        "structured_ingest_warnings",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        nullable=False,
        server_default=sa.text("'[]'::jsonb"),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.alter_column(
        "submissions",
        "structured_ingest_warnings",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        nullable=True,
        server_default=None,
        schema=SCHEMA,
    )
