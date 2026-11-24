import historyAbsorb, { historyDedupe, span } from '../../persistence/pg/historyAbsorb.js';

async function foldMachine(runner, machine, batch) {
    await runner.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`history:${machine}`]);
    const folded = await historyAbsorb(runner, machine, batch);
    await historyDedupe(runner, machine, span(batch));
    return folded;
}

function grouped(records) {
    const groups = new Map();
    for (const record of records) {
        const batch = groups.get(record.machine) ?? [];
        batch.push(record);
        groups.set(record.machine, batch);
    }
    return groups;
}

function foldAll(runner, groups) {
    return [...groups].reduce(async (prior, [machine, batch]) => {
        const acc = await prior;
        acc.push(...await foldMachine(runner, machine, batch));
        return acc;
    }, Promise.resolve([]));
}

async function writeOwned(pool, inner, records) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const next = await foldAll(client, grouped(records));
        const result = await inner.write(next, client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Folds overlapping phases into stored rows before the inner postgres write.
 *
 * @param {object} inner - postgres segment sink
 * @param {object} pool - pg pool used when no transaction client is passed
 * @returns {object} sink with write(records, client)
 *
 * @example
 *   const sink = foldingSegments(segmentSink, pool);
 *   await sink.write([record], client);
 */
export default function foldingSegments(inner, pool) {
    return {
        async write(records, client) {
            if (client && typeof client.query === 'function') {
                return inner.write(await foldAll(client, grouped(records)), client);
            }
            return writeOwned(pool, inner, records);
        }
    };
}
