CREATE TABLE IF NOT EXISTS stream_worker_checkpoint (
    task_id text NOT NULL,
    input_id text NOT NULL,
    run_id text NOT NULL,
    ownership bigint NOT NULL,
    revision bigint NOT NULL CHECK (revision >= 0),
    document jsonb NOT NULL,
    PRIMARY KEY (task_id, input_id, run_id)
);
