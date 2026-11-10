GRANT SELECT, INSERT, UPDATE, DELETE ON history_corrections TO supervisor_sink;
GRANT SELECT, INSERT, UPDATE, DELETE ON history_staged_checkpoints TO supervisor_sink;
GRANT SELECT, INSERT, UPDATE, DELETE ON segments TO supervisor_sink;
REVOKE ALL ON FUNCTION history_apply_correction(UUID,TEXT,INTEGER,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION history_apply_correction(UUID,TEXT,INTEGER,BOOLEAN) TO supervisor_sink;
