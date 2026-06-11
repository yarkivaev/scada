/**
 * PostgreSQL ingest checkpoint port for poll cursor storage per machine and kind.
 *
 * @param {object} pool - pg pool
 * @returns {object} ingest checkpoint port with read and upsert
 *
 * @example
 *   const store = ingestCheckpointStatePg(pool);
 *   await store.upsert('icht1', 'chem', new Date());
 */
export default function ingestCheckpointStatePg(pool) {
    return {
        async read(machineId, kind) {
            const result = await pool.query(
                `SELECT machine, kind, cursor_at, updated_at
                 FROM ingest_checkpoints WHERE machine = $1 AND kind = $2`,
                [machineId, kind]
            );
            return result.rows[0] ?? null;
        },
        async upsert(machineId, kind, cursorAt) {
            await pool.query(
                `INSERT INTO ingest_checkpoints (machine, kind, cursor_at, updated_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (machine, kind) DO UPDATE SET
                    cursor_at = EXCLUDED.cursor_at,
                    updated_at = NOW()`,
                [machineId, kind, cursorAt]
            );
        }
    };
}
