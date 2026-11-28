GRANT SELECT, INSERT, UPDATE, DELETE ON history_replica_outbox TO supervisor_sink;
GRANT USAGE ON SEQUENCE history_replica_outbox_id_seq TO supervisor_sink;
