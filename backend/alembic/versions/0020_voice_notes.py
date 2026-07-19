"""add voice note sessions and transcription attempts

Revision ID: 0020_voice_notes
Revises: 0019_chatbot_conversations
Create Date: 2026-05-04 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0020_voice_notes"
down_revision = "0019_chatbot_conversations"
branch_labels = None
depends_on = None

SCHEMA = "sm2racing"

VOICE_NOTE_STATUS = sa.Enum(
    "DRAFT",
    "RECORDING",
    "UPLOADED",
    "PENDING_TRANSCRIPTION",
    "TRANSCRIBING",
    "TRANSCRIBED",
    "TRANSCRIPTION_FAILED",
    "PENDING_REVIEW",
    "CONFIRMED",
    "SUBMITTED",
    "VALIDATION_FAILED",
    "ARCHIVED",
    name="voice_note_status",
    schema=SCHEMA,
)


def upgrade() -> None:
    op.create_table(
        "voice_note_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_group_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("submission_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("client_session_id", sa.String(length=120), nullable=True),
        sa.Column("status", VOICE_NOTE_STATUS, nullable=False, server_default=sa.text("'DRAFT'")),
        sa.Column("validation_status", sa.String(length=32), nullable=False, server_default=sa.text("'PENDING'")),
        sa.Column("validation_message", sa.Text(), nullable=True),
        sa.Column("audio_storage_key", sa.Text(), nullable=True),
        sa.Column("audio_file_name", sa.String(length=255), nullable=True),
        sa.Column("audio_content_type", sa.String(length=120), nullable=True),
        sa.Column("audio_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("audio_duration_ms", sa.Integer(), nullable=True),
        sa.Column("audio_checksum", sa.String(length=128), nullable=True),
        sa.Column("audio_language", sa.String(length=32), nullable=True),
        sa.Column("transcript_text", sa.Text(), nullable=True),
        sa.Column("transcript_edited_text", sa.Text(), nullable=True),
        sa.Column("transcript_confidence", sa.Float(), nullable=True),
        sa.Column("transcript_word_count", sa.Integer(), nullable=True),
        sa.Column("transcript_json", sa.JSON(), nullable=True),
        sa.Column("deepgram_request_json", sa.JSON(), nullable=True),
        sa.Column("deepgram_response_json", sa.JSON(), nullable=True),
        sa.Column("deepgram_request_id", sa.String(length=120), nullable=True),
        sa.Column("deepgram_model", sa.String(length=120), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("transcribed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=120), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["event_id"], [f"{SCHEMA}.events.id"]),
        sa.ForeignKeyConstraint(["run_group_id"], [f"{SCHEMA}.run_groups.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], [f"{SCHEMA}.users.id"]),
        sa.ForeignKeyConstraint(["submission_id"], [f"{SCHEMA}.submissions.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("submission_id", name="uq_voice_note_sessions_submission_id"),
        schema=SCHEMA,
    )

    op.create_index(
        "ix_voice_note_sessions_event_id",
        "voice_note_sessions",
        ["event_id"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_voice_note_sessions_run_group_id",
        "voice_note_sessions",
        ["run_group_id"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_voice_note_sessions_created_by_id",
        "voice_note_sessions",
        ["created_by_id"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_voice_note_sessions_status",
        "voice_note_sessions",
        ["status"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_voice_note_sessions_client_session_id",
        "voice_note_sessions",
        ["client_session_id"],
        unique=False,
        schema=SCHEMA,
    )

    op.create_table(
        "voice_note_transcription_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("voice_session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default=sa.text("'deepgram'")),
        sa.Column("attempt_status", sa.String(length=16), nullable=False, server_default=sa.text("'PENDING'")),
        sa.Column("request_json", sa.JSON(), nullable=True),
        sa.Column("response_json", sa.JSON(), nullable=True),
        sa.Column("transcript_text", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("request_id", sa.String(length=120), nullable=True),
        sa.Column("error_code", sa.String(length=120), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["voice_session_id"],
            [f"{SCHEMA}.voice_note_sessions.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "voice_session_id",
            "attempt_number",
            name="uq_voice_note_transcription_attempts_session_attempt",
        ),
        schema=SCHEMA,
    )

    op.create_index(
        "ix_voice_note_transcription_attempts_voice_session_id",
        "voice_note_transcription_attempts",
        ["voice_session_id"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_voice_note_transcription_attempts_attempt_status",
        "voice_note_transcription_attempts",
        ["attempt_status"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_voice_note_transcription_attempts_provider",
        "voice_note_transcription_attempts",
        ["provider"],
        unique=False,
        schema=SCHEMA,
    )

    op.add_column(
        "submissions",
        sa.Column("voice_session_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "fk_submissions_voice_session_id_voice_note_sessions",
        "submissions",
        "voice_note_sessions",
        ["voice_session_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="SET NULL",
    )
    op.create_unique_constraint(
        "uq_submissions_voice_session_id",
        "submissions",
        ["voice_session_id"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_submissions_voice_session_id",
        "submissions",
        schema=SCHEMA,
        type_="unique",
    )
    op.drop_constraint(
        "fk_submissions_voice_session_id_voice_note_sessions",
        "submissions",
        schema=SCHEMA,
        type_="foreignkey",
    )
    op.drop_column("submissions", "voice_session_id", schema=SCHEMA)

    op.drop_index(
        "ix_voice_note_transcription_attempts_provider",
        table_name="voice_note_transcription_attempts",
        schema=SCHEMA,
    )
    op.drop_index(
        "ix_voice_note_transcription_attempts_attempt_status",
        table_name="voice_note_transcription_attempts",
        schema=SCHEMA,
    )
    op.drop_index(
        "ix_voice_note_transcription_attempts_voice_session_id",
        table_name="voice_note_transcription_attempts",
        schema=SCHEMA,
    )
    op.drop_table("voice_note_transcription_attempts", schema=SCHEMA)

    op.drop_index("ix_voice_note_sessions_client_session_id", table_name="voice_note_sessions", schema=SCHEMA)
    op.drop_index("ix_voice_note_sessions_status", table_name="voice_note_sessions", schema=SCHEMA)
    op.drop_index("ix_voice_note_sessions_created_by_id", table_name="voice_note_sessions", schema=SCHEMA)
    op.drop_index("ix_voice_note_sessions_run_group_id", table_name="voice_note_sessions", schema=SCHEMA)
    op.drop_index("ix_voice_note_sessions_event_id", table_name="voice_note_sessions", schema=SCHEMA)
    op.drop_table("voice_note_sessions", schema=SCHEMA)

    VOICE_NOTE_STATUS.drop(op.get_bind(), checkfirst=True)
