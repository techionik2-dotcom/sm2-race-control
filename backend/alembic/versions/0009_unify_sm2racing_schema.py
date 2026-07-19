"""unify public and sm2 tables into sm2racing

Revision ID: 0009_unify_sm2racing_schema
Revises: 0008_submission_text_fields
Create Date: 2026-04-23 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision = "0009_unify_sm2racing_schema"
down_revision = "0008_submission_text_fields"
branch_labels = None
depends_on = None


TARGET_SCHEMA = "sm2racing"
PUBLIC_TABLES = [
    "users",
    "events",
    "run_groups",
    "drivers",
    "vehicles",
    "submissions",
    "revoked_tokens",
]
SM2_RACING_TABLES = [
    "alignment",
    "driver_aliases",
    "logs",
    "media_files",
    "ocr_results",
    "pressures",
    "seances",
    "submission_inputs",
    "suspensions",
    "tire_history",
    "tire_inventory",
    "tire_temperatures",
    "tracks",
    "vehicle_assignments",
]


def _relation_exists(bind, schema: str, name: str) -> bool:
    return (
        bind.execute(
            text("SELECT to_regclass(:relation_name)"),
            {"relation_name": f"{schema}.{name}"},
        ).scalar_one()
        is not None
    )


def _table_exists(bind, schema: str, name: str) -> bool:
    return (
        bind.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = :schema
                      AND table_name = :name
                )
                """
            ),
            {"schema": schema, "name": name},
        ).scalar_one()
    )


def _column_exists(bind, schema: str, table_name: str, column_name: str) -> bool:
    return (
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
            {"schema": schema, "table_name": table_name, "column_name": column_name},
        ).scalar_one()
    )


def _row_count(bind, schema: str, name: str) -> int:
    return bind.execute(text(f'SELECT count(*) FROM {schema}."{name}"')).scalar_one()


def _move_table(bind, source_schema: str, target_schema: str, table_name: str) -> None:
    if not _table_exists(bind, source_schema, table_name):
        return
    if _relation_exists(bind, target_schema, table_name):
        raise RuntimeError(
            f"Destination relation {target_schema}.{table_name} already exists. "
            "Refusing to overwrite during schema unification."
        )
    bind.exec_driver_sql(f'ALTER TABLE {source_schema}."{table_name}" SET SCHEMA {target_schema}')


def _drop_view_if_exists(bind, schema: str, view_name: str) -> None:
    bind.exec_driver_sql(f'DROP VIEW IF EXISTS {schema}."{view_name}" CASCADE')


def _create_public_compat_views(bind) -> None:
    for table_name in PUBLIC_TABLES:
        _drop_view_if_exists(bind, "public", table_name)
        bind.exec_driver_sql(
            f'CREATE VIEW public."{table_name}" AS SELECT * FROM {TARGET_SCHEMA}."{table_name}"'
        )


def _create_sm2_compat_views(bind) -> None:
    bind.exec_driver_sql("CREATE SCHEMA IF NOT EXISTS sm2")

    for table_name in SM2_RACING_TABLES:
        _drop_view_if_exists(bind, "sm2", table_name)
        bind.exec_driver_sql(
            f'CREATE VIEW sm2."{table_name}" AS SELECT * FROM {TARGET_SCHEMA}."{table_name}"'
        )

    _drop_view_if_exists(bind, "sm2", "drivers")
    bind.exec_driver_sql(
        f"""
        CREATE VIEW sm2.drivers AS
        SELECT
            driver_id,
            driver_name,
            array_to_string(aliases, ', ') AS aliases,
            is_active AS active,
            created_at,
            updated_at
        FROM {TARGET_SCHEMA}.drivers
        """
    )

    _drop_view_if_exists(bind, "sm2", "vehicles")
    bind.exec_driver_sql(
        f"""
        CREATE VIEW sm2.vehicles AS
        SELECT
            vehicle_id,
            driver_id,
            make,
            model,
            year,
            "class",
            notes,
            is_active AS active,
            created_at,
            updated_at
        FROM {TARGET_SCHEMA}.vehicles
        """
    )


def _create_legacy_sm2_driver_tables(bind) -> None:
    bind.exec_driver_sql("CREATE SCHEMA IF NOT EXISTS sm2")
    bind.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS sm2.drivers (
            driver_id text PRIMARY KEY,
            driver_name text NOT NULL,
            aliases text,
            active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    bind.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS sm2.vehicles (
            vehicle_id text PRIMARY KEY,
            driver_id text NOT NULL,
            make text NOT NULL,
            model text NOT NULL,
            year integer,
            "class" text,
            notes text,
            active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    bind.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS idx_vehicles_driver_id
            ON sm2.vehicles (driver_id)
        """
    )
    bind.exec_driver_sql(
        """
        ALTER TABLE sm2.vehicles
        DROP CONSTRAINT IF EXISTS vehicles_driver_id_fkey
        """
    )
    bind.exec_driver_sql(
        """
        ALTER TABLE sm2.vehicles
        ADD CONSTRAINT vehicles_driver_id_fkey
        FOREIGN KEY (driver_id)
        REFERENCES sm2.drivers(driver_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
        """
    )
    bind.exec_driver_sql(
        f"""
        INSERT INTO sm2.drivers (driver_id, driver_name, aliases, active, created_at, updated_at)
        SELECT
            driver_id,
            driver_name,
            array_to_string(aliases, ', '),
            is_active,
            created_at,
            updated_at
        FROM {TARGET_SCHEMA}.drivers
        ON CONFLICT (driver_id) DO NOTHING
        """
    )
    bind.exec_driver_sql(
        f"""
        INSERT INTO sm2.vehicles (vehicle_id, driver_id, make, model, year, "class", notes, active, created_at, updated_at)
        SELECT
            vehicle_id,
            driver_id,
            make,
            model,
            year,
            "class",
            notes,
            is_active,
            created_at,
            updated_at
        FROM {TARGET_SCHEMA}.vehicles
        ON CONFLICT (vehicle_id) DO NOTHING
        """
    )


def upgrade() -> None:
    bind = op.get_bind()

    bind.exec_driver_sql(f"CREATE SCHEMA IF NOT EXISTS {TARGET_SCHEMA}")

    for table_name in ("drivers", "vehicles"):
        if _table_exists(bind, "sm2", table_name) and _row_count(bind, "sm2", table_name) > 0:
            raise RuntimeError(
                f"sm2.{table_name} contains rows. Manual reconciliation is required before unifying schemas."
            )

    if _table_exists(bind, "sm2", "seances"):
        bind.exec_driver_sql("ALTER TABLE sm2.seances DROP CONSTRAINT IF EXISTS seances_driver_id_fkey")
        bind.exec_driver_sql("ALTER TABLE sm2.seances DROP CONSTRAINT IF EXISTS seances_vehicle_id_fkey")
    if _table_exists(bind, "sm2", "driver_aliases"):
        bind.exec_driver_sql("ALTER TABLE sm2.driver_aliases DROP CONSTRAINT IF EXISTS driver_aliases_driver_id_fkey")
    if _table_exists(bind, "sm2", "vehicle_assignments"):
        bind.exec_driver_sql(
            "ALTER TABLE sm2.vehicle_assignments DROP CONSTRAINT IF EXISTS vehicle_assignments_driver_id_fkey"
        )
        bind.exec_driver_sql(
            "ALTER TABLE sm2.vehicle_assignments DROP CONSTRAINT IF EXISTS vehicle_assignments_vehicle_id_fkey"
        )
    if _table_exists(bind, "sm2", "vehicles"):
        bind.exec_driver_sql("ALTER TABLE sm2.vehicles DROP CONSTRAINT IF EXISTS vehicles_driver_id_fkey")

    if _table_exists(bind, "sm2", "vehicles"):
        bind.exec_driver_sql("DROP TABLE sm2.vehicles")
    if _table_exists(bind, "sm2", "drivers"):
        bind.exec_driver_sql("DROP TABLE sm2.drivers")

    for table_name in PUBLIC_TABLES:
        _move_table(bind, "public", TARGET_SCHEMA, table_name)

    for table_name in SM2_RACING_TABLES:
        _move_table(bind, "sm2", TARGET_SCHEMA, table_name)

    if _table_exists(bind, TARGET_SCHEMA, "seances") and _column_exists(bind, TARGET_SCHEMA, "seances", "driver_id"):
        bind.exec_driver_sql(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.seances
            ADD CONSTRAINT seances_driver_id_fkey
            FOREIGN KEY (driver_id)
            REFERENCES {TARGET_SCHEMA}.drivers(driver_id)
            ON UPDATE RESTRICT
            ON DELETE RESTRICT
            """
        )
    if _table_exists(bind, TARGET_SCHEMA, "seances") and _column_exists(bind, TARGET_SCHEMA, "seances", "vehicle_id"):
        bind.exec_driver_sql(
            f"""
            ALTER TABLE {TARGET_SCHEMA}.seances
            ADD CONSTRAINT seances_vehicle_id_fkey
            FOREIGN KEY (vehicle_id)
            REFERENCES {TARGET_SCHEMA}.vehicles(vehicle_id)
            ON UPDATE RESTRICT
            ON DELETE RESTRICT
            """
        )

    _create_public_compat_views(bind)
    _create_sm2_compat_views(bind)
    bind.exec_driver_sql(f"SET search_path TO {TARGET_SCHEMA}, public")


def downgrade() -> None:
    bind = op.get_bind()

    for table_name in PUBLIC_TABLES:
        _drop_view_if_exists(bind, "public", table_name)
    for table_name in [*SM2_RACING_TABLES, "drivers", "vehicles"]:
        _drop_view_if_exists(bind, "sm2", table_name)

    _create_legacy_sm2_driver_tables(bind)

    if _table_exists(bind, TARGET_SCHEMA, "seances"):
        bind.exec_driver_sql(
            f"ALTER TABLE {TARGET_SCHEMA}.seances DROP CONSTRAINT IF EXISTS seances_driver_id_fkey"
        )
        bind.exec_driver_sql(
            f"ALTER TABLE {TARGET_SCHEMA}.seances DROP CONSTRAINT IF EXISTS seances_vehicle_id_fkey"
        )

    for table_name in SM2_RACING_TABLES:
        _move_table(bind, TARGET_SCHEMA, "sm2", table_name)

    if _table_exists(bind, "sm2", "seances"):
        bind.exec_driver_sql(
            """
            ALTER TABLE sm2.seances
            ADD CONSTRAINT seances_driver_id_fkey
            FOREIGN KEY (driver_id)
            REFERENCES sm2.drivers(driver_id)
            ON UPDATE RESTRICT
            ON DELETE RESTRICT
            """
        )
        bind.exec_driver_sql(
            """
            ALTER TABLE sm2.seances
            ADD CONSTRAINT seances_vehicle_id_fkey
            FOREIGN KEY (vehicle_id)
            REFERENCES sm2.vehicles(vehicle_id)
            ON UPDATE RESTRICT
            ON DELETE RESTRICT
            """
        )

    for table_name in PUBLIC_TABLES:
        _move_table(bind, TARGET_SCHEMA, "public", table_name)
