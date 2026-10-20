import {
    postgresSink,
    stompSource
} from '@yarkivaev/source-to-sink';
import segmentDispatch from '../../../domain/segment/dispatch.js';
import segmentCoalesce from '../../../domain/segment/segmentCoalesce.js';
import silenceBudget from '../../../domain/segment/silenceBudget.js';
import segmentCodec from '../codecs/segmentCodec.js';
import processingErrorLog from '../processingErrorLog.js';
import silentOpenWatch from '../silentOpenWatch.js';
import abutSegments from '../sinks/abutSegments.js';
import closeOrphanOpen from '../sinks/closeOrphanOpen.js';
import closeSilentOpen from '../sinks/closeSilentOpen.js';
import continuedSegments from '../sinks/continuedSegments.js';
import retagSink from '../sinks/retagSink.js';

export const segmentColumns = ['machine', 'kind', 'name', 'start_time', 'end_time', 'duration',
                               'options', 'tags', 'properties', 'resolved', 'updated_at'];
export const segmentConflict = ['machine', 'kind', 'start_time'];
export const segmentUpdateColumns = ['name', 'end_time', 'duration', 'options', 'resolved', 'updated_at'];
export const splitUpdateColumns = ['name', 'end_time', 'duration', 'tags', 'options', 'properties', 'resolved'];
export const segmentUpdateWhere = '(segments.duration = 0 OR EXCLUDED.duration > 0 OR EXCLUDED.end_time > segments.end_time) AND NOT (segments.duration > 0 AND EXCLUDED.duration = 0 AND COALESCE(segments.properties, \'\') LIKE \'%"split_of"%\')';
export const segmentsIngestDestination = '/queue/scada.segments.ingest';

export { default as segmentDispatch } from '../../../domain/segment/dispatch.js';

/**
 * Builds segment and split postgres sinks that share one pool.
 *
 * @param {string} postgres - PostgreSQL URL
 * @param {object} pool - shared pg pool
 * @returns {{ segmentSink: object, splitSink: object }}
 */
function segmentSinks(postgres, pool) {
    const shared = { pool, conflict: segmentConflict, updateWhere: segmentUpdateWhere };
    return {
        segmentSink: postgresSink(postgres, 'segments', segmentColumns,
            { ...shared, update: segmentUpdateColumns }),
        splitSink: postgresSink(postgres, 'segments', segmentColumns,
            { ...shared, update: splitUpdateColumns })
    };
}

/**
 * Pipeline for streaming STOMP segment data to PostgreSQL segments table.
 * Subscribes to the durable ingest queue so shovel traffic survives consumer gaps.
 * Pending heartbeats are coalesced per machine; machines persist in
 * parallel lanes. Arrivals enqueue in broker FIFO before coalesce.
 *
 * @param {string} stomp - STOMP broker URL
 * @param {string} postgres - PostgreSQL connection URL
 * @param {object} pool - pg pool
 * @param {object} config - Pipeline configuration
 * @returns {object} Pipeline with start() and stop() methods
 */
export default function segmentPipeline(stomp, postgres, pool, config) {
    const budget = silenceBudget(config.segmentWindow || 15);
    const { segmentSink, splitSink } = segmentSinks(postgres, pool);
    const continued = continuedSegments(segmentSink, pool, budget);
    const dispatch = segmentDispatch(continued, retagSink(pool), splitSink, closeOrphanOpen(pool), pool);
    const coalesce = segmentCoalesce(segmentCodec(dispatch), {
        size: config.size,
        interval: config.interval
    });
    const destination = config.segmentsDestination || segmentsIngestDestination;
    const source = stompSource(stomp, destination, coalesce, {
        login: config.login,
        passcode: config.passcode,
        host: config.host,
        serial: false,
        manualAck: true
    });
    const silence = silentOpenWatch(closeSilentOpen(pool), budget, {
        intervalMs: (config.poll || 5) * 1000
    });
    return {
        destination,
        async start() {
            const repair = abutSegments(pool, budget);
            void repair.catch((error) => {
                processingErrorLog('abut_segments', error, { budgetSeconds: budget });
            });
            source.start();
            await silence.start();
        },
        stop() {
            silence.stop();
            source.stop();
            pool.end();
        }
    };
}
