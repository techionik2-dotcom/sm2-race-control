"""add sm2 racing schema

Revision ID: 0002_sm2_racing_schema
Revises: 0001_initial_schema
Create Date: 2026-04-20 00:00:00.000000
"""

from __future__ import annotations

from pathlib import Path

from alembic import op


# revision identifiers, used by Alembic.
revision = "0002_sm2_racing_schema"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def _load_schema_sql() -> str:
    schema_path = Path(__file__).resolve().parents[1] / "sql" / "sm2_neon_schema.sql"
    lines: list[str] = []
    for line in schema_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip().lower()
        if stripped in {"begin;", "commit;"}:
            continue
        lines.append(line)
    return "\n".join(lines)


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql("CREATE SCHEMA IF NOT EXISTS sm2")
    bind.exec_driver_sql("SET search_path TO sm2, public")
    bind.exec_driver_sql(_load_schema_sql())
    bind.exec_driver_sql("SET search_path TO public")


def downgrade() -> None:
    # Intentionally no-op.
    #
    # The project now uses sm2racing as the canonical schema and we no longer
    # keep destructive downgrade logic here. This revision stays in the chain
    # only so older environments can resolve history safely.
    pass
