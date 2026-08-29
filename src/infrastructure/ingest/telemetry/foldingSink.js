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
        async write(records) {
            await inner.write(records);
            for (const record of records) {
                const sample = locate(record);
                if (sample) {
                    // eslint-disable-next-line no-await-in-loop
                    await fold.accept(sample);
                }
            }
        }
    };
}
