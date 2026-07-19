-- SM2 Racing production schema
-- Rebuild target for Neon/Postgres

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS sm2;
SET search_path TO sm2, public;

DO $$ BEGIN
    CREATE TYPE sm2_lifecycle_status AS ENUM ('ACTIVE', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE sm2_session_status AS ENUM ('DRAFT', 'FINAL', 'ARCHIVED', 'VOID');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE sm2_log_status AS ENUM ('SUCCESS', 'ERROR', 'VALIDATION_FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE sm2_submission_source AS ENUM ('pwa', 'make', 'api', 'admin', 'offline_sync', 'photo');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE sm2_submission_type AS ENUM ('quick', 'detail', 'ocr', 'manual', 'sync');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE sm2_validation_status AS ENUM ('PENDING', 'VALIDATED', 'REJECTED', 'APPLIED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE sm2_ocr_review_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CORRECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE sm2_tire_position AS ENUM ('FL', 'FR', 'RL', 'RR');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE OR REPLACE FUNCTION sm2_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Reference / master tables
CREATE TABLE drivers (
    driver_id      text PRIMARY KEY CHECK (btrim(driver_id) <> ''),
    driver_name    text NOT NULL CHECK (btrim(driver_name) <> ''),
    status         sm2_lifecycle_status NOT NULL DEFAULT 'ACTIVE',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    archived_at    timestamptz,
    CONSTRAINT drivers_archive_consistency CHECK (status <> 'ARCHIVED' OR archived_at IS NOT NULL)
);

CREATE INDEX idx_drivers_active ON drivers (driver_name) WHERE status = 'ACTIVE';

CREATE TABLE driver_aliases (
    driver_alias_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id       text NOT NULL REFERENCES drivers(driver_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    alias           text NOT NULL CHECK (btrim(alias) <> ''),
    alias_type      text,
    status          sm2_lifecycle_status NOT NULL DEFAULT 'ACTIVE',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    archived_at     timestamptz,
    CONSTRAINT driver_aliases_archive_consistency CHECK (status <> 'ARCHIVED' OR archived_at IS NOT NULL),
    CONSTRAINT uq_driver_aliases UNIQUE (driver_id, alias)
);

CREATE INDEX idx_driver_aliases_driver_id ON driver_aliases (driver_id);
CREATE INDEX idx_driver_aliases_alias ON driver_aliases (alias);

CREATE TABLE tracks (
    track_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    track_name     text NOT NULL CHECK (btrim(track_name) <> ''),
    latitude       numeric(9,6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude      numeric(9,6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    country_code   char(2) CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
    status         sm2_lifecycle_status NOT NULL DEFAULT 'ACTIVE',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    archived_at    timestamptz,
    CONSTRAINT uq_tracks_name UNIQUE (track_name),
    CONSTRAINT tracks_archive_consistency CHECK (status <> 'ARCHIVED' OR archived_at IS NOT NULL)
);

CREATE INDEX idx_tracks_active ON tracks (track_name) WHERE status = 'ACTIVE';

CREATE TABLE vehicles (
    vehicle_id     text PRIMARY KEY CHECK (btrim(vehicle_id) <> ''),
    make           text NOT NULL CHECK (btrim(make) <> ''),
    model          text NOT NULL CHECK (btrim(model) <> ''),
    vehicle_class  text,
    year           integer CHECK (year IS NULL OR year BETWEEN 1900 AND 2100),
    notes          text,
    status         sm2_lifecycle_status NOT NULL DEFAULT 'ACTIVE',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    archived_at    timestamptz,
    CONSTRAINT vehicles_archive_consistency CHECK (status <> 'ARCHIVED' OR archived_at IS NOT NULL)
);

CREATE INDEX idx_vehicles_active ON vehicles (make, model) WHERE status = 'ACTIVE';
CREATE INDEX idx_vehicles_year ON vehicles (year);

CREATE TABLE vehicle_assignments (
    vehicle_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      text NOT NULL REFERENCES vehicles(vehicle_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    driver_id       text NOT NULL REFERENCES drivers(driver_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    effective_from  timestamptz NOT NULL,
    effective_to    timestamptz,
    is_primary      boolean NOT NULL DEFAULT true,
    status          sm2_lifecycle_status NOT NULL DEFAULT 'ACTIVE',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    archived_at     timestamptz,
    CONSTRAINT vehicle_assignments_archive_consistency CHECK (status <> 'ARCHIVED' OR archived_at IS NOT NULL),
    CONSTRAINT vehicle_assignments_effective_range CHECK (effective_to IS NULL OR effective_to > effective_from),
    CONSTRAINT uq_vehicle_assignments_start UNIQUE (vehicle_id, effective_from),
    EXCLUDE USING gist (
        vehicle_id WITH =,
        tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz)) WITH &&
    ) WHERE (status = 'ACTIVE' AND archived_at IS NULL)
);

CREATE UNIQUE INDEX ux_vehicle_assignments_current
    ON vehicle_assignments (vehicle_id)
    WHERE effective_to IS NULL AND status = 'ACTIVE' AND archived_at IS NULL;

CREATE INDEX idx_vehicle_assignments_driver_time
    ON vehicle_assignments (driver_id, effective_from DESC);

CREATE INDEX idx_vehicle_assignments_vehicle_time
    ON vehicle_assignments (vehicle_id, effective_from DESC);

CREATE TABLE tire_inventory (
    tire_id         text PRIMARY KEY CHECK (tire_id ~ '^[YMP]-S[0-9]+$'),
    manufacturer    text NOT NULL CHECK (btrim(manufacturer) <> ''),
    model           text,
    size            text,
    purchase_date   date,
    heat_cycles     integer CHECK (heat_cycles IS NULL OR heat_cycles >= 0),
    track_time_min  integer CHECK (track_time_min IS NULL OR track_time_min >= 0),
    status          sm2_lifecycle_status NOT NULL DEFAULT 'ACTIVE',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    archived_at     timestamptz,
    CONSTRAINT tire_inventory_archive_consistency CHECK (status <> 'ARCHIVED' OR archived_at IS NOT NULL)
);

CREATE INDEX idx_tire_inventory_active ON tire_inventory (manufacturer, model) WHERE status = 'ACTIVE';

-- Session / operational tables
CREATE TABLE seances (
    seance_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_seance            text NOT NULL CHECK (btrim(id_seance) <> ''),
    vehicle_assignment_id uuid NOT NULL REFERENCES vehicle_assignments(vehicle_assignment_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    track_id             uuid NOT NULL REFERENCES tracks(track_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    session_started_at   timestamptz NOT NULL,
    session_date         date NOT NULL,
    session_ended_at    timestamptz,
    session_type        text NOT NULL CHECK (btrim(session_type) <> ''),
    session_number      integer NOT NULL CHECK (session_number > 0),
    tire_set            text CHECK (tire_set IS NULL OR btrim(tire_set) <> ''),
    duration_min        integer CHECK (duration_min IS NULL OR duration_min > 0),
    notes               text,
    source_submission_id uuid UNIQUE,
    created_by_user_id  uuid NOT NULL REFERENCES public.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    status              sm2_session_status NOT NULL DEFAULT 'DRAFT',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    archived_at         timestamptz,
    CONSTRAINT uq_seances_business_id UNIQUE (id_seance),
    CONSTRAINT seances_archive_consistency CHECK (status <> 'ARCHIVED' OR archived_at IS NOT NULL),
    CONSTRAINT seances_time_consistency CHECK (session_ended_at IS NULL OR session_ended_at > session_started_at)
);

CREATE INDEX idx_seances_track_time ON seances (track_id, session_started_at DESC);
CREATE INDEX idx_seances_vehicle_time ON seances (vehicle_assignment_id, session_started_at DESC);
CREATE INDEX idx_seances_started_at ON seances (session_started_at DESC);
CREATE INDEX idx_seances_date ON seances (session_date);
CREATE INDEX idx_seances_status_time ON seances (status, session_started_at DESC);
CREATE INDEX idx_seances_created_at ON seances (created_at DESC);

CREATE TABLE pressures (
    seance_id     uuid PRIMARY KEY REFERENCES seances(seance_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    cold_fl       numeric(5,2) CHECK (cold_fl IS NULL OR cold_fl BETWEEN 5 AND 60),
    cold_fr       numeric(5,2) CHECK (cold_fr IS NULL OR cold_fr BETWEEN 5 AND 60),
    cold_rl       numeric(5,2) CHECK (cold_rl IS NULL OR cold_rl BETWEEN 5 AND 60),
    cold_rr       numeric(5,2) CHECK (cold_rr IS NULL OR cold_rr BETWEEN 5 AND 60),
    hot_fl        numeric(5,2) CHECK (hot_fl IS NULL OR hot_fl BETWEEN 5 AND 80),
    hot_fr        numeric(5,2) CHECK (hot_fr IS NULL OR hot_fr BETWEEN 5 AND 80),
    hot_rl        numeric(5,2) CHECK (hot_rl IS NULL OR hot_rl BETWEEN 5 AND 80),
    hot_rr        numeric(5,2) CHECK (hot_rr IS NULL OR hot_rr BETWEEN 5 AND 80),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suspensions (
    seance_id      uuid PRIMARY KEY REFERENCES seances(seance_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    rebound_fl     smallint CHECK (rebound_fl IS NULL OR rebound_fl >= 0),
    rebound_fr     smallint CHECK (rebound_fr IS NULL OR rebound_fr >= 0),
    rebound_rl     smallint CHECK (rebound_rl IS NULL OR rebound_rl >= 0),
    rebound_rr     smallint CHECK (rebound_rr IS NULL OR rebound_rr >= 0),
    bump_fl        smallint CHECK (bump_fl IS NULL OR bump_fl >= 0),
    bump_fr        smallint CHECK (bump_fr IS NULL OR bump_fr >= 0),
    bump_rl        smallint CHECK (bump_rl IS NULL OR bump_rl >= 0),
    bump_rr        smallint CHECK (bump_rr IS NULL OR bump_rr >= 0),
    sway_bar_f     smallint CHECK (sway_bar_f IS NULL OR sway_bar_f >= 0),
    sway_bar_r     smallint CHECK (sway_bar_r IS NULL OR sway_bar_r >= 0),
    wing_angle_deg numeric(5,2) CHECK (wing_angle_deg IS NULL OR wing_angle_deg BETWEEN -90 AND 90),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alignment (
    seance_id        uuid PRIMARY KEY REFERENCES seances(seance_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    camber_fl        numeric(5,2) CHECK (camber_fl IS NULL OR camber_fl BETWEEN -20 AND 20),
    camber_fr        numeric(5,2) CHECK (camber_fr IS NULL OR camber_fr BETWEEN -20 AND 20),
    camber_rl        numeric(5,2) CHECK (camber_rl IS NULL OR camber_rl BETWEEN -20 AND 20),
    camber_rr        numeric(5,2) CHECK (camber_rr IS NULL OR camber_rr BETWEEN -20 AND 20),
    toe_front        numeric(6,3) CHECK (toe_front IS NULL OR toe_front BETWEEN -50 AND 50),
    toe_rear         numeric(6,3) CHECK (toe_rear IS NULL OR toe_rear BETWEEN -50 AND 50),
    caster_l         numeric(5,2) CHECK (caster_l IS NULL OR caster_l BETWEEN -20 AND 20),
    caster_r         numeric(5,2) CHECK (caster_r IS NULL OR caster_r BETWEEN -20 AND 20),
    ride_height_f    numeric(8,2) CHECK (ride_height_f IS NULL OR ride_height_f >= 0),
    ride_height_r    numeric(8,2) CHECK (ride_height_r IS NULL OR ride_height_r >= 0),
    corner_weight_fl numeric(8,2) CHECK (corner_weight_fl IS NULL OR corner_weight_fl >= 0),
    corner_weight_fr numeric(8,2) CHECK (corner_weight_fr IS NULL OR corner_weight_fr >= 0),
    corner_weight_rl numeric(8,2) CHECK (corner_weight_rl IS NULL OR corner_weight_rl >= 0),
    corner_weight_rr numeric(8,2) CHECK (corner_weight_rr IS NULL OR corner_weight_rr >= 0),
    cross_weight_pct numeric(5,2) GENERATED ALWAYS AS (
        CASE
            WHEN corner_weight_fl IS NULL
              OR corner_weight_fr IS NULL
              OR corner_weight_rl IS NULL
              OR corner_weight_rr IS NULL
              OR (corner_weight_fl + corner_weight_fr + corner_weight_rl + corner_weight_rr) = 0
            THEN NULL
            ELSE round(
                ((corner_weight_fl + corner_weight_rr)
                / NULLIF((corner_weight_fl + corner_weight_fr + corner_weight_rl + corner_weight_rr), 0)) * 100,
                2
            )
        END
    ) STORED,
    rake_mm          numeric(8,2) CHECK (rake_mm IS NULL OR rake_mm BETWEEN -500 AND 500),
    wheelbase_mm     numeric(8,2) CHECK (wheelbase_mm IS NULL OR wheelbase_mm > 0),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tire_temperatures (
    seance_id   uuid PRIMARY KEY REFERENCES seances(seance_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    fl_in       numeric(5,2) CHECK (fl_in IS NULL OR fl_in BETWEEN 0 AND 300),
    fl_mid      numeric(5,2) CHECK (fl_mid IS NULL OR fl_mid BETWEEN 0 AND 300),
    fl_out      numeric(5,2) CHECK (fl_out IS NULL OR fl_out BETWEEN 0 AND 300),
    fr_in       numeric(5,2) CHECK (fr_in IS NULL OR fr_in BETWEEN 0 AND 300),
    fr_mid      numeric(5,2) CHECK (fr_mid IS NULL OR fr_mid BETWEEN 0 AND 300),
    fr_out      numeric(5,2) CHECK (fr_out IS NULL OR fr_out BETWEEN 0 AND 300),
    rl_in       numeric(5,2) CHECK (rl_in IS NULL OR rl_in BETWEEN 0 AND 300),
    rl_mid      numeric(5,2) CHECK (rl_mid IS NULL OR rl_mid BETWEEN 0 AND 300),
    rl_out      numeric(5,2) CHECK (rl_out IS NULL OR rl_out BETWEEN 0 AND 300),
    rr_in       numeric(5,2) CHECK (rr_in IS NULL OR rr_in BETWEEN 0 AND 300),
    rr_mid      numeric(5,2) CHECK (rr_mid IS NULL OR rr_mid BETWEEN 0 AND 300),
    rr_out      numeric(5,2) CHECK (rr_out IS NULL OR rr_out BETWEEN 0 AND 300),
    photo_media_id uuid,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tire_history (
    tire_history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seance_id       uuid NOT NULL REFERENCES seances(seance_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    tire_id         text NOT NULL REFERENCES tire_inventory(tire_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    position        sm2_tire_position NOT NULL,
    duration_min    integer CHECK (duration_min IS NULL OR duration_min >= 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_tire_history_session_position UNIQUE (seance_id, position),
    CONSTRAINT uq_tire_history_session_tire UNIQUE (seance_id, tire_id)
);

-- Audit / ingestion / OCR
CREATE TABLE logs (
    log_id        bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    logged_at     timestamptz NOT NULL DEFAULT now(),
    action        text NOT NULL CHECK (btrim(action) <> ''),
    status        sm2_log_status NOT NULL,
    actor_user_id  uuid REFERENCES public.users(id) ON UPDATE RESTRICT ON DELETE SET NULL,
    entity_type   text NOT NULL CHECK (btrim(entity_type) <> ''),
    entity_id     text NOT NULL CHECK (btrim(entity_id) <> ''),
    message       text,
    payload       jsonb,
    correlation_id uuid
);

CREATE INDEX idx_logs_logged_at ON logs (logged_at DESC);
CREATE INDEX idx_logs_status ON logs (status);
CREATE INDEX idx_logs_action ON logs (action);
CREATE INDEX idx_logs_entity ON logs (entity_type, entity_id);
CREATE INDEX idx_logs_actor_user ON logs (actor_user_id);
CREATE INDEX idx_logs_correlation_id ON logs (correlation_id) WHERE correlation_id IS NOT NULL;

CREATE TABLE submission_inputs (
    submission_input_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_seance_code text CHECK (source_seance_code IS NULL OR btrim(source_seance_code) <> ''),
    seance_id        uuid UNIQUE,
    submission_type  sm2_submission_type NOT NULL,
    source           sm2_submission_source NOT NULL,
    raw_text         text,
    raw_payload_text text,
    raw_payload_jsonb jsonb,
    raw_payload_hash text,
    confidence       numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    created_by_user_id uuid REFERENCES public.users(id) ON UPDATE RESTRICT ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    validation_status sm2_validation_status NOT NULL DEFAULT 'PENDING',
    validation_message text,
    validated_at     timestamptz,
    applied_at       timestamptz,
    CONSTRAINT submission_inputs_raw_presence CHECK (
        raw_text IS NOT NULL
        OR raw_payload_text IS NOT NULL
        OR raw_payload_jsonb IS NOT NULL
    ),
    CONSTRAINT submission_inputs_validation_state CHECK (
        (validation_status <> 'VALIDATED' OR validated_at IS NOT NULL)
        AND (validation_status <> 'APPLIED' OR applied_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX ux_submission_inputs_raw_payload_hash
    ON submission_inputs (raw_payload_hash)
    WHERE raw_payload_hash IS NOT NULL;

CREATE INDEX idx_submission_inputs_status_created_at
    ON submission_inputs (validation_status, created_at DESC);

CREATE INDEX idx_submission_inputs_source_seance_code
    ON submission_inputs (source_seance_code);

CREATE INDEX idx_submission_inputs_source_created_at
    ON submission_inputs (source, created_at DESC);

CREATE TABLE media_files (
    media_file_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_input_id uuid NOT NULL REFERENCES submission_inputs(submission_input_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    storage_uri       text NOT NULL CHECK (btrim(storage_uri) <> ''),
    mime_type         text,
    file_name         text,
    file_size         bigint CHECK (file_size IS NULL OR file_size >= 0),
    checksum          text,
    uploaded_by_user_id uuid REFERENCES public.users(id) ON UPDATE RESTRICT ON DELETE SET NULL,
    uploaded_at       timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_media_files_checksum
    ON media_files (checksum)
    WHERE checksum IS NOT NULL;

CREATE INDEX idx_media_files_submission_input
    ON media_files (submission_input_id);

CREATE TABLE ocr_results (
    ocr_result_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_input_id uuid NOT NULL REFERENCES submission_inputs(submission_input_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    media_file_id     uuid REFERENCES media_files(media_file_id) ON UPDATE RESTRICT ON DELETE SET NULL,
    raw_ocr_text      text,
    cleaned_ocr_text  text,
    extracted_json    jsonb,
    ocr_confidence    numeric(5,4) CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 1)),
    parser_version    text NOT NULL CHECK (btrim(parser_version) <> ''),
    model_version     text,
    prompt_version    text,
    review_status     sm2_ocr_review_status NOT NULL DEFAULT 'PENDING',
    reviewed_by_user_id uuid REFERENCES public.users(id) ON UPDATE RESTRICT ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ocr_results_submission_input
    ON ocr_results (submission_input_id);

CREATE INDEX idx_ocr_results_review_status_created_at
    ON ocr_results (review_status, created_at DESC);

CREATE INDEX idx_ocr_results_media_file
    ON ocr_results (media_file_id);

CREATE UNIQUE INDEX ux_ocr_results_attempt_with_media
    ON ocr_results (submission_input_id, media_file_id, parser_version)
    WHERE media_file_id IS NOT NULL;

CREATE UNIQUE INDEX ux_ocr_results_attempt_without_media
    ON ocr_results (submission_input_id, parser_version)
    WHERE media_file_id IS NULL;

ALTER TABLE submission_inputs
    ADD CONSTRAINT fk_submission_inputs_seance
    FOREIGN KEY (seance_id)
    REFERENCES seances(seance_id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL;

ALTER TABLE seances
    ADD CONSTRAINT fk_seances_source_submission
    FOREIGN KEY (source_submission_id)
    REFERENCES submission_inputs(submission_input_id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL;

ALTER TABLE tire_temperatures
    ADD CONSTRAINT fk_tire_temperatures_photo_media
    FOREIGN KEY (photo_media_id)
    REFERENCES media_files(media_file_id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL;

-- Updated-at triggers
CREATE TRIGGER trg_drivers_updated_at
    BEFORE UPDATE ON drivers
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_driver_aliases_updated_at
    BEFORE UPDATE ON driver_aliases
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_tracks_updated_at
    BEFORE UPDATE ON tracks
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_vehicles_updated_at
    BEFORE UPDATE ON vehicles
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_vehicle_assignments_updated_at
    BEFORE UPDATE ON vehicle_assignments
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_tire_inventory_updated_at
    BEFORE UPDATE ON tire_inventory
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_seances_updated_at
    BEFORE UPDATE ON seances
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_pressures_updated_at
    BEFORE UPDATE ON pressures
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_suspensions_updated_at
    BEFORE UPDATE ON suspensions
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_alignment_updated_at
    BEFORE UPDATE ON alignment
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_tire_temperatures_updated_at
    BEFORE UPDATE ON tire_temperatures
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_submission_inputs_updated_at
    BEFORE UPDATE ON submission_inputs
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_media_files_updated_at
    BEFORE UPDATE ON media_files
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();

CREATE TRIGGER trg_ocr_results_updated_at
    BEFORE UPDATE ON ocr_results
    FOR EACH ROW EXECUTE FUNCTION sm2_touch_updated_at();
