-- Temporary cross-database barriers contain identity/range only, never numeric payloads.
CREATE TABLE IF NOT EXISTS history_admissions (
    event_id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    time_ms BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS history_admissions_topic ON history_admissions(topic,time_ms);
