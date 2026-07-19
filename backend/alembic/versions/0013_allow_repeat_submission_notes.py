"""allow repeat submission notes for the same session

Revision ID: 0013_repeat_notes
Revises: 0012_submission_delivery_outbox
Create Date: 2026-04-27 17:45:00.000000
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0013_repeat_notes"
down_revision = "0012_submission_delivery_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_submissions_session_fingerprint")


def downgrade() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_submissions_session_fingerprint
        ON submissions (
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
