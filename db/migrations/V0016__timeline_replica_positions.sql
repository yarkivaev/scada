CREATE TABLE timeline_replica_positions (
    machine TEXT NOT NULL,
    kind TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    origin UUID NOT NULL,
    position BIGINT NOT NULL,
    PRIMARY KEY (machine,kind,start_time,origin)
);
