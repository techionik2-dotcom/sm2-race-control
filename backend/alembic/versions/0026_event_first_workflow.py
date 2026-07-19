"""add event-first race weekend workflow

Revision ID: 0026_event_first_workflow
Revises: 0025_voice_note_audio_storage
Create Date: 2026-07-19 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "0026_event_first_workflow"
down_revision = "0025_voice_note_audio_storage"
branch_labels = None
depends_on = None

SCHEMA = "sm2racing"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.event_participants (
            id uuid PRIMARY KEY,
            event_id uuid NOT NULL REFERENCES {SCHEMA}.events(id) ON DELETE CASCADE,
            driver_id uuid NOT NULL REFERENCES {SCHEMA}.drivers(id),
            vehicle_id uuid REFERENCES {SCHEMA}.vehicles(id),
            baseline_setup jsonb NOT NULL DEFAULT '{{}}'::jsonb,
            notes text,
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_event_participant_driver UNIQUE (event_id, driver_id)
        )
        """
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.race_sessions (
            id uuid PRIMARY KEY,
            event_id uuid NOT NULL REFERENCES {SCHEMA}.events(id) ON DELETE CASCADE,
            participant_id uuid NOT NULL REFERENCES {SCHEMA}.event_participants(id) ON DELETE CASCADE,
            title varchar(255) NOT NULL,
            session_type varchar(64) NOT NULL,
            session_number integer NOT NULL DEFAULT 1,
            scheduled_at timestamptz,
            status varchar(32) NOT NULL DEFAULT 'PLANNED',
            source varchar(32) NOT NULL DEFAULT 'schedule',
            setup_data jsonb NOT NULL DEFAULT '{{}}'::jsonb,
            tire_data jsonb NOT NULL DEFAULT '{{}}'::jsonb,
            lap_times jsonb NOT NULL DEFAULT '[]'::jsonb,
            comments text,
            observations text,
            adjustments text,
            additional_data jsonb NOT NULL DEFAULT '{{}}'::jsonb,
            carried_from_session_id uuid REFERENCES {SCHEMA}.race_sessions(id),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.session_attachments (
            id uuid PRIMARY KEY,
            session_id uuid NOT NULL REFERENCES {SCHEMA}.race_sessions(id) ON DELETE CASCADE,
            filename varchar(255) NOT NULL,
            content_type varchar(120) NOT NULL,
            size_bytes bigint NOT NULL,
            data bytea NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_event_participants_event_id ON {SCHEMA}.event_participants(event_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_race_sessions_event_id ON {SCHEMA}.race_sessions(event_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_race_sessions_participant_id ON {SCHEMA}.race_sessions(participant_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_session_attachments_session_id ON {SCHEMA}.session_attachments(session_id)")


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {SCHEMA}.session_attachments")
    op.execute(f"DROP TABLE IF EXISTS {SCHEMA}.race_sessions")
    op.execute(f"DROP TABLE IF EXISTS {SCHEMA}.event_participants")
