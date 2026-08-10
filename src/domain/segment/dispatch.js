/**
 * Routes normalized segment records to the correct persistence sink.
 *
 * @param {object} segmentSink - batch insert/update sink
 * @param {object} retag - retag sink
 * @param {object} splitSink - split update sink
 * @param {object} closer - orphan open segment closer
 * @returns {object} collector with accept(record)
 *
 * @example
 *   const route = segmentDispatch(segmentSink, retag, splitSink, closer);
 *   await route.accept({ type: 'segment', machine: 'm1', start_time: '...', duration: 0 });
 */
export default function segmentDispatch(segmentSink, retag, splitSink, closer) {
    return {
        async accept(record) {
            if (record.type === 'retag') {
                await retag.accept(record);
            } else if (record.type === 'split') {
                await splitSink.write([record]);
            } else if (record.type === 'segment') {
                if (record.duration === 0) {
                    await closer.close(record.machine, record.start_time);
                }
                await segmentSink.write([record]);
            } else {
                throw new Error(`Segment command type ${record.type} is not defined`);
            }
        }
    };
}
