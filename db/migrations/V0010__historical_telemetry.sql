CREATE TABLE IF NOT EXISTS history_observations (
    machine TEXT NOT NULL,
    channel TEXT NOT NULL,
    time_ms BIGINT NOT NULL,
    event_id TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (machine, channel, time_ms),
    UNIQUE (machine, event_id)
);
CREATE INDEX IF NOT EXISTS history_observations_time ON history_observations(machine,time_ms);
CREATE TABLE IF NOT EXISTS history_work (
    id UUID PRIMARY KEY,
    token UUID NOT NULL DEFAULT gen_random_uuid(),
    machine TEXT NOT NULL,
    from_ms BIGINT NOT NULL,
    until_ms BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS history_work_machine ON history_work(machine, created_at);
CREATE TABLE IF NOT EXISTS history_annotations (
    machine TEXT NOT NULL,
    kind TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    name TEXT NOT NULL,
    end_time TIMESTAMPTZ,
    duration DOUBLE PRECISION,
    tags TEXT,
    properties TEXT,
    resolved BOOLEAN,
    PRIMARY KEY(machine,kind,start_time,name)
);
CREATE TABLE IF NOT EXISTS history_topics (
    machine TEXT NOT NULL,
    topic TEXT NOT NULL,
    channel TEXT NOT NULL,
    bucket_ms BIGINT NOT NULL DEFAULT 30000 CHECK(bucket_ms > 0),
    retention_days INTEGER NOT NULL DEFAULT 30 CHECK(retention_days > 0),
    PRIMARY KEY(machine,topic)
);
CREATE OR REPLACE FUNCTION history_from_metric() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE mapping RECORD; moment BIGINT; inserted INTEGER;
BEGIN
    moment := floor(extract(epoch FROM NEW.ts)*1000)::bigint;
    FOR mapping IN SELECT * FROM history_topics WHERE topic=NEW.topic LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended('history:'||mapping.machine,0));
        INSERT INTO history_observations(machine,channel,time_ms,event_id,value)
          VALUES(mapping.machine,mapping.channel,moment,md5(NEW.topic||':'||moment::text||':'||NEW.value::text),NEW.value)
          ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS inserted = ROW_COUNT;
        IF inserted > 0 AND NEW.ts >= now()-make_interval(days => mapping.retention_days) THEN
            INSERT INTO history_work(id,machine,from_ms,until_ms)
              VALUES(md5(mapping.machine||':'||(moment/mapping.bucket_ms)::text)::uuid,mapping.machine,moment,moment)
              ON CONFLICT(id) DO UPDATE SET token=gen_random_uuid(),from_ms=least(history_work.from_ms,excluded.from_ms),until_ms=greatest(history_work.until_ms,excluded.until_ms);
        END IF;
    END LOOP;
    RETURN NEW;
END $$;
DO $$ BEGIN
    IF to_regclass('metrics') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS metrics_history ON metrics;
        CREATE TRIGGER metrics_history AFTER INSERT ON metrics FOR EACH ROW EXECUTE FUNCTION history_from_metric();
    END IF;
END $$;
