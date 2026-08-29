ALTER TABLE segments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'phase';

DROP INDEX IF EXISTS idx_segments_machine_start;

CREATE UNIQUE INDEX IF NOT EXISTS idx_segments_machine_kind_start
    ON segments (machine, kind, start_time);
