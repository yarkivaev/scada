import nativeMetricsInsert from './nativeMetricsInsert.js';
import nativeMetricsOwnership from './nativeMetricsOwnership.js';
import {createHash} from 'node:crypto';
import nativeMetricsClock from './nativeMetricsClock.js';
import centralPoint from '../../ingest/telemetry/centralPoint.js';
import {CENTRAL_RULE_FIELDS,centralRule} from '../../ingest/telemetry/centralPolicy.js';
const settings={async_insert:0,wait_for_async_insert:1};

function normalize(records) {
    return records.map((record,ordinal)=>{
        const policy=centralRule(Object.fromEntries(CENTRAL_RULE_FIELDS.map(key=>{return [key,record[key]];})));
        return {...centralPoint(record),...policy,ordinal};
    });
}
function topicStates(points,states,{seq,revision,publishedAt,admittedAt}) {
    const topics=new Map();
    for(const point of points) {
        const old=states.get(`topic:${point.topic}`);
        if(!topics.has(point.topic)){topics.set(point.topic,{key:`topic:${point.topic}`,latest:Number(old?.latest??-2208988800000),closed_before:Number(old?.closed_before??-2208988800000),published_at:Number(old?.published_at??publishedAt),committed_seq:seq.toString(),revision:revision.toString()});}
        const state=topics.get(point.topic);
        if(point.ts<=admittedAt+point.futureSkewMs&&point.ts>=state.closed_before&&point.ts>=admittedAt-point.maxHistoryAgeMs){state.latest=Math.max(state.latest,point.ts);}
    }
    for(const point of points) {
        const state=topics.get(point.topic);
        // Every point's frozen policy participates; never reopen an existing frontier.
        const cutoff=Math.floor(Math.max(state.latest-point.historyWindowMs,admittedAt-point.maxHistoryAgeMs)/(point.compactWindowMs||60000))*(point.compactWindowMs||60000);
        if(cutoff>state.closed_before){state.closed_before=cutoff;state.published_at=null;}
    }
    return topics;
}
function admissionRows(points,topics,admittedAt,batchId,seq) {
    const unique=new Map();const rejected=[];
    for(const point of points) {
        let reason=null;
        if(point.ts>admittedAt+point.futureSkewMs){reason='future';}
        else if(point.ts<topics.get(point.topic).closed_before||point.ts<admittedAt-point.maxHistoryAgeMs){reason='too_old';}
        if(reason){rejected.push({batch_id:batchId,ordinal:point.ordinal,topic:point.topic,ts:new Date(point.ts).toISOString().replace('T',' ').slice(0,-1),value:point.value,reason,admitted_at:new Date(admittedAt).toISOString().replace('T',' ').slice(0,-1)});}
        else{unique.set(JSON.stringify([point.topic,point.ts]),{topic:point.topic,ts:new Date(point.ts).toISOString().replace('T',' ').slice(0,-1),value:point.value,compact_ms:point.compactWindowMs,max_gap_ms:point.maxGapMs,revision:((seq*1024n)+BigInt(point.ordinal)).toString()});}
    }
    return {unique,rejected};
}


async function seedLegacyStates(client,states,points,admittedAt) {
    const topics=[...new Set(points.map(({topic})=>{return topic;}))].filter(topic=>{return !states.has(`topic:${topic}`);});
    if(!topics.length){return;}
    const skews=new Map(points.map(point=>{return [point.topic,point.futureSkewMs];}));
    const futureTimes=topics.map(topic=>{return Math.min(10413791999999,admittedAt+skews.get(topic));});
    const response=await client.query({query:'SELECT topic,max(toUnixTimestamp64Milli(ts)) AS latest FROM scada.metrics WHERE topic IN {topics:Array(String)} AND toUnixTimestamp64Milli(ts)<=arrayElement({futureTimes:Array(Int64)},indexOf({topics:Array(String)},topic)) GROUP BY topic',query_params:{futureTimes,topics},format:'JSONEachRow'});
    for(const row of await response.json()){states.set(`topic:${row.topic}`,{latest:Number(row.latest)});}
}
async function committedState(client,points,admittedAt) {
    const response=await client.query({query:'SELECT * FROM scada.metrics_state_v4 FINAL WHERE key IN {keys:Array(String)}',query_params:{keys:['',...new Set(points.map(({topic})=>{return `topic:${topic}`}))]},format:'JSONEachRow'});
    const states=new Map((await response.json()).map(row=>{return [row.key,row]}));
    await seedLegacyStates(client,states,points,admittedAt);
    const seq=BigInt(states.get('')?.committed_seq??0)+1n;
    if(seq>=(2n**64n)){throw new RangeError('Central admission sequence exhausted');}
    return {states,seq};
}
async function persist(client,unique,rejected,states,options) {
    nativeMetricsOwnership(options);
    if(unique.size){await nativeMetricsInsert(client,[...unique.values()]);}
    nativeMetricsOwnership(options);
    if(rejected.length){await client.insert({table:'scada.metrics_rejected_v4',values:rejected,format:'JSONEachRow',clickhouse_settings:settings});}
    const publishedAt=await nativeMetricsClock(client,options);
    nativeMetricsOwnership(options);
    for(const state of states){if(state.published_at===null||state.key===''){state.published_at=publishedAt;}}
    await client.insert({table:'scada.metrics_state_v4',values:states,format:'JSONEachRow',clickhouse_settings:settings});
}
function admissionContext(points,context,options) {
    const now=options.now??Date.now;
    const admittedAt=context.admittedAt??now();
    const batchId=context.batchId??createHash('sha256').update(JSON.stringify({points,admittedAt})).digest('hex');
    if(!Number.isSafeInteger(admittedAt)||!/^[a-f0-9]{64}$/u.test(batchId)){throw new TypeError('Invalid central admission context');}
    return {now,admittedAt,batchId};
}
/** Requires the serialized SAC head and one authoritative read-after-write target. */
async function nativeMetricsAdmission(client,records,context={},options={}) {
    nativeMetricsOwnership(context);
    if(records.length>1000){throw new TypeError('Central admission head exceeds 1000 points');}
    const points=normalize(records);
    const {now,admittedAt,batchId}=admissionContext(points,context,options);
    if(!points.length){return;}
    const {states,seq}=await committedState(client,points,admittedAt);
    nativeMetricsOwnership(context);
    const topics=topicStates(points,states,{seq,revision:(seq*1024n)+1023n,publishedAt:now(),admittedAt});
    const publishedAt=now();
    const {unique,rejected}=admissionRows(points,topics,admittedAt,batchId,seq);
    await persist(client,unique,rejected,[...topics.values(),{key:'',latest:0,closed_before:0,published_at:publishedAt,committed_seq:seq.toString(),revision:((seq*1024n)+1023n).toString()}],{...options,active:context.active});
}
export default nativeMetricsAdmission;
