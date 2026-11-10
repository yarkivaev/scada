CREATE TABLE IF NOT EXISTS history_classifiers (
    machine TEXT PRIMARY KEY,
    classifier_key TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history_checkpoints (
    machine TEXT NOT NULL,
    classifier_key TEXT NOT NULL,
    time_ms BIGINT NOT NULL,
    state JSONB NOT NULL,
    valid BOOLEAN NOT NULL DEFAULT true,
    PRIMARY KEY(machine,classifier_key,time_ms)
);
