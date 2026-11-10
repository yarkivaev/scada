ALTER TABLE history_annotations ADD COLUMN IF NOT EXISTS consumed BOOLEAN DEFAULT true;
ALTER TABLE history_work ADD COLUMN IF NOT EXISTS generation UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE history_work ADD COLUMN IF NOT EXISTS correction_from BIGINT;
ALTER TABLE history_work ADD COLUMN IF NOT EXISTS correction_until BIGINT;
ALTER TABLE history_work ADD COLUMN IF NOT EXISTS classifier_checkpoint JSONB;
ALTER TABLE history_work ADD COLUMN IF NOT EXISTS started BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS history_corrections (
    work_id UUID NOT NULL REFERENCES history_work(id) ON DELETE CASCADE,
    generation UUID NOT NULL,
    machine TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration DOUBLE PRECISION NOT NULL,
    options TEXT, tags TEXT, properties TEXT, resolved BOOLEAN,
    PRIMARY KEY(work_id,generation,kind,start_time)
);
CREATE TABLE IF NOT EXISTS history_staged_checkpoints (
    work_id UUID NOT NULL REFERENCES history_work(id) ON DELETE CASCADE,
    generation UUID NOT NULL,
    machine TEXT NOT NULL,
    classifier_key TEXT NOT NULL,
    time_ms BIGINT NOT NULL,
    state JSONB NOT NULL,
    PRIMARY KEY(work_id,generation,classifier_key,time_ms)
);
CREATE INDEX IF NOT EXISTS history_annotations_semantic ON history_annotations(machine,kind,name,start_time);

-- Invoker privileges, transactional caller fencing and original annotation extents are preserved.
CREATE OR REPLACE FUNCTION history_apply_correction(p_work UUID,p_machine TEXT,p_scale INTEGER,p_converged BOOLEAN)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE w history_work%ROWTYPE; item history_corrections%ROWTYPE; owner history_annotations%ROWTYPE;
    tail segments%ROWTYPE; lo TIMESTAMPTZ; hi TIMESTAMPTZ; a TIMESTAMPTZ; b TIMESTAMPTZ;
    incoming JSONB; inherited JSONB; endpoint_cut BOOLEAN; inserted INTEGER := 0; keys TEXT[] := ARRAY['casting','cadence_rule','cadence_threshold_ms','casting_detected_at','source_interrupted'];
BEGIN
    SELECT * INTO STRICT w FROM history_work WHERE id=p_work AND machine=p_machine;
    IF p_converged THEN
        FOR item IN SELECT * FROM history_corrections WHERE work_id=w.id AND generation=w.generation AND duration=0 LOOP
            SELECT * INTO tail FROM segments WHERE machine=p_machine AND kind=item.kind AND name=item.name
                AND start_time<=item.end_time AND end_time>item.end_time ORDER BY end_time DESC LIMIT 1;
            IF FOUND THEN
                UPDATE history_corrections SET end_time=tail.end_time,
                    duration=CASE WHEN tail.duration=0 THEN 0 ELSE extract(epoch FROM tail.end_time-item.start_time) END
                    WHERE work_id=w.id AND generation=w.generation AND kind=item.kind AND start_time=item.start_time;
            END IF;
        END LOOP;
    END IF;
    lo := 'epoch'::timestamptz+(w.correction_from/p_scale)*interval '1 millisecond';
    hi := 'epoch'::timestamptz+(w.correction_until/p_scale)*interval '1 millisecond';
    SELECT least(lo,COALESCE(min(start_time),lo)),greatest(hi,COALESCE(max(end_time),hi)) INTO lo,hi
        FROM history_corrections WHERE work_id=w.id AND generation=w.generation;
    INSERT INTO history_annotations(machine,kind,start_time,name,end_time,duration,tags,properties,resolved,consumed)
        SELECT machine,kind,start_time,name,end_time,duration,tags,properties,resolved,consumed FROM segments
        WHERE machine=p_machine AND kind='phase' AND start_time<=hi AND end_time>=lo
        ON CONFLICT(machine,kind,start_time,name) DO UPDATE SET end_time=greatest(history_annotations.end_time,EXCLUDED.end_time),
            duration=EXCLUDED.duration,tags=EXCLUDED.tags,properties=EXCLUDED.properties,resolved=EXCLUDED.resolved,consumed=EXCLUDED.consumed;
    UPDATE segments SET end_time=lo,duration=greatest(0,extract(epoch FROM lo-start_time)),updated_at=clock_timestamp()
        WHERE machine=p_machine AND kind='phase' AND start_time<lo AND end_time>lo;
    DELETE FROM segments WHERE machine=p_machine AND kind='phase' AND start_time>=lo
        AND (start_time<hi OR (start_time=hi AND end_time=hi));
    FOR item IN SELECT * FROM history_corrections WHERE work_id=w.id AND generation=w.generation ORDER BY start_time LOOP
        SELECT EXISTS(SELECT 1 FROM history_annotations WHERE machine=p_machine AND kind=item.kind AND name=item.name
            AND start_time=item.end_time AND end_time=item.end_time) INTO endpoint_cut;
        a := item.start_time;
        FOR b IN SELECT cut FROM (
            SELECT start_time AS cut FROM history_annotations WHERE machine=p_machine AND kind=item.kind
                AND start_time>item.start_time AND start_time<item.end_time
            UNION SELECT item.end_time
        ) boundaries ORDER BY cut LOOP
            SELECT * INTO owner FROM history_annotations WHERE machine=p_machine AND kind=item.kind AND name=item.name
                AND start_time<=a AND start_time<=item.end_time AND end_time>=item.start_time ORDER BY start_time DESC LIMIT 1;
            IF NOT FOUND THEN
                SELECT * INTO owner FROM history_annotations WHERE machine=p_machine AND kind=item.kind AND name=item.name
                    AND start_time>a AND start_time<=item.end_time AND end_time>=item.start_time ORDER BY start_time LIMIT 1;
            END IF;
            incoming := COALESCE(NULLIF(NULLIF(item.properties,''),'null')::jsonb,'{}'::jsonb);
            inherited := COALESCE(NULLIF(NULLIF(owner.properties,''),'null')::jsonb,'{}'::jsonb);
            IF jsonb_typeof(incoming)<>'object' THEN incoming:='{}'::jsonb; END IF;
            IF jsonb_typeof(inherited)<>'object' THEN inherited:='{}'::jsonb; END IF;
            INSERT INTO segments(machine,kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed,updated_at)
                VALUES(p_machine,item.kind,item.name,a,b,CASE WHEN item.duration=0 AND b=item.end_time AND NOT endpoint_cut THEN 0 ELSE extract(epoch FROM b-a) END,
                    item.options,COALESCE(owner.tags,item.tags),(incoming||(inherited-keys))::text,COALESCE(owner.resolved,item.resolved),COALESCE(owner.consumed,true),clock_timestamp())
                ON CONFLICT(machine,kind,start_time) DO UPDATE SET name=EXCLUDED.name,end_time=EXCLUDED.end_time,duration=EXCLUDED.duration,
                    options=EXCLUDED.options,tags=EXCLUDED.tags,properties=EXCLUDED.properties,resolved=EXCLUDED.resolved,consumed=EXCLUDED.consumed,updated_at=EXCLUDED.updated_at;
            inserted:=inserted+1; a:=b;
        END LOOP;
        -- A real user cut at the final singleton is retained; ordinary heartbeat ends are not cuts.
        IF item.start_time<item.end_time AND endpoint_cut THEN
            SELECT * INTO owner FROM history_annotations WHERE machine=p_machine AND kind=item.kind AND name=item.name AND start_time=item.end_time;
            incoming := COALESCE(NULLIF(NULLIF(item.properties,''),'null')::jsonb,'{}'::jsonb);
            inherited := COALESCE(NULLIF(NULLIF(owner.properties,''),'null')::jsonb,'{}'::jsonb);
            IF jsonb_typeof(incoming)<>'object' THEN incoming:='{}'::jsonb; END IF;
            IF jsonb_typeof(inherited)<>'object' THEN inherited:='{}'::jsonb; END IF;
            INSERT INTO segments(machine,kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed)
                VALUES(p_machine,item.kind,item.name,item.end_time,item.end_time,0,item.options,owner.tags,(incoming||(inherited-keys))::text,owner.resolved,COALESCE(owner.consumed,true))
                ON CONFLICT(machine,kind,start_time) DO NOTHING;
        END IF;
    END LOOP;
    INSERT INTO history_checkpoints(machine,classifier_key,time_ms,state,valid)
        SELECT machine,classifier_key,time_ms,state,true FROM history_staged_checkpoints WHERE work_id=w.id AND generation=w.generation
        ON CONFLICT(machine,classifier_key,time_ms) DO UPDATE SET state=EXCLUDED.state,valid=true;
    RETURN inserted;
END $$;
