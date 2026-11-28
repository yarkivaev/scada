import fencedSegments from '../sinks/fencedSegments.js';
import contiguousPhases, { validatePhaseAnchors } from '../sinks/contiguousPhases.js';
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
import repairPhaseOverlaps from '../sinks/repairPhaseOverlaps.js';
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
const coveringSegmentUpdateWhere = '(segments.duration = 0 OR EXCLUDED.duration > 0 OR EXCLUDED.end_time > segments.end_time) AND NOT (EXCLUDED.duration = 0 AND EXCLUDED.end_time < segments.end_time) AND NOT (segments.duration > 0 AND EXCLUDED.duration = 0 AND COALESCE(segments.properties, \'\') LIKE \'%"split_of"%\' AND EXISTS (SELECT 1 FROM segments AS kin WHERE kin.machine = segments.machine AND kin.kind = segments.kind AND kin.start_time > segments.start_time AND COALESCE(kin.properties, \'\') LIKE \'%"split_of"%\')) AND NOT EXISTS (SELECT 1 FROM segments AS later WHERE later.machine = segments.machine AND later.kind = segments.kind AND later.start_time > segments.start_time)';
export const segmentsIngestDestination = '/queue/scada.segments.ingest';

export { default as segmentDispatch } from '../../../domain/segment/dispatch.js';

/**
 * Builds segment and split postgres sinks that share one pool.
 *
 * @param {string} postgres - PostgreSQL URL
 * @param {object} pool - shared pg pool
 * @returns {{ segmentSink: object, splitSink: object }}
 */
function segmentSinks(postgres, pool, policy) {
    const updateWhere = policy.preserveCoverage ? coveringSegmentUpdateWhere : segmentUpdateWhere;
    const shared = { pool, conflict: segmentConflict, updateWhere };
    const update = policy.preserveCoverage ? [...segmentUpdateColumns, 'properties'] : segmentUpdateColumns;
    return {
        segmentSink: foldingSegments(postgresSink(postgres, 'segments', segmentColumns,
            { ...shared, update }), pool, policy),
        splitSink: foldingSegments(postgresSink(postgres, 'segments', segmentColumns,
            { ...shared, update: splitUpdateColumns }), pool, policy)
    };
}

function pipelineSettings(config) {
    const settings = config.transactions?.enabled ? { ...config, transactions: segmentBatchPolicy(config.transactions) } : config;
    if (settings.repairHistoryOnStart !== undefined && typeof settings.repairHistoryOnStart !== 'boolean') {
        throw new TypeError('repairHistoryOnStart must be boolean');
    }
    const { phaseRepairMachines } = settings;
    if (phaseRepairMachines !== undefined && (!Array.isArray(phaseRepairMachines)
        || phaseRepairMachines.some((machine) => { return typeof machine !== 'string' || !machine.trim(); }))) {
        throw new TypeError('phaseRepairMachines must be an array of machine ids');
    }
    return settings;
}

async function repairHistory(pool, budget, protectedTracks) {
    try {
        await abutSegments(pool, budget, protectedTracks);
    } catch (error) {
        processingErrorLog('abut_segments', error, { budgetSeconds: budget });
    }
}

function repairConfiguredPhases(pool, settings, protectedTracks) {
    repairPhaseOverlaps(pool, settings.phaseRepairMachines, protectedTracks, settings).catch((error) => {
        processingErrorLog('repair_phase_overlaps', error, {});
    });
}

function phasePolicy({ preserveCoverage, authoritativeProperty }) {
    if (authoritativeProperty !== undefined && (typeof authoritativeProperty?.key !== 'string'
        || !authoritativeProperty.key || typeof authoritativeProperty.value !== 'string')) {
        throw new TypeError('authoritativeProperty must specify a property key and string value');
    }
    return {
        preserveCoverage,
        isAuthoritative(row) {
            if (!authoritativeProperty) { return false; }
            const properties = typeof row.properties === 'string' ? JSON.parse(row.properties) : row.properties;
            return properties?.[authoritativeProperty.key] === authoritativeProperty.value;
        }
    };
}

export function segmentRecipient(postgres, pool, config) {
    const policy = phasePolicy(config);
    const { segmentSink, splitSink } = segmentSinks(postgres, pool, policy);
    const continued = continuedSegments(segmentSink, pool, silenceBudget(config.segmentWindow || 15), policy);
    const dispatch = contiguousPhases(pool, config.phaseAnchors,
        segmentDispatch(continued, retagSink(pool), splitSink, closeOrphanOpen(pool), pool, policy));
    return fencedSegments(pool, dispatch, config);
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
export default function segmentPipeline(stomp, postgres, pool, config, recipient) {
    const settings = pipelineSettings(config);
    const budget = silenceBudget(settings.segmentWindow || 15);
    const {dispatch} = recipient ?? segmentRecipient(postgres,pool,settings);
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
    const silence = silentOpenWatch(closeSilentOpen(pool, [...(settings.phaseAnchors?.keys() ?? [])]), budget, {
        intervalMs: (settings.poll || 5) * 1000
    });
    return {
        health() { return source.health(); },
        destination,
        async start() {
            const protectedTracks = [...(settings.phaseAnchors?.keys() ?? [])];
            await validatePhaseAnchors(pool, settings.phaseAnchors);
            if (settings.repairHistoryOnStart !== false) {
                await repairHistory(pool, budget, protectedTracks);
            }
            await source.start();
            await silence.start();
            if (settings.repairHistoryOnStart !== false) {
                repairConfiguredPhases(pool, settings, protectedTracks);
            }
        },
        stop() {
            return stopSegmentPipeline(source, coalesce, silence, pool, settings.stopTimeoutMs ?? 5000);
        }
    };
}
