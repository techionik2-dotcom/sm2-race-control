"""repair sm2racing app columns after schema unification

Revision ID: 0010_drop_legacy_objs
Revises: 0009_unify_sm2racing_schema
Create Date: 2026-04-23 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision = "0010_drop_legacy_objs"
down_revision = "0009_unify_sm2racing_schema"
branch_labels = None
depends_on = None


TARGET_SCHEMA = "sm2racing"


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    return bool(
        bind.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = :schema
                      AND table_name = :table_name
                      AND column_name = :column_name
                )
                """
            ),
            {
                "schema": TARGET_SCHEMA,
                "table_name": table_name,
                "column_name": column_name,
            },
        ).scalar_one()
    )


def _create_enum(enum_name: str, labels: list[str]) -> None:
    labels_sql = ", ".join(f"'{label}'" for label in labels)
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_type t
                JOIN pg_namespace n ON n.oid = t.typnamespace
                WHERE n.nspname = '{TARGET_SCHEMA}'
                  AND t.typname = '{enum_name}'
            ) THEN
                CREATE TYPE {TARGET_SCHEMA}.{enum_name} AS ENUM ({labels_sql});
            END IF;
        END
        $$;
        """
    )


def upgrade() -> None:
    bind = op.get_bind()

    op.execute(f"CREATE SCHEMA IF NOT EXISTS {TARGET_SCHEMA}")
    _create_enum("user_role", ["OWNER", "MECHANIC", "ADMIN"])
    _create_enum("run_group_code", ["RED", "BLUE", "YELLOW", "GREEN"])
    _create_enum("submission_status", ["PENDING", "SENT", "FAILED"])

    if _column_exists(bind, "users", "role") is False:
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.users
            ADD COLUMN role {TARGET_SCHEMA}.user_role
            """
        )
        op.execute(
            f"""
            UPDATE {TARGET_SCHEMA}.users
            SET role = CASE
                WHEN lower(coalesce(email, '')) = 'admin@smracing.com' THEN 'OWNER'::{TARGET_SCHEMA}.user_role
                WHEN lower(coalesce(name, '')) = 'owner' THEN 'OWNER'::{TARGET_SCHEMA}.user_role
                ELSE 'MECHANIC'::{TARGET_SCHEMA}.user_role
            END
            WHERE role IS NULL
            """
        )
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.users
            ALTER COLUMN role SET DEFAULT 'MECHANIC'::{TARGET_SCHEMA}.user_role
            """
        )
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.users
            ALTER COLUMN role SET NOT NULL
            """
        )
        op.execute(
            f"""
            CREATE INDEX IF NOT EXISTS ix_users_role
            ON {TARGET_SCHEMA}.users (role)
            """
        )

    if _column_exists(bind, "run_groups", "normalized") is False:
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.run_groups
            ADD COLUMN normalized {TARGET_SCHEMA}.run_group_code
            """
        )
        op.execute(
            f"""
            UPDATE {TARGET_SCHEMA}.run_groups
            SET normalized = CASE
                WHEN upper(trim(raw_text)) = 'RED' THEN 'RED'::{TARGET_SCHEMA}.run_group_code
                WHEN upper(trim(raw_text)) = 'BLUE' THEN 'BLUE'::{TARGET_SCHEMA}.run_group_code
                WHEN upper(trim(raw_text)) = 'YELLOW' THEN 'YELLOW'::{TARGET_SCHEMA}.run_group_code
                WHEN upper(trim(raw_text)) = 'GREEN' THEN 'GREEN'::{TARGET_SCHEMA}.run_group_code
                WHEN upper(coalesce(raw_text, '')) LIKE '%RED%' THEN 'RED'::{TARGET_SCHEMA}.run_group_code
                WHEN upper(coalesce(raw_text, '')) LIKE '%BLUE%' THEN 'BLUE'::{TARGET_SCHEMA}.run_group_code
                WHEN upper(coalesce(raw_text, '')) LIKE '%YELLOW%' THEN 'YELLOW'::{TARGET_SCHEMA}.run_group_code
                WHEN upper(coalesce(raw_text, '')) LIKE '%GREEN%' THEN 'GREEN'::{TARGET_SCHEMA}.run_group_code
                ELSE NULL
            END
            WHERE normalized IS NULL
            """
        )
        unresolved = bind.execute(
            text(
                f"""
                SELECT count(*)
                FROM {TARGET_SCHEMA}.run_groups
                WHERE normalized IS NULL
                """
            )
        ).scalar_one()
        if unresolved:
            raise RuntimeError(
                "One or more run_groups rows could not be normalized automatically. "
                "Repair raw_text values before completing the migration."
            )
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.run_groups
            ALTER COLUMN normalized SET NOT NULL
            """
        )
        op.execute(
            f"""
            CREATE INDEX IF NOT EXISTS ix_run_groups_normalized
            ON {TARGET_SCHEMA}.run_groups (normalized)
            """
        )

    if _column_exists(bind, "submissions", "status") is False:
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.submissions
            ADD COLUMN status {TARGET_SCHEMA}.submission_status
            """
        )
        op.execute(
            f"""
            UPDATE {TARGET_SCHEMA}.submissions
            SET status = CASE
                WHEN nullif(btrim(coalesce(error_message, '')), '') IS NOT NULL
                    THEN 'FAILED'::{TARGET_SCHEMA}.submission_status
                ELSE 'PENDING'::{TARGET_SCHEMA}.submission_status
            END
            WHERE status IS NULL
            """
        )
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.submissions
            ALTER COLUMN status SET DEFAULT 'PENDING'::{TARGET_SCHEMA}.submission_status
            """
        )
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.submissions
            ALTER COLUMN status SET NOT NULL
            """
        )
        op.execute(
            f"""
            CREATE INDEX IF NOT EXISTS ix_submissions_status
            ON {TARGET_SCHEMA}.submissions (status)
            """
        )

    if _column_exists(bind, "tracks", "name") is False and _column_exists(bind, "tracks", "track_name"):
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.tracks
            ADD COLUMN name varchar(255)
            """
        )
        op.execute(
            f"""
            UPDATE {TARGET_SCHEMA}.tracks
            SET name = track_name
            WHERE name IS NULL
            """
        )
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.tracks
            ALTER COLUMN name SET NOT NULL
            """
        )
        op.execute(
            f"""
            CREATE UNIQUE INDEX IF NOT EXISTS ux_tracks_name
            ON {TARGET_SCHEMA}.tracks (name)
            """
        )
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.tracks
            ALTER COLUMN track_name DROP NOT NULL
            """
        )

    if _column_exists(bind, "tracks", "country") is False and _column_exists(bind, "tracks", "country_code"):
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.tracks
            ADD COLUMN country varchar(120)
            """
        )
        op.execute(
            f"""
            UPDATE {TARGET_SCHEMA}.tracks
            SET country = country_code
            WHERE country IS NULL
            """
        )

    if _column_exists(bind, "tracks", "active") is False and _column_exists(bind, "tracks", "status"):
        op.execute(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.tracks
            ADD COLUMN active boolean NOT NULL DEFAULT true
            """
        )
        op.execute(
            f"""
            UPDATE {TARGET_SCHEMA}.tracks
            SET active = status::text = 'ACTIVE'
            """
        )


def downgrade() -> None:
    bind = op.get_bind()

    if _column_exists(bind, "submissions", "status"):
        op.execute(f"DROP INDEX IF EXISTS {TARGET_SCHEMA}.ix_submissions_status")
        op.execute(f"ALTER TABLE {TARGET_SCHEMA}.submissions DROP COLUMN status")

    if _column_exists(bind, "run_groups", "normalized"):
        op.execute(f"DROP INDEX IF EXISTS {TARGET_SCHEMA}.ix_run_groups_normalized")
        op.execute(f"ALTER TABLE {TARGET_SCHEMA}.run_groups DROP COLUMN normalized")

    if _column_exists(bind, "users", "role"):
        op.execute(f"DROP INDEX IF EXISTS {TARGET_SCHEMA}.ix_users_role")
        op.execute(f"ALTER TABLE {TARGET_SCHEMA}.users DROP COLUMN role")

    op.execute(f"DROP TYPE IF EXISTS {TARGET_SCHEMA}.submission_status")
    op.execute(f"DROP TYPE IF EXISTS {TARGET_SCHEMA}.run_group_code")
    op.execute(f"DROP TYPE IF EXISTS {TARGET_SCHEMA}.user_role")
