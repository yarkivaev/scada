import segmentContinue from '../../../domain/segment/segmentContinue.js';

function pointed(record) {
    if (record.duration !== 0) {
        return record;
    }
    return { ...record, end_time: record.start_time };
}

function behind(record, prior, preserveCoverage) {
    return (preserveCoverage || record.duration === 0) && Boolean(prior) && prior.name !== record.name
        && Date.parse(record.start_time) < Date.parse(prior.start_time);
}

function placed(record, prior, apply, preserveCoverage) {
    if (behind(record, prior, preserveCoverage)) {
        const start = new Date(prior.end_time).toISOString();
        return { ...record, start_time: start, end_time: start, duration: 0 };
    }
    const row = apply(record, prior);
    return preserveCoverage ? row : pointed(row);
}

/**
 * Loads the latest segment row visible to this write.
 *
 * @param {object} runner - pg client or pool
 * @param {object} record - incoming segment record
 * @returns {Promise<object|undefined>} latest row
 */
async function latest(runner, record) {
    const result = await runner.query(
        `SELECT name, start_time, end_time, duration
         FROM segments
         WHERE machine = $1 AND kind = $2
         ORDER BY start_time DESC
         LIMIT 1`,
        [record.machine, record.kind || 'phase']
    );
    return result.rows[0];
}

async function reopenContinuation(client, record, prior, next) {
    // The original start proves this heartbeat follows the closed row. A replay
    // at the old start alone cannot reopen it after conversion to a pending point.
    if (client && record.duration === 0 && prior?.duration > 0 &&
        Date.parse(record.start_time) > Date.parse(prior.end_time) &&
        Date.parse(next.start_time) === Date.parse(prior.start_time)) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`history:${record.machine}`]);
        await client.query(
            `UPDATE segments SET duration=0,end_time=start_time,updated_at=clock_timestamp()
             WHERE machine=$1 AND kind=$2 AND start_time=$3 AND end_time=$4 AND name=$5 AND duration>0
               AND NOT EXISTS (SELECT 1 FROM segments later
                 WHERE later.machine=$1 AND later.kind=$2 AND later.start_time>$3)`,
            [record.machine, record.kind || 'phase', prior.start_time, prior.end_time, prior.name]
        );
    }
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
export default function continuedSegments(inner, pool, budgetSeconds, { preserveCoverage = false, isAuthoritative = () => { return false; } } = {}) {
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
                const previous = seen.get(key);
                const row = isAuthoritative(record) ? record : placed(record, previous, apply, preserveCoverage);
                if (!preserveCoverage) { await reopenContinuation(client, record, previous, row); }
                seen.set(key, row);
                rows.push(row);
                return { rows, seen };
            }, Promise.resolve({ rows: [], seen: new Map() }));
            return inner.write(next.rows, client);
        }
    };
}
