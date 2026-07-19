"""submission delivery outbox and duplicate fingerprint guard

Revision ID: 0012_submission_delivery_outbox
Revises: 0011_seed_default_tracks
Create Date: 2026-04-24 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0012_submission_delivery_outbox"
down_revision = "0011_seed_default_tracks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column("correlation_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ux_submissions_correlation_id",
        "submissions",
        ["correlation_id"],
        unique=True,
    )

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

    op.create_table(
        "submission_delivery_outbox",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "submission_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("submissions.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("submission_ref", sa.String(length=120), nullable=False),
        sa.Column("correlation_id", sa.String(length=36), nullable=False),
        sa.Column("submission_input_id", sa.Integer(), nullable=True),
        sa.Column("delivery_status", sa.String(length=32), nullable=False, server_default=sa.text("'PENDING'")),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=120), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_submission_delivery_outbox_delivery_status_next_attempt_at",
        "submission_delivery_outbox",
        ["delivery_status", "next_attempt_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_submission_delivery_outbox_delivery_status_next_attempt_at",
        table_name="submission_delivery_outbox",
    )
    op.drop_table("submission_delivery_outbox")

    op.drop_index("uq_submissions_session_fingerprint", table_name="submissions")
    op.drop_index("ux_submissions_correlation_id", table_name="submissions")
    op.drop_column("submissions", "correlation_id")
