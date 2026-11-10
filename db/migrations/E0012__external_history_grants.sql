GRANT SELECT, INSERT, DELETE ON history_admissions TO supervisor_sink;
GRANT SELECT, INSERT, UPDATE, DELETE ON history_classifiers TO supervisor_sink;
GRANT SELECT, INSERT, UPDATE, DELETE ON history_checkpoints TO supervisor_sink;
GRANT SELECT, INSERT ON history_sources TO supervisor_sink;
