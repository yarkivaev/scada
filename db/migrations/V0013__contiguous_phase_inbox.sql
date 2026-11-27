CREATE TABLE IF NOT EXISTS contiguous_phase_inbox (
    machine text NOT NULL,
    start_time timestamptz NOT NULL,
    phase jsonb NOT NULL,
    PRIMARY KEY (machine, start_time)
);
