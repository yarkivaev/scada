/**
 * Writes metrics then folds matching records into state intervals.
 *
 * @param {object} inner - sink with write(records)
 * @param {object} fold - intervalFold collector
 * @param {function} locate - record to sample or null
 * @returns {object} sink with write
 *
 * @example
 *   const sink = foldingSink(clickhouse, fold, locate);
 *   await sink.write([{ topic, ts, value }]);
 */
export default function foldingSink(inner, fold, locate) {
    return {
        requireTimestamp: inner.requireTimestamp,
        start() { return inner.start?.(); },
        status() { return inner.status?.(); },
        stop() { return inner.stop?.(); },
        async write(records, context = {}) {
            context.signal?.throwIfAborted();
            await inner.write(records, context);
            for (const record of records) {
                context.signal?.throwIfAborted();
                const sample = locate(record);
                if (sample) {
                    // eslint-disable-next-line no-await-in-loop
                    await fold.accept(sample);
                }
            }
        }
    };
}
