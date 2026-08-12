CREATE INDEX IF NOT EXISTS idx_operations_machine_kind_time
    ON operations (machine, kind, occurred_at);
