ALTER TABLE history_replica_outbox ADD COLUMN origin UUID;

CREATE TABLE timeline_replica_origin (
    singleton BOOLEAN PRIMARY KEY CHECK (singleton),
    id UUID NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO timeline_replica_origin(singleton) VALUES(true);

CREATE OR REPLACE FUNCTION history_capture_replica() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE setting TEXT; target JSONB; identity TEXT; persisted JSONB; key RECORD; source UUID; sequence BIGINT;
BEGIN
    setting := current_setting('scada.history_replica', true);
    IF setting IS NULL OR setting = '' THEN RETURN NULL; END IF;
    target := setting::jsonb;
    IF target->>'protocol' = 'transactional-history-outbox-v2' THEN
        SELECT id INTO STRICT source FROM timeline_replica_origin WHERE singleton;
    END IF;

    FOR key IN
        SELECT DISTINCT touched.machine, touched.kind, touched.start_time
        FROM (VALUES (NEW.machine,NEW.kind,NEW.start_time), (OLD.machine,OLD.kind,OLD.start_time))
             AS touched(machine,kind,start_time)
        WHERE touched.machine=target->>'machine'
          AND (source IS NOT NULL OR (TG_OP<>'DELETE' AND touched.kind=NEW.kind AND touched.start_time=NEW.start_time))
    LOOP
        SELECT to_jsonb(s) INTO persisted FROM segments s
            WHERE s.machine=key.machine AND s.kind=key.kind AND s.start_time=key.start_time;
        IF NOT FOUND THEN
            IF source IS NULL THEN CONTINUE; END IF;
            persisted := jsonb_build_object('kind',key.kind,'start_time',key.start_time);
        END IF;
        identity := 'history:' || encode(sha256(convert_to(jsonb_build_array(
            target->>'outputId', key.kind, extract(epoch FROM key.start_time)
        )::text, 'UTF8')), 'hex');
        INSERT INTO history_replica_outbox(machine,exchange,routing_key,output_id,epoch,segment,origin)
            VALUES(key.machine,target->>'exchange',target->>'routingKey',identity,(target->>'epoch')::bigint,persisted,source)
            ON CONFLICT(machine,output_id) DO UPDATE SET segment=EXCLUDED.segment
            RETURNING id INTO sequence;
        IF source IS NOT NULL THEN
            INSERT INTO timeline_replica_positions(machine,kind,start_time,origin,position)
                VALUES(key.machine,key.kind,key.start_time,source,sequence)
                ON CONFLICT(machine,kind,start_time,origin) DO UPDATE
                SET position=greatest(timeline_replica_positions.position,EXCLUDED.position);
        END IF;
    END LOOP;
    RETURN NULL;
END $$;

DROP TRIGGER history_capture_replica ON segments;
CREATE CONSTRAINT TRIGGER history_capture_replica
    AFTER INSERT OR UPDATE OR DELETE ON segments DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION history_capture_replica();
