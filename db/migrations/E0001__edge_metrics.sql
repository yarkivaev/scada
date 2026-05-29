CREATE TABLE IF NOT EXISTS metrics (
    topic TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_topic_ts
    ON metrics (topic, ts);
