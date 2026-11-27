CREATE TABLE IF NOT EXISTS segment_write_receipts (
    machine text NOT NULL,
    output_id text NOT NULL,
    fingerprint text NOT NULL,
    outcome jsonb NOT NULL,
    PRIMARY KEY (machine, output_id)
);
