"""add db-backed voice note audio storage

Revision ID: 0025_voice_note_audio_storage
Revises: 0024_owner_driver_roles
Create Date: 2026-06-11 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0025_voice_note_audio_storage"
down_revision = "0024_owner_driver_roles"
branch_labels = None
depends_on = None

SCHEMA = "sm2racing"


def upgrade() -> None:
    op.create_table(
        "voice_note_audio",
        sa.Column("voice_session_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("audio_blob", postgresql.BYTEA(), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=False),
        sa.Column("file_extension", sa.String(length=16), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["voice_session_id"],
            [f"{SCHEMA}.voice_note_sessions.id"],
            ondelete="CASCADE",
        ),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("voice_note_audio", schema=SCHEMA)
