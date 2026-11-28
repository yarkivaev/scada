import historyFold from '../../../domain/segment/historyFold.js';
import historyAbsorb from '../../persistence/pg/historyAbsorb.js';

function uniqueStarts(records) {
    const kept = new Map();
    for (const row of records) {
        const key = `${row.machine}\0${row.kind || 'phase'}\0${new Date(row.start_time).toISOString()}`;
        const prev = kept.get(key);
        if (!prev || Date.parse(row.end_time) >= Date.parse(prev.end_time)) {
            kept.set(key, row);
        }
    }
    return [...kept.values()];
}

async function foldMachine(runner, machine, batch, { preserveCoverage, isAuthoritative }) {
    const inferred = batch.filter((row) => { return !isAuthoritative(row); });
    if (!inferred.length || (preserveCoverage && inferred.every((row) => { return row.duration === 0; }))) {
        return uniqueStarts(batch);
    }
    await runner.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`history:${machine}`]);
    const folded = await historyAbsorb(runner, machine, uniqueStarts(historyFold([], inferred)));
    return folded.concat(batch.filter(isAuthoritative));
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

function foldAll(runner, groups, policy) {
    return [...groups].reduce(async (prior, [machine, batch]) => {
        const acc = await prior;
        acc.push(...await foldMachine(runner, machine, batch, policy));
        return acc;
    }, Promise.resolve([]));
}

function stamped(records) {
    const now = new Date().toISOString();
    return records.map((row) => {
        return { ...row, updated_at: row.updated_at ?? now };
    });
}

async function writeOwned(pool, inner, records, policy) {
    if (typeof pool.connect !== 'function') {
        const next = stamped(uniqueStarts(await foldAll(pool, grouped(records), policy)));
        return inner.write(next, pool);
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const next = stamped(uniqueStarts(await foldAll(client, grouped(records), policy)));
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
export default function foldingSegments(inner, pool, { preserveCoverage = false, isAuthoritative = () => { return false; } } = {}) {
    const policy = { preserveCoverage, isAuthoritative };
    return {
        async write(records, client) {
            if (client && typeof client.query === 'function') {
                return inner.write(stamped(uniqueStarts(await foldAll(client, grouped(records), policy))), client);
            }
            return writeOwned(pool, inner, records, policy);
        }
    };
}
