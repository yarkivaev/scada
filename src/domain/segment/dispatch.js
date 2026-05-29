/**
 * Routes normalized segment records to the correct persistence sink.
 *
 * @param {object} segmentSink - batch insert/update sink
 * @param {object} retag - retag sink
 * @param {object} splitSink - split update sink
 * @returns {object} collector with accept(record)
 *
 * @example
 *   const route = segmentDispatch(segmentSink, retag, splitSink);
 *   await route.accept({ type: 'retag', machine: 'icht1', start_time: '...' });
 */
export default function segmentDispatch(segmentSink, retag, splitSink) {
    return {
        async accept(record) {
            if (record.type === 'retag') {
                await retag.accept(record);
            } else if (record.type === 'split') {
                await splitSink.write([record]);
            } else {
                await segmentSink.write([record]);
            }
        }
    };
}
