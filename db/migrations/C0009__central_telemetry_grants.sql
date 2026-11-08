GRANT SELECT, INSERT ON central_metric_receipts, central_metric_buckets TO supervisor_sink;
GRANT SELECT, INSERT, UPDATE, DELETE ON central_metric_outbox TO supervisor_sink;
GRANT USAGE, SELECT ON SEQUENCE central_metric_outbox_seq_seq TO supervisor_sink;
