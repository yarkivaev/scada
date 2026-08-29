CREATE TABLE IF NOT EXISTS segments (
    machine TEXT,
    name TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    duration FLOAT,
    options TEXT,
    tags TEXT,
    properties TEXT,
    resolved BOOLEAN DEFAULT TRUE,
    consumed BOOLEAN DEFAULT TRUE,
    kind TEXT NOT NULL DEFAULT 'phase'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_segments_machine_kind_start
    ON segments (machine, kind, start_time);

CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    name TEXT,
    message TEXT,
    machine TEXT,
    severity TEXT,
    timestamp TIMESTAMPTZ,
    acknowledged BOOLEAN DEFAULT FALSE
);
