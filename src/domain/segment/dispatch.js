/**
 * Persists a pending heartbeat, optionally inside one pool transaction.
 *
 * @param {object} segmentSink - upsert sink
 * @param {object} closer - orphan closer
 * @param {object} [pool] - optional pg pool
 * @param {object} record - normalized segment record
 * @returns {Promise<void>}
 */
async function persistPending(segmentSink, closer, pool, record) {
    const kind = record.kind || 'phase';
    if (!pool || typeof pool.connect !== 'function') {
        await closer.close(record.machine, record.start_time, kind);
        await segmentSink.write([record]);
        return;
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await closer.close(record.machine, record.start_time, kind, client);
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
export default function segmentDispatch(segmentSink, retag, splitSink, closer, pool) {
    return {
        async accept(record) {
            if (record.type === 'retag') {
                await retag.accept(record);
                return;
            }
            if (record.type === 'split') {
                await splitSink.write([record]);
                return;
            }
            if (record.type !== 'segment') {
                throw new Error(`Segment command type ${record.type} is not defined`);
            }
            if (record.duration !== 0) {
                await segmentSink.write([record]);
                return;
            }
            await persistPending(segmentSink, closer, pool, record);
        }
    };
}
