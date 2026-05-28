-- obs-stream-kit Identity & Config Schema
-- Wird via `python -m core.init_schema` ausgefuehrt (idempotent)

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    twitch_user_id  TEXT UNIQUE,
    display_name    TEXT NOT NULL,
    is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
    id              SERIAL PRIMARY KEY,
    owner_user_id   INT NOT NULL REFERENCES users(id),
    slug            TEXT UNIQUE NOT NULL,
    display_name    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_credentials (
    tenant_id                  INT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    pubg_name                  TEXT,
    pubg_platform              TEXT,
    pubg_account_id            TEXT,
    pubg_api_key_enc           BYTEA,
    twitch_channel             TEXT,
    twitch_client_id           TEXT,
    twitch_client_secret_enc   BYTEA,
    steam_id                   TEXT,
    steam_api_key_enc          BYTEA,
    ftp_config_enc             BYTEA,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS widget_tokens (
    token        TEXT PRIMARY KEY,
    tenant_id    INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    label        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_widget_tokens_tenant
    ON widget_tokens(tenant_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS pois (
    id          SERIAL PRIMARY KEY,
    map_name    TEXT NOT NULL,
    name        TEXT NOT NULL,
    poi_x       DOUBLE PRECISION NOT NULL,
    poi_y       DOUBLE PRECISION NOT NULL,
    radius_m    DOUBLE PRECISION,
    tags        TEXT[],
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pois_map ON pois(map_name);
