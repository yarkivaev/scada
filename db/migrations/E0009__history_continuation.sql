ALTER TABLE history_work ADD COLUMN IF NOT EXISTS cursor_ms BIGINT;
ALTER TABLE history_work ADD COLUMN IF NOT EXISTS end_ms BIGINT;
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
              ON CONFLICT(id) DO UPDATE SET token=gen_random_uuid(),cursor_ms=NULL,end_ms=NULL,from_ms=least(history_work.from_ms,excluded.from_ms),until_ms=greatest(history_work.until_ms,excluded.until_ms);
        END IF;
    END LOOP;
    RETURN NEW;
END $$;
