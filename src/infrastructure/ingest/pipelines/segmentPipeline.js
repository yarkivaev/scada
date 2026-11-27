import stompOptions from './stompOptions.js';
import segmentTransactions from './segmentTransactions.js';
import segmentBatchPolicy from './segmentBatchPolicy.js';
import stopSegmentPipeline from './stopSegmentPipeline.js';
import deadline from '../../streams/deadline.js';
import { postgresSink, stompSource } from '../../streams/index.js';
import segmentDispatch from '../../../domain/segment/dispatch.js';
import segmentCoalesce from '../../../domain/segment/segmentCoalesce.js';
import silenceBudget from '../../../domain/segment/silenceBudget.js';
import segmentCodec from '../codecs/segmentCodec.js';
import processingErrorLog from '../processingErrorLog.js';
import silentOpenWatch from '../silentOpenWatch.js';
import abutSegments from '../sinks/abutSegments.js';
import foldCastingPhases from '../sinks/foldCastingPhases.js';
import closeOrphanOpen from '../sinks/closeOrphanOpen.js';
import closeSilentOpen from '../sinks/closeSilentOpen.js';
import continuedSegments from '../sinks/continuedSegments.js';
import foldingSegments from '../sinks/foldingSegments.js';
import retagSink from '../sinks/retagSink.js';

export const segmentColumns = ['machine', 'kind', 'name', 'start_time', 'end_time', 'duration',
                               'options', 'tags', 'properties', 'resolved', 'updated_at'];
export const segmentConflict = ['machine', 'kind', 'start_time'];
export const segmentUpdateColumns = ['name', 'end_time', 'duration', 'options', 'resolved', 'updated_at'];
export const splitUpdateColumns = ['name', 'end_time', 'duration', 'tags', 'options', 'properties', 'resolved'];
export const segmentUpdateWhere = '(segments.duration = 0 OR EXCLUDED.duration > 0 OR EXCLUDED.end_time > segments.end_time) AND NOT (segments.duration > 0 AND EXCLUDED.duration = 0 AND COALESCE(segments.properties, \'\') LIKE \'%"split_of"%\' AND EXISTS (SELECT 1 FROM segments AS kin WHERE kin.machine = segments.machine AND kin.kind = segments.kind AND kin.start_time > segments.start_time AND COALESCE(kin.properties, \'\') LIKE \'%"split_of"%\')) AND (NOT EXISTS (SELECT 1 FROM segments AS later WHERE later.machine = segments.machine AND later.kind = segments.kind AND later.start_time > segments.start_time) OR (segments.duration > 0 AND EXCLUDED.duration = segments.duration AND EXCLUDED.name = segments.name AND EXCLUDED.end_time = segments.end_time))';
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
        segmentSink: foldingSegments(postgresSink(postgres, 'segments', segmentColumns,
            { ...shared, update: segmentUpdateColumns }), pool),
        splitSink: foldingSegments(postgresSink(postgres, 'segments', segmentColumns,
            { ...shared, update: splitUpdateColumns }), pool)
    };
}

function pipelineSettings(config) {
    const settings = config.transactions?.enabled ? { ...config, transactions: segmentBatchPolicy(config.transactions) } : config;
    if (settings.repairHistoryOnStart !== undefined && typeof settings.repairHistoryOnStart !== 'boolean') {
        throw new TypeError('repairHistoryOnStart must be boolean');
    }
    return settings;
}

async function repairHistory(pool, budget) {
    try {
        await abutSegments(pool, budget);
    } catch (error) {
        processingErrorLog('abut_segments', error, { budgetSeconds: budget });
    }
}

function repairCasting(pool) {
    foldCastingPhases(pool).catch((error) => {
        processingErrorLog('fold_casting_phases', error, {});
    });
}

/**
 * Pipeline for streaming STOMP segment data to PostgreSQL segments table.
 * Subscribes to the durable ingest queue so shovel traffic survives consumer gaps.
 * Pending heartbeats are coalesced per machine. Machine lanes run in parallel;
 * only storage execution consumes its watchdog, not bounded lane queue wait.
 *
 * @param {string} stomp - STOMP broker URL
 * @param {string} postgres - PostgreSQL connection URL
 * @param {object} pool - pg pool
 * @param {object} config - Pipeline configuration
 * @returns {object} Pipeline with start() and stop() methods
 */
export default function segmentPipeline(stomp, postgres, pool, config) {
    const settings = pipelineSettings(config);
    const budget = silenceBudget(settings.segmentWindow || 15);
    const { segmentSink, splitSink } = segmentSinks(postgres, pool);
    const continued = continuedSegments(segmentSink, pool, budget);
    const dispatch = segmentDispatch(continued, retagSink(pool), splitSink, closeOrphanOpen(pool), pool);
    // eslint-disable-next-line prefer-const -- The timer codec closes over the source constructed with that codec.
    let source;
    const codec = segmentCodec(dispatch);
    const bounded = { accept(envelope) {
        return deadline(Promise.resolve().then(() => { return codec.accept(envelope); }),
            settings.acceptTimeoutMs ?? 10000, 'STOMP acceptance', (error) => { source.fail(error); });
    } };
    // Heartbeat timer flushes outlive source.accept and need their own execution deadline.
    const coalesce = settings.transactions?.enabled ? segmentTransactions(dispatch, pool, settings, error => { source.fail(error); }) : segmentCoalesce(bounded, {
        size: settings.size,
        deadLetter: settings.deadLetter,
        interval: settings.interval
    });
    const destination = settings.segmentsDestination || segmentsIngestDestination;
    // Each admitted frame can flush one heartbeat and then persist itself; prefetch bounds queue depth.
    const executionMs = settings.transactions?.enabled ? settings.transactions.timeoutMs : settings.acceptTimeoutMs ?? 10000;
    const deliveryTimeoutMs = Math.min(2147483647, executionMs * (settings.prefetch ?? 32) * 2 + (settings.transactions?.maxWaitMs ?? 0));
    source = stompSource(stomp, destination, coalesce,
        stompOptions(settings, { serial: false, manualAck: true, deliveryTimeoutMs, onFatal(error) {
            coalesce.abort?.(error);settings.onFatal?.(error);
        } }));
    const silence = silentOpenWatch(closeSilentOpen(pool), budget, {
        intervalMs: (settings.poll || 5) * 1000
    });
    return {
        health() { return source.health(); },
        destination,
        async start() {
            if (settings.repairHistoryOnStart !== false) {
                await repairHistory(pool, budget);
            }
            await source.start();
            await silence.start();
            if (settings.repairHistoryOnStart !== false) {
                repairCasting(pool);
            }
        },
        stop() {
            return stopSegmentPipeline(source, coalesce, silence, pool, settings.stopTimeoutMs ?? 5000);
        }
    };
}
