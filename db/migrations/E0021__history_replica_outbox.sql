CREATE TABLE history_replica_outbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    machine TEXT NOT NULL,
    exchange TEXT NOT NULL,
    routing_key TEXT NOT NULL,
    output_id TEXT NOT NULL,
    epoch BIGINT,
    segment JSONB NOT NULL,
    retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (machine, output_id)
);
CREATE INDEX history_replica_outbox_machine_order ON history_replica_outbox(machine,id);

-- The history transaction enables capture after validating its claim and fence.
-- Staged pages touch history_corrections only. The final page publishes the
-- actual rows written to segments, including cuts and inherited annotations.
CREATE FUNCTION history_capture_replica() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE setting TEXT; target JSONB; identity TEXT; persisted JSONB;
BEGIN
    setting := current_setting('scada.history_replica', true);
    IF setting IS NULL OR setting = '' THEN RETURN NEW; END IF;
    target := setting::jsonb;
    IF NEW.machine <> target->>'machine' THEN RETURN NEW; END IF;
    SELECT to_jsonb(s) INTO persisted FROM segments s
        WHERE s.machine=NEW.machine AND s.kind=NEW.kind AND s.start_time=NEW.start_time;
    IF NOT FOUND THEN RETURN NEW; END IF;
    identity := 'history:' || encode(sha256(convert_to(jsonb_build_array(
        target->>'outputId', NEW.kind, extract(epoch FROM NEW.start_time)
    )::text, 'UTF8')), 'hex');
    INSERT INTO history_replica_outbox(machine,exchange,routing_key,output_id,epoch,segment)
        VALUES(NEW.machine,target->>'exchange',target->>'routingKey',identity,(target->>'epoch')::bigint,persisted)
        ON CONFLICT(machine,output_id) DO UPDATE SET segment=EXCLUDED.segment;
    RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER history_capture_replica
    AFTER INSERT OR UPDATE ON segments DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION history_capture_replica();
