-- Opt-in first-write-wins receipts survive receiver restart and raw metric retention.
CREATE TABLE IF NOT EXISTS metric_receipts (
    topic TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    PRIMARY KEY(topic,ts)
);
