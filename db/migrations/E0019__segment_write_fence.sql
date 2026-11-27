CREATE TABLE IF NOT EXISTS classifier_generation (
    machine text PRIMARY KEY,
    generation bigint NOT NULL
);
ALTER TABLE classifier_generation ADD COLUMN IF NOT EXISTS holder_pid integer;

CREATE TABLE IF NOT EXISTS segment_timeline_revisions (
    machine text PRIMARY KEY,
    revision bigint NOT NULL
);

CREATE OR REPLACE FUNCTION bump_segment_timeline_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
        RETURN NULL;
    END IF;
    IF TG_OP <> 'INSERT' THEN
        INSERT INTO segment_timeline_revisions VALUES (OLD.machine, 1)
        ON CONFLICT (machine) DO UPDATE SET revision = segment_timeline_revisions.revision + 1;
    END IF;
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.machine <> OLD.machine) THEN
        INSERT INTO segment_timeline_revisions VALUES (NEW.machine, 1)
        ON CONFLICT (machine) DO UPDATE SET revision = segment_timeline_revisions.revision + 1;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER segments_timeline_revision
AFTER INSERT OR UPDATE OR DELETE ON segments
FOR EACH ROW EXECUTE FUNCTION bump_segment_timeline_revision();

CREATE TRIGGER contiguous_inbox_timeline_revision
AFTER INSERT OR UPDATE OR DELETE ON contiguous_phase_inbox
FOR EACH ROW EXECUTE FUNCTION bump_segment_timeline_revision();
