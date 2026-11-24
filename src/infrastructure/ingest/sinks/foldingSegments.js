import historyAbsorb, { historyDedupe } from '../../persistence/pg/historyAbsorb.js';

async function foldMachine(runner, machine, batch) {
    const folded = await historyAbsorb(runner, machine, batch);
    await historyDedupe(runner, machine);
    return folded;
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
            const runner = client && typeof client.query === 'function' ? client : pool;
            const groups = new Map();
            for (const record of records) {
                const batch = groups.get(record.machine) ?? [];
                batch.push(record);
                groups.set(record.machine, batch);
            }
            const next = await [...groups].reduce(async (prior, [machine, batch]) => {
                const acc = await prior;
                acc.push(...await foldMachine(runner, machine, batch));
                return acc;
            }, Promise.resolve([]));
            return inner.write(next, client);
        }
    };
}
