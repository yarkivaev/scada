import { replaceSplit } from './splitFamily.js';
import historyFold from './historyFold.js';
import segmentContinue from './segmentContinue.js';

function pointed(record) {
    if (record.duration !== 0) {
        return record;
    }
    return { ...record, end_time: record.start_time };
}

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

function grouped(records) {
    const groups = new Map();
    for (const record of records) {
        const batch = groups.get(record.machine) ?? [];
        batch.push(record);
        groups.set(record.machine, batch);
    }
    return groups;
}

function continued(records) {
    const apply = segmentContinue(30);
    const seen = new Map();
    return records.map((record) => {
        const key = `${record.machine}\0${record.kind || 'phase'}`;
        const row = apply(record, seen.get(key));
        seen.set(key, row);
        return row;
    });
}

function collapsed(records, preserveCoverage) {
    const next = [];
    for (const batch of grouped(continued(records)).values()) {
        const rows = uniqueStarts(historyFold([], batch));
        next.push(...(preserveCoverage ? rows : rows.map(pointed)));
    }
    return next;
}

/**
 * Persists a pending heartbeat, optionally inside one pool transaction.
 *
 * @param {object} segmentSink - upsert sink
 * @param {object} closer - orphan closer
 * @param {object} [pool] - optional pg pool
 * @param {object} record - normalized segment record
 * @returns {Promise<void>}
 */
async function pendingInClient(segmentSink, closer, record, transaction) {
    await closer.close(record.machine, record.start_time, record.kind || 'phase', transaction, record.name);
    await segmentSink.write([record], transaction);
}
async function persistPending(segmentSink, closer, pool, record) {
    const kind = record.kind || 'phase';
    if (!pool || typeof pool.connect !== 'function') {
        await closer.close(record.machine, record.start_time, kind, null, record.name);
        await segmentSink.write([record]);
        return;
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await closer.close(record.machine, record.start_time, kind, client, record.name);
        await segmentSink.write([record], client);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch((ignored) => { return ignored; });
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Routes normalized segment records to the correct persistence sink.
 *
 * When a pool is supplied, pending segment heartbeats (`duration === 0`)
 * run orphan-close and upsert inside one transaction on a single client.
 *
 * @param {object} segmentSink - batch insert/update sink
 * @param {object} retag - retag sink
 * @param {object} splitSink - split update sink
 * @param {object} closer - orphan open segment closer
 * @param {object} [pool] - optional pg pool for transactional pending writes
 * @returns {object} collector with accept(record)
 *
 * @example
 *   const route = segmentDispatch(segmentSink, retag, splitSink, closer, pool);
 *   await route.accept({ type: 'segment', machine: 'm1', start_time: '...', duration: 0 });
 */
async function acceptFamily(pool, record, transaction) {
    if (!transaction && (!pool || typeof pool.connect !== 'function')) {
        throw new Error('split-family requires a pool');
    }
    await replaceSplit(pool, record, transaction);
}

/** Closes orphan opens before a batched upsert. */
async function closePending(closer, records, transaction) {
    for (const record of records) {
        // eslint-disable-next-line no-await-in-loop
        await closer.close(record.machine, record.start_time, record.kind || 'phase', transaction || null, record.name);
    }
}

async function writeCompleted(segmentSink, closer, record, transaction) {
    await closer.close(record.machine, record.start_time, record.kind || 'phase', transaction || null, record.name);
    await segmentSink.write([record], transaction);
}

/** Writes a consecutive run of phase records through one sink call. */
async function writeOwned(segmentSink, closer, records, transaction, preserveCoverage) {
    if (!records.length) {
        return;
    }
    const folded = collapsed(records, preserveCoverage);
    await closePending(closer, folded, transaction);
    await segmentSink.write(folded, transaction);
}

// eslint-disable-next-line max-params -- Existing sink ports and pool retain their public call convention.
export default function segmentDispatch(segmentSink, retag, splitSink, closer, pool, { preserveCoverage = false } = {}) {
    function normalize(record) { return preserveCoverage ? record : pointed(record); }
    return {
        async accept(record, transaction) {
            if (record.type === 'retag') {
                await retag.accept(record, transaction);
                return;
            }
            if (record.type === 'split') {
                await splitSink.write([record], transaction);
                return;
            }
            if (record.type === 'split-family') {
                await acceptFamily(pool, record, transaction);
                return;
            }
            if (record.type !== 'segment') {
                throw new Error(`Segment command type ${record.type} is not defined`);
            }
            if (record.duration !== 0) {
                await writeCompleted(segmentSink, closer, record, transaction);
                return;
            }
            await (transaction ? pendingInClient(segmentSink, closer, normalize(record), transaction)
                : persistPending(segmentSink, closer, pool, normalize(record)));
        },
        async acceptMany(records, transaction) {
            const phases = [];
            for (const record of records) {
                if (record.type === 'segment') {
                    phases.push(record);
                } else {
                    // eslint-disable-next-line no-await-in-loop
                    await writeOwned(segmentSink, closer, phases.splice(0), transaction, preserveCoverage);
                    // eslint-disable-next-line no-await-in-loop
                    await this.accept(record, transaction);
                }
            }
            await writeOwned(segmentSink, closer, phases, transaction, preserveCoverage);
        }
    };
}
