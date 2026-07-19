"""seed default track records

Revision ID: 0011_seed_default_tracks
Revises: 0010_drop_legacy_objs
Create Date: 2026-04-23 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0011_seed_default_tracks"
down_revision = "0010_drop_legacy_objs"
branch_labels = None
depends_on = None


DEFAULT_TRACKS = [
    "Sebring International Raceway",
    "Daytona International Speedway",
    "Road Atlanta",
]


def upgrade() -> None:
    values_sql = ",\n            ".join(
        "('{}', 'United States', true)".format(track.replace("'", "''"))
        for track in DEFAULT_TRACKS
    )

    op.execute(
        f"""
        INSERT INTO sm2racing.tracks (name, country, active)
        VALUES
            {values_sql}
        ON CONFLICT (name) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM sm2racing.tracks
        WHERE name IN (
            'Sebring International Raceway',
            'Daytona International Speedway',
            'Road Atlanta'
        )
        """
    )
