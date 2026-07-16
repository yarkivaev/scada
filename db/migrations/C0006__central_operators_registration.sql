CREATE TABLE IF NOT EXISTS operators_registration (
    singleton SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO operators_registration (singleton, enabled)
VALUES (1, FALSE)
ON CONFLICT (singleton) DO NOTHING;

GRANT INSERT ON operators TO supervisor_sink;
GRANT USAGE, SELECT ON SEQUENCE operators_id_seq TO supervisor_sink;
GRANT SELECT, UPDATE ON operators_registration TO supervisor_sink;
