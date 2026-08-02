import {
    postgresSink,
    stompSource
} from '@yarkivaev/source-to-sink';
import segmentDispatch from '../../../domain/segment/dispatch.js';
import silenceBudget from '../../../domain/segment/silenceBudget.js';
import segmentCodec from '../codecs/segmentCodec.js';
import silentOpenWatch from '../silentOpenWatch.js';
import closeOrphanOpen from '../sinks/closeOrphanOpen.js';
import closeSilentOpen from '../sinks/closeSilentOpen.js';
import retagSink from '../sinks/retagSink.js';

export const segmentColumns = ['machine', 'name', 'start_time', 'end_time', 'duration',
                               'options', 'tags', 'properties', 'resolved'];
export const segmentConflict = ['machine', 'start_time'];
export const segmentUpdateColumns = ['name', 'end_time', 'duration', 'options', 'resolved'];
export const splitUpdateColumns = ['name', 'end_time', 'duration', 'tags', 'options', 'resolved'];
export const segmentsIngestDestination = '/queue/scada.segments.ingest';

export { default as segmentDispatch } from '../../../domain/segment/dispatch.js';

/**
 * Pipeline for streaming STOMP segment data to PostgreSQL segments table.
 * Subscribes to the durable ingest queue so shovel traffic survives consumer gaps.
 *
 * @param {string} stomp - STOMP broker URL
 * @param {string} postgres - PostgreSQL connection URL
 * @param {object} pool - pg pool
 * @param {object} config - Pipeline configuration
 * @returns {object} Pipeline with start() and stop() methods
 */
export default function segmentPipeline(stomp, postgres, pool, config) {
    const segmentSink = postgresSink(postgres, 'segments', segmentColumns,
        { conflict: segmentConflict, update: segmentUpdateColumns });
    const splitSink = postgresSink(postgres, 'segments', segmentColumns,
        { conflict: segmentConflict, update: splitUpdateColumns });
    const retag = retagSink(pool);
    const closer = closeOrphanOpen(pool);
    const dispatch = segmentDispatch(segmentSink, retag, splitSink, closer);
    const codec = segmentCodec(dispatch);
    const destination = config.segmentsDestination || segmentsIngestDestination;
    const source = stompSource(stomp, destination, codec,
        { login: config.login, passcode: config.passcode, host: config.host });
    const window = config.segmentWindow || 15;
    const budget = silenceBudget(window);
    const pollMs = (config.poll || 5) * 1000;
    const silence = silentOpenWatch(closeSilentOpen(pool), budget, { intervalMs: pollMs });
    return {
        destination,
        start() {
            source.start();
            void silence.start();
        },
        stop() {
            silence.stop();
            source.stop();
            pool.end();
        }
    };
}
