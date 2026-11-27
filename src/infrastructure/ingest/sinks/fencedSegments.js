import { decodeSegmentBody } from '../codecs/segmentCodec.js';
import writeFencedSegment, {
    activeSegmentLease, checkSegmentRevision, segmentLeaseMatches, segmentRevision, serialSegmentTransaction, storeWriteReceipt, writeReceipt
} from '../../persistence/pg/segmentWriteFence.js';

const computedProperties = new Set(['phase_revision', 'casting', 'cadence_rule', 'cadence_threshold_ms',
    'casting_detected_at', 'casting_silence_at', 'source_interrupted']);

function properties(value) {
    const decoded = JSON.parse(value ?? 'null');
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : {};
}

function keepOperatorFields(row, prior) {
    if (!prior) { return row; }
    const tagged = prior.tags && !['[]','null'].includes(prior.tags.trim());
    const preserved = tagged ? {...row,options:prior.options,resolved:prior.resolved} : row;
    if (!prior.properties) { return preserved; }
    try {
        const stored = properties(prior.properties);
        const incoming = properties(row.properties);
        const annotations = Object.fromEntries(Object.entries(stored).filter(([key]) => {
            return !computedProperties.has(key);
        }));
        return {...preserved,properties:JSON.stringify({...incoming,...annotations})};
    } catch {
        // Older rows may carry a non-JSON operator value.
        return {...preserved,properties:prior.properties};
    }
}

async function preparePhases(client, rows) {
    const {rows:previous} = await client.query(
        "SELECT start_time,properties,tags,options,resolved FROM segments WHERE machine=$1 AND kind='phase' AND start_time=ANY($2::timestamptz[])",
        [rows[0].machine,rows.map(row => { return row.start_time; })]);
    const byStart = new Map(previous.map(row => { return [new Date(row.start_time).toISOString(),row]; }));
    return rows.map(row => { return keepOperatorFields(row,byStart.get(row.start_time)); });
}

async function applyLive(dispatch, record, client, phaseAnchors) {
    const transition = record.type === 'phase-transition';
    if (!transition && (record.type !== 'segment' || record.kind !== 'phase')) {
        return dispatch.accept(record,client);
    }
    const rows = await preparePhases(client,transition ? record.pieces : [record]);
    if (!transition) { return dispatch.accept(rows[0],client); }
    if (phaseAnchors?.has(record.machine)) { return dispatch.accept({...record,pieces:rows},client); }
    // The ordinary recipient has no transition envelope. Its ordered writes still share this transaction.
    return rows.reduce((previous,row) => {
        return previous.then(() => { return dispatch.accept(row,client); });
    },Promise.resolve());
}

async function applyReplica(dispatch,record,client,{acceptReplicaSegments,phaseAnchors}) {
    const receipt = await writeReceipt(client,record.machine,record.committedOutputId,record.body);
    if (receipt) { return receipt; }
    // Authority can acknowledge a relay of its own receipt without accepting new replica writes.
    if (!acceptReplicaSegments) { return {applied:false}; }
    const {rows:[storage]} = await client.query("SELECT to_regclass('segment_timeline_revisions') AS local_revision");
    const eligible = storage.local_revision
        ? await segmentLeaseMatches(client,record.machine,undefined)
        : !await activeSegmentLease(client,record.machine);
    if (!eligible) { return {applied:false}; }
    await applyLive(dispatch,record,client,phaseAnchors);
    const revision = storage.local_revision ? await segmentRevision(client,record.machine) : {};
    const outcome = {applied:true,...revision};
    await storeWriteReceipt(client,record.machine,record.committedOutputId,record.body,outcome);
    return outcome;
}

function persist(dispatch, record, client, settings) {
    if (record.fence) {
        return writeFencedSegment(client,record.machine,record.fence,record.body,async () => {
            await checkSegmentRevision(client,record.machine,record.fence.revision);
            await applyLive(dispatch,record,client,settings.phaseAnchors);
            return {applied:true,...await segmentRevision(client,record.machine)};
        });
    }
    return applyReplica(dispatch,record,client,settings);
}

function protectedRecord(record) {
    return record.fence || record.committedOutputId;
}

/** Uses the same configured dispatch for broker deliveries and synchronous HTTP writes. */
export default function fencedSegments(pool, dispatch, settings) {
    function accept(record, client) {
        if (!protectedRecord(record)) { return dispatch.accept(record,client); }
        if (!client) {
            return serialSegmentTransaction(pool,record.machine,runner => {
                return persist(dispatch,record,runner,settings);
            },settings.acceptTimeoutMs);
        }
        return client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[ `history:${record.machine}` ])
            .then(() => {return persist(dispatch,record,client,settings)});
    }
    return {
        dispatch: {
            accept,
            acceptMany(records,client) {
                if (!records.some(protectedRecord)) { return dispatch.acceptMany(records,client); }
                return records.reduce((previous,record) => {return previous.then(() => {return accept(record,client)})},Promise.resolve());
            }
        },
        live: {
            revision(machine) { return segmentRevision(pool,machine); },
            async apply(input) {
                let record;
                try { record = decodeSegmentBody(input); }
                catch (error) { throw new TypeError(error.message); }
                if (!record.fence) { throw new TypeError('A segment write fence is required'); }
                return await accept(record);
            }
        }
    };
}
