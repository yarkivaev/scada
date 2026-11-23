CREATE TEMP TABLE fold_islands AS
WITH src AS (
    SELECT ctid, machine, kind, name, start_time, end_time, duration, tags,
           max(end_time) OVER (
               PARTITION BY machine, kind, name, coalesce(tags, '')
               ORDER BY start_time, end_time
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ) AS prev_max
    FROM segments
    WHERE kind = 'phase'
      AND coalesce(properties, '') NOT LIKE '%"split_of"%'
),
flagged AS (
    SELECT *,
           sum(CASE WHEN prev_max IS NULL OR start_time >= prev_max THEN 1 ELSE 0 END)
               OVER (PARTITION BY machine, kind, name, coalesce(tags, '')
                     ORDER BY start_time, end_time) AS island
    FROM src
),
bounds AS (
    SELECT machine, kind, name, coalesce(tags, '') AS tags, island,
           max(end_time) AS keep_end,
           (array_agg(ctid ORDER BY start_time, end_time))[1] AS keep_ctid
    FROM flagged
    GROUP BY 1, 2, 3, 4, 5
)
SELECT flagged.ctid AS row_ctid, bounds.keep_ctid, bounds.keep_end
FROM flagged
JOIN bounds
  ON flagged.machine = bounds.machine
 AND flagged.kind = bounds.kind
 AND flagged.name = bounds.name
 AND coalesce(flagged.tags, '') = bounds.tags
 AND flagged.island = bounds.island;

UPDATE segments
SET end_time = fold_islands.keep_end,
    duration = CASE WHEN segments.duration = 0 THEN 0
                    ELSE extract(epoch FROM fold_islands.keep_end - segments.start_time) END,
    updated_at = clock_timestamp()
FROM fold_islands
WHERE segments.ctid = fold_islands.keep_ctid
  AND segments.end_time IS DISTINCT FROM fold_islands.keep_end;

DELETE FROM segments
WHERE ctid IN (
    SELECT row_ctid FROM fold_islands WHERE row_ctid <> keep_ctid
);

DROP TABLE fold_islands;
