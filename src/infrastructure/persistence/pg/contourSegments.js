/**
 * Reads and applies stored segment rows for the edge contour copy.
 * Central keeps the edge row, including tags the regular segment upsert leaves untouched.
 *
 * {{{
 * await contourApply(pool, record);
 * }}}
 */

const pageSql = `SELECT machine, kind, name, start_time, end_time, duration, options, tags, properties, resolved, consumed, updated_at
 FROM segments
 WHERE (updated_at, machine, kind, start_time) > ($1::timestamptz, $2::text, $3::text, $4::timestamptz)
 ORDER BY updated_at, machine, kind, start_time
 LIMIT 50`;

const applySql = `INSERT INTO segments (machine, kind, name, start_time, end_time, duration, options, tags, properties, resolved, consumed, updated_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
 ON CONFLICT (machine, kind, start_time) DO UPDATE SET
 name = EXCLUDED.name, end_time = EXCLUDED.end_time, duration = EXCLUDED.duration,
 options = EXCLUDED.options, tags = EXCLUDED.tags, properties = EXCLUDED.properties,
 resolved = EXCLUDED.resolved, consumed = EXCLUDED.consumed, updated_at = EXCLUDED.updated_at`;

/** Next stored segment rows after the keyset cursor. */
export function contourRead(pool, cursor) {
    return pool.query(pageSql, [cursor.at, cursor.machine, cursor.kind, cursor.start]).then((result) => {
        return result.rows;
    });
}

/** Writes one edge segment over the central row. */
export function contourApply(pool, record, transaction) {
    const db = transaction || pool;
    return db.query(applySql, [record.machine, record.kind, record.name, record.start_time, record.end_time,
        record.duration, record.options, record.tags, record.properties, record.resolved, record.consumed, record.updated_at]);
}

/** Routes a stored edge row around the tag-preserving segment upsert. */
export function contourGate(inner, pool) {
    return {
        accept(record, transaction) {
            if (record.type !== 'contour') { return inner.accept(record, transaction); }
            return contourApply(pool, record, transaction);
        }
    };
}
