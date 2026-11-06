import stompOptions from './stompOptions.js';
import deadline from '../../streams/deadline.js';
import { postgresSink, stompSource } from '../../streams/index.js';
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
 * Pending heartbeats are coalesced per machine. Source acceptance is FIFO:
 * queued lane work must not consume another delivery's execution deadline.
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
    // eslint-disable-next-line prefer-const -- The timer codec closes over the source constructed with that codec.
    let source;
    const codec = segmentCodec(dispatch);
    const bounded = { accept(envelope) {
        return deadline(Promise.resolve().then(() => { return codec.accept(envelope); }),
            config.acceptTimeoutMs ?? 10000, 'STOMP acceptance', (error) => { source.fail(error); });
    } };
    // Heartbeat timer flushes outlive source.accept and need their own execution deadline.
    const coalesce = segmentCoalesce(bounded, {
        size: config.size,
        deadLetter: config.deadLetter,
        interval: config.interval
    });
    const destination = config.segmentsDestination || segmentsIngestDestination;
    source = stompSource(stomp, destination, coalesce, stompOptions(config, { serial: true, manualAck: true }));
    const silence = silentOpenWatch(closeSilentOpen(pool), budget, {
        intervalMs: (config.poll || 5) * 1000
    });
    return {
        health() { return source.health(); },
        destination,
        async start() {
            const repair = abutSegments(pool, budget);
            void repair.catch((error) => {
                processingErrorLog('abut_segments', error, { budgetSeconds: budget });
            });
            await source.start();
            await silence.start();
        },
        async stop() {
            await silence.stop();
            await source.stop();
            await pool.end();
        }
    };
}
