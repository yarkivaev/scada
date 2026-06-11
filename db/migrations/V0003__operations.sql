CREATE TABLE IF NOT EXISTS operations (
    machine TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    payload JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operations_key
    ON operations (key);
