"""drop scoped submission fingerprint index

Revision ID: 0014_drop_session_idx
Revises: 0013_repeat_notes
Create Date: 2026-04-27 18:15:00.000000
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0014_drop_session_idx"
down_revision = "0013_repeat_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS sm2racing.uq_submissions_session_fingerprint")


def downgrade() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_submissions_session_fingerprint
        ON sm2racing.submissions (
            event_id,
            COALESCE(driver_id::text, ''),
            COALESCE(vehicle_id::text, ''),
            lower(COALESCE(payload->'data'->>'track', payload->>'track', '')),
            lower(COALESCE(payload->'data'->>'session_type', payload->>'session_type', 'practice')),
            COALESCE(payload->'data'->>'session_id', payload->>'session_id', submission_ref),
            COALESCE(payload->'data'->>'date', payload->>'date', ''),
            COALESCE(payload->'data'->>'time', payload->>'time', '')
        )
        """
    )
