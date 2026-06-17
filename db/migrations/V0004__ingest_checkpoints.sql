CREATE TABLE IF NOT EXISTS ingest_checkpoints (
    source TEXT NOT NULL,
    machine TEXT NOT NULL,
    cursor_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source, machine)
);
