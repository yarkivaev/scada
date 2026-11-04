CREATE TABLE IF NOT EXISTS history_observations (
    machine TEXT NOT NULL,
    channel TEXT NOT NULL,
    time_ms BIGINT NOT NULL,
    event_id TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (machine, channel, time_ms),
    UNIQUE (machine, event_id)
);
CREATE TABLE IF NOT EXISTS history_work (
    id UUID PRIMARY KEY,
    machine TEXT NOT NULL,
    from_ms BIGINT NOT NULL,
    until_ms BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS history_work_machine ON history_work(machine, created_at);
CREATE TABLE IF NOT EXISTS history_annotations (
    machine TEXT NOT NULL,
    kind TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    name TEXT NOT NULL,
    end_time TIMESTAMPTZ,
    duration DOUBLE PRECISION,
    tags TEXT,
    properties TEXT,
    PRIMARY KEY(machine,kind,start_time,name)
);
