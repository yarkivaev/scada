/**
 * HistoryRun and SupervisorSinkCheckpoint view of undelivered collector samples.
 *
 * {{{
 * spoolHistory({ peek() { return []; } }).work('icht2')
 * }}}
 */

import { nativeTailProtocol } from '../../infrastructure/persistence/pg/historyNativeBounds.js';
import { randomUUID } from 'node:crypto';

function machineOf(key) {
    const match = /icht-?(?<n>\d)/iu.exec(String(key).replaceAll('/', '.'));
    return match ? `icht${match.groups.n}` : null;
}
function channelOf(key) {
    const parts = String(key).replaceAll('/', '.').split('.');
    return parts.at(-2) ?? key;
}
function sample(record) {
    const key = record.routingKey ?? record.topic;
    const raw = record.body ? JSON.parse(Buffer.isBuffer(record.body) ? record.body.toString() : record.body) : record;
    const time = Number(raw.ts ?? raw.time ?? raw.timestamp);
    const value = Number(raw.value);
    if (!key || !Number.isFinite(time) || !Number.isFinite(value)) { return []; }
    return [{ eventId: record.eventId ?? `${key}:${time}`, channel: channelOf(key), topic: key.replaceAll('.', '/'),
        time, timestamp: time / 1000, value, machine: machineOf(key) }];
}
function unpack(event) {
    const payload = event.observation ?? event;
    if (Array.isArray(payload.records)) { return payload.records.flatMap(sample); }
    return sample({ ...payload, eventId: payload.eventId ?? event.eventId });
}

/** Collector spool as a checkpoint and history receiver. */
export default function spoolHistory(queue) {
    async function rows() {
        if (!queue?.peek) { return []; }
        const listed = await queue.peek(1000);
        return listed.flatMap((item) => { return unpack(item.event ?? item); });
    }
    async function owned(machine) {
        return (await rows()).filter((row) => { return row.machine === machine; });
    }
    return {
        async replayCursor(machine) {
            const times = (await owned(machine)).map((row) => { return row.timestamp; });
            return times.length ? Math.min(...times) : 0;
        },
        pendingSegments() { return Promise.resolve([]); },
        segment() { return Promise.resolve(null); },
        cyclePrior() { return Promise.resolve([]); },
        async readings(topics, from) {
            const wanted = new Set(topics);
            return (await rows()).filter((row) => { return row.timestamp >= from && (!wanted.size || wanted.has(row.topic)); })
                .map((row) => { return { topic: row.topic, timestamp: row.timestamp, value: row.value }; });
        },
        configure() { return Promise.resolve({ nativeTailProtocol }); },
        purge() { return Promise.resolve({}); },
        accept() { return Promise.resolve({ inserted: 0 }); },
        async work(machine) {
            const items = await owned(machine);
            if (!items.length) { return { items: [] }; }
            const times = items.map((row) => { return row.time; });
            return { items: [{ id: randomUUID(), token: randomUUID(), from: Math.min(...times), until: Math.max(...times) }] };
        },
        async context(machine, from, until) {
            const items = (await owned(machine)).filter((row) => { return row.time >= from && row.time <= until; })
                .map((row) => { return { eventId: row.eventId, channel: row.channel, time: row.time, value: row.value }; });
            return { available: true, revision: 'spool', nativeTailMode: nativeTailProtocol,
                context: { from, until }, items, segments: [], annotations: [],
                continuity: items.length ? [{ from: items[0].time, until: items.at(-1).time }] : [] };
        },
        commit() { return Promise.resolve({}); }
    };
}
