"""widen public submission text fields

Revision ID: 0008_submission_text_fields
Revises: 0007_sm2_tire_set
Create Date: 2026-04-22 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0008_submission_text_fields"
down_revision = "0007_sm2_tire_set"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE submissions
            ALTER COLUMN raw_text TYPE text USING raw_text::text,
            ALTER COLUMN image_url TYPE text USING image_url::text;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE submissions
            ALTER COLUMN raw_text TYPE varchar(1000) USING left(raw_text, 1000),
            ALTER COLUMN image_url TYPE varchar(1000) USING left(image_url, 1000);
        """
    )
