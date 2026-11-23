CREATE OR REPLACE FUNCTION skip_covered_unsplit_phase() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM 'phase' THEN
    RETURN NEW;
  END IF;
  IF coalesce(NEW.properties, '') LIKE '%"split_of"%' THEN
    RETURN NEW;
  END IF;
  UPDATE segments AS host
  SET end_time = GREATEST(host.end_time, NEW.end_time),
      duration = CASE WHEN host.duration = 0 THEN 0
                      ELSE extract(epoch FROM GREATEST(host.end_time, NEW.end_time) - host.start_time) END,
      updated_at = clock_timestamp()
  WHERE host.machine = NEW.machine AND host.kind = 'phase'
    AND host.name = NEW.name
    AND coalesce(host.tags, '') = coalesce(NEW.tags, '')
    AND coalesce(host.properties, '') NOT LIKE '%"split_of"%'
    AND NEW.start_time > host.start_time
    AND NEW.start_time < host.end_time;
  IF FOUND THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS skip_covered_unsplit_phase ON segments;
CREATE TRIGGER skip_covered_unsplit_phase
BEFORE INSERT ON segments
FOR EACH ROW
EXECUTE PROCEDURE skip_covered_unsplit_phase();
