-- Singleton flag: HMI may register operators only while enabled is true.
-- CHECK keeps exactly one row (singleton = 1); default disabled until console turns registration on.
CREATE TABLE IF NOT EXISTS operators_registration (
    singleton SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE
);

-- Seed the singleton on first apply; keep an existing enabled value on re-apply.
INSERT INTO operators_registration (singleton, enabled)
VALUES (1, FALSE)
ON CONFLICT (singleton) DO NOTHING;

-- Plant API role: create operators and read/update the registration flag.
GRANT INSERT ON operators TO supervisor_sink;
GRANT USAGE, SELECT ON SEQUENCE operators_id_seq TO supervisor_sink;
GRANT SELECT, UPDATE ON operators_registration TO supervisor_sink;
