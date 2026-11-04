-- Review-only migration source. Applied only during a separately authorized deployment.
GRANT SELECT, INSERT, DELETE ON history_observations TO supervisor_sink;
GRANT SELECT, INSERT, UPDATE, DELETE ON history_work TO supervisor_sink;
GRANT SELECT, INSERT, DELETE ON history_topics TO supervisor_sink;
GRANT SELECT, INSERT, UPDATE ON history_annotations TO supervisor_sink;
