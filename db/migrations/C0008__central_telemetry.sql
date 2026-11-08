-- Receipts and bucket decisions intentionally have no TTL: arbitrary late replays
-- must keep the original decision, including deliberately thinned observations.
CREATE TABLE IF NOT EXISTS central_metric_receipts (
    topic TEXT NOT NULL CHECK (length(topic) BETWEEN 1 AND 1024),
    ts_ms BIGINT NOT NULL,
    PRIMARY KEY (topic, ts_ms)
);
CREATE TABLE IF NOT EXISTS central_metric_buckets (
    topic TEXT NOT NULL,
    window_ms BIGINT NOT NULL CHECK (window_ms > 0),
    bucket BIGINT NOT NULL,
    PRIMARY KEY (topic, window_ms, bucket)
);
CREATE TABLE IF NOT EXISTS central_metric_outbox (
    seq BIGSERIAL UNIQUE NOT NULL,
    topic TEXT NOT NULL,
    ts_ms BIGINT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (topic, ts_ms),
    FOREIGN KEY (topic, ts_ms) REFERENCES central_metric_receipts(topic, ts_ms)
);
