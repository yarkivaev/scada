import segmentContinue from '../../../domain/segment/segmentContinue.js';

/**
 * Loads the latest segment row visible to this write.
 *
 * @param {object} runner - pg client or pool
 * @param {object} record - incoming segment record
 * @returns {Promise<object|undefined>} latest row
 */
async function latest(runner, record) {
    const result = await runner.query(
        `SELECT name, start_time, end_time
         FROM segments
         WHERE machine = $1 AND kind = $2
         ORDER BY start_time DESC
         LIMIT 1`,
        [record.machine, record.kind || 'phase']
    );
    return result.rows[0];
}

/**
 * Segment sink that continues the previous row across a restart
 * when metric samples never left the continuity budget.
 *
 * @param {object} inner - postgres segment sink
 * @param {object} pool - pg pool used when no transaction client is passed
 * @param {number} budgetSeconds - segmentation continuity budget
 * @returns {object} sink with write(records, client)
 *
 * @example
 *   const sink = continuedSegments(segmentSink, pool, 30);
 *   await sink.write([record], client);
 */
export default function continuedSegments(inner, pool, budgetSeconds) {
    const apply = segmentContinue(budgetSeconds);
    return {
        async write(records, client) {
            const runner = client && typeof client.query === 'function' ? client : pool;
            const next = await records.reduce(async (prior, record) => {
                const { rows, seen } = await prior;
                const key = `${record.machine}\0${record.kind || 'phase'}`;
                if (!seen.has(key)) {
                    seen.set(key, await latest(runner, record));
                }
                const row = apply(record, seen.get(key));
                seen.set(key, row);
                rows.push(row);
                return { rows, seen };
            }, Promise.resolve({ rows: [], seen: new Map() }));
            return inner.write(next.rows, client);
        }
    };
}
