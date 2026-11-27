GRANT SELECT, INSERT, UPDATE ON classifier_generation TO supervisor_sink;
GRANT SELECT, INSERT ON segment_write_receipts TO supervisor_sink;
GRANT SELECT, INSERT, UPDATE ON segment_timeline_revisions TO supervisor_sink;
GRANT SELECT, INSERT, UPDATE ON stream_worker_checkpoint TO supervisor_sink;
