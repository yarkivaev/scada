/**
 * Postgres port for intervalFold.
 *
 * @param {object} pool - pg Pool
 * @returns {object} open begin extend finish
 *
 * @example
 *   const port = intervalFoldPg(pool);
 *   const open = await port.open('cm8', 'ladle_moving');
 */
export default function intervalFoldPg(pool) {
    return {
        async open(machine, kind) {
            const result = await pool.query(
                `SELECT machine, kind, name, start_time, end_time
                 FROM segments
                 WHERE machine = $1 AND kind = $2 AND duration = 0
                 ORDER BY start_time DESC LIMIT 1`,
                [machine, kind]
            );
            return result.rows[0] || null;
        },
        async begin(sample) {
            const start = new Date(sample.ts).toISOString();
            await pool.query(
                `INSERT INTO segments (machine, kind, name, start_time, end_time, duration, resolved, consumed)
                 VALUES ($1, $2, $3, $4, $4, 0, TRUE, TRUE)`,
                [sample.machine, sample.kind, sample.name, start]
            );
        },
        async extend(row, ts) {
            await pool.query(
                `UPDATE segments SET end_time = $1
                 WHERE machine = $2 AND kind = $3 AND start_time = $4 AND duration = 0`,
                [new Date(ts).toISOString(), row.machine, row.kind, row.start_time]
            );
        },
        async finish(row, ts) {
            const end = new Date(ts);
            const start = new Date(row.start_time);
            const duration = Math.max(1, Math.round((end.getTime() - start.getTime()) / 1000));
            await pool.query(
                `UPDATE segments SET end_time = $1, duration = $2
                 WHERE machine = $3 AND kind = $4 AND start_time = $5 AND duration = 0`,
                [end.toISOString(), duration, row.machine, row.kind, row.start_time]
            );
        }
    };
}
