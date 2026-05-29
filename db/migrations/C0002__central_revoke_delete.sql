REVOKE ALL ON SCHEMA public FROM supervisor_sink;
GRANT USAGE ON SCHEMA public TO supervisor_sink;

GRANT SELECT, INSERT, UPDATE ON segments TO supervisor_sink;
GRANT SELECT, INSERT, UPDATE ON alerts TO supervisor_sink;
GRANT SELECT, INSERT ON user_decisions TO supervisor_sink;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO supervisor_sink;

REVOKE CREATE ON SCHEMA public FROM supervisor_sink;
REVOKE DELETE ON segments FROM supervisor_sink;
REVOKE DELETE ON alerts FROM supervisor_sink;
REVOKE DELETE ON user_decisions FROM supervisor_sink;
