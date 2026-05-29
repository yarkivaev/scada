ALTER TABLE IF EXISTS metrics OWNER TO supervisor_sink;

GRANT SELECT, INSERT, UPDATE, DELETE ON metrics TO supervisor_sink;
GRANT DELETE ON segments TO supervisor_sink;
GRANT DELETE ON alerts TO supervisor_sink;
GRANT DELETE ON user_decisions TO supervisor_sink;

ALTER TABLE IF EXISTS user_decisions OWNER TO supervisor_sink;
