"""Add persisted notes to events.

Revision ID: 0005_event_notes
Revises: 0004_sm2_susp_adj
Create Date: 2026-04-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0005_event_notes"
down_revision = "0004_sm2_susp_adj"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "notes")
