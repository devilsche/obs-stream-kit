-- Spec 2 Schema-Migration (additiv)
-- Idempotent: kann mehrfach laufen.

-- Search-Path setzen damit unqualifizierte Tabellen-Refs (users etc.)
-- aufgeloest werden — sonst Fehler beim Ausfuehren als postgres-Superuser.
SET search_path TO obs, public;

-- pgcrypto fuer gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- users-Erweiterung
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Admin-User wird automatisch approved
UPDATE users SET is_approved = TRUE WHERE is_admin = TRUE;

-- Server-Side Sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    user_agent    TEXT,
    ip            INET
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user
    ON user_sessions(user_id);
-- Full index (PG erlaubt kein now() in partial index predicate — STABLE statt
-- IMMUTABLE). Geringfuegig groesser, fuer unser Volumen egal.
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
    ON user_sessions(expires_at);

-- View fuer Lifetime/Season-Refresh-Loop im Poller: qualified-co-players
-- pro Tenant (mit shared_matches). Aequivalent zur SQLite-Variante
-- in pubg/db.py, aber tenant-aware.
CREATE OR REPLACE VIEW qualified_co_players AS
SELECT
    p.tenant_id,
    p.account_id,
    p.name,
    COUNT(DISTINCT pa.match_id) AS shared_matches
FROM participants pa
JOIN players p
  ON p.tenant_id = pa.tenant_id AND p.account_id = pa.account_id
WHERE p.is_self = 0
GROUP BY p.tenant_id, p.account_id, p.name;
ALTER VIEW qualified_co_players OWNER TO obs_stream;
