/* eslint max-lines-per-function: ["error", 120], max-statements: ["error", 24] */
import { digest, revive, validate } from './spoolCodec.js';

const replayPageBytes = 4 * 1024 * 1024;
const remainingKeyBytes = Buffer.byteLength(',"remaining":');

function recordOf(event, recipients) {
    const json = JSON.stringify(event) ?? 'null';
    const snapshot = JSON.parse(json);
    validate(snapshot, recipients);
    const descriptorHashes = Array.isArray(snapshot.destinations)
        ? snapshot.destinations.map(item => { return digest(JSON.stringify(item)); }) : [];
    const destinations = new Map(recipients.map((id, index) => {
        return [id, descriptorHashes[index] ?? `legacy:${id}`];
    }));
    const recipientJson = JSON.stringify(recipients);
    const identity = `{"event":${json},"recipients":${recipientJson}}`;
    return { id: snapshot.eventId, json, fingerprint: digest(identity), destinations, pending: new Map(),
        bytes: Buffer.byteLength(identity) + remainingKeyBytes + Buffer.byteLength(recipientJson) };
}

function limitOf(limit, operation) {
    if (!Number.isSafeInteger(limit) || limit <= 0) { throw new TypeError(`Positive ${operation} limit required`); }
}

function pagesOf(targets, limit, blocked) {
    const pages = [];
    for (const [target, pairs] of targets) {
        if (!blocked.has(target)) { pages.push({ target, pairs, cursor: pairs.values() }); }
        if (pages.length >= Math.min(limit, 64)) { break; }
    }
    return pages;
}

function select(pages, limit) {
    const selected = new Map();
    let bytes = 0;
    function add(pair) {
        const { record } = pair;
        if (!selected.has(record)) {
            // Always admit the first row so a large record can make progress alone.
            if (selected.size >= limit || (selected.size && bytes + record.bytes > replayPageBytes)) { return; }
            selected.set(record, []);
            bytes += record.bytes;
        }
        selected.get(record).push(pair);
    }
    for (let offset = 0; offset < limit; offset += 1) {
        let advanced = false;
        for (const page of pages) {
            const { value: pair } = page.cursor.next();
            if (pair) { advanced = true; add(pair); }
        }
        if (!advanced) { break; }
    }
    return selected;
}

function decoded(record, remaining) {
    return { event: JSON.parse(record.json, revive), remaining };
}

function visibleRecords(records, limit) {
    limitOf(limit, 'peek');
    const output = [];
    let bytes = 0;
    for (const record of records.values()) {
        if (output.length && bytes + record.bytes > replayPageBytes) { break; }
        bytes += record.bytes;
        output.push(decoded(record, [...record.pending.keys()]));
        if (output.length === limit) { break; }
    }
    return output;
}

/** The FIFO is independent of per-target replay order. Accepted observations live only in this process. */
export default function memoryDeliveryStore({ maxBytes, maxRecords = 100000 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) { throw new TypeError('Explicit positive spool maxBytes required'); }
    if (!Number.isSafeInteger(maxRecords) || maxRecords <= 0) { throw new TypeError('Positive safe spool maxRecords required'); }
    const records = new Map();
    const targets = new Map();
    const state = { ready: false, bytes: 0, sequence: 0n, droppedRecords: 0, droppedBytes: 0 };
    function forget(pair) {
        const { recipient, record, target } = pair;
        record.pending.delete(recipient);
        const group = targets.get(target);
        group.delete(pair);
        if (!group.size) { targets.delete(target); }
    }
    function remove(record) {
        for (const pair of record.pending.values()) { forget(pair); }
        records.delete(record.id);
        state.bytes -= record.bytes;
    }
    function evict() {
        const oldest = records.values().next().value;
        state.droppedRecords += 1;
        state.droppedBytes += oldest.bytes;
        remove(oldest);
    }
    function append(event, recipients) {
        const incoming = recordOf(event, recipients);
        const existing = records.get(incoming.id);
        if (existing) {
            if (existing.fingerprint !== incoming.fingerprint) { throw new Error('Conflicting event identity'); }
            return;
        }
        if (incoming.bytes > maxBytes) { throw new Error('Spool capacity exceeded'); }
        while (records.size >= maxRecords || incoming.bytes > maxBytes - state.bytes) { evict(); }
        state.sequence += 1n;
        Object.assign(incoming, { admission: state.sequence.toString() });
        for (const [recipient, target] of incoming.destinations) {
            const group = targets.get(target) ?? new Set();
            const pair = { recipient, target, record: incoming };
            group.add(pair);
            targets.set(target, group);
            incoming.pending.set(recipient, pair);
        }
        records.set(incoming.id, incoming);
        state.bytes += incoming.bytes;
    }
    function acknowledge({ eventId, recipient, admission }) {
        const record = records.get(eventId);
        if (!record || (admission !== undefined && admission !== record.admission)) { return; }
        if (!record.destinations.has(recipient)) { throw new Error('Unknown recipient'); }
        const pair = record.pending.get(recipient);
        if (!pair) { return; }
        if (record.pending.size === 1) { remove(record); return; }
        forget(pair);
        const removedBytes = Buffer.byteLength(JSON.stringify(recipient)) + 1;
        record.bytes -= removedBytes;
        state.bytes -= removedBytes;
    }
    function ready(action) {
        try {
            if (!state.ready) { throw new Error('Spool not opened'); }
            return Promise.resolve(action());
        } catch (error) { return Promise.reject(error); }
    }
    function mutation(operation) {
        try {
            if (operation?.kind === 'append') { append(operation.event, operation.recipients); }
            else if (operation?.kind === 'ack') { acknowledge(operation); }
            else { throw new TypeError('Unknown spool mutation'); }
            return { ok: true };
        } catch (error) { return { ok: false, error }; }
    }
    function pendingFair(limit, blocked) {
        limitOf(limit, 'pending');
        const pages = pagesOf(targets, limit, new Set(blocked));
        const selected = select(pages, limit);
        for (const { target, pairs } of pages) { targets.delete(target); targets.set(target, pairs); }
        return [...selected].map(([record, pairs]) => {
            for (const pair of pairs) {
                const group = targets.get(pair.target);
                group.delete(pair); group.add(pair);
            }
            return { ...decoded(record, pairs.map(({ recipient }) => { return recipient; })), admission: record.admission,
                targets: Object.fromEntries(pairs.map(({ recipient, target }) => { return [recipient, target]; })) };
        });
    }
    return {
        open() { state.ready = true; return Promise.resolve(); },
        mutateMany(operations) {
            return ready(() => {
                if (!Array.isArray(operations) || !operations.length) { throw new TypeError('Nonempty spool mutations required'); }
                return operations.map(mutation);
            });
        },
        pendingFair(limit = 100, blocked = []) { return ready(() => { return pendingFair(limit, blocked); }); },
        hasAdmission(eventId, admission, recipient) {
            const record = records.get(eventId);
            return record?.admission === admission && Boolean(record?.pending.has(recipient));
        },
        peek(limit = 1000) { return ready(() => { return visibleRecords(records, limit); }); },
        close() {
            records.clear(); targets.clear();
            Object.assign(state, { ready: false, bytes: 0 });
            return Promise.resolve();
        },
        status() {
            return { bytes: state.bytes, maxBytes, recordLimit: maxRecords, pending: records.size, ready: state.ready,
                droppedRecords: state.droppedRecords, droppedBytes: state.droppedBytes };
        }
    };
}
