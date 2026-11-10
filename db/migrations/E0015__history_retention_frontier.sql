-- O(number of raw backends), never a registry of measurements.
CREATE TABLE IF NOT EXISTS history_retention (
    source_id TEXT PRIMARY KEY,
    retained_from BIGINT NOT NULL
);
ALTER TABLE history_admissions ADD COLUMN IF NOT EXISTS admitted_at BIGINT;
ALTER TABLE history_annotations ADD COLUMN IF NOT EXISTS consumed BOOLEAN DEFAULT true;
