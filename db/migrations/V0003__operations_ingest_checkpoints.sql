CREATE TABLE IF NOT EXISTS operations (
    machine TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    kind TEXT NOT NULL,
    external_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    source_updated_at TIMESTAMPTZ NOT NULL,
    source_id TEXT NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operations_external_key
    ON operations (external_key);
