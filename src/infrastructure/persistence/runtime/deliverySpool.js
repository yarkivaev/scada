import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, opendir, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

function filename(id) { return `${createHash('sha256').update(id).digest('hex')}.json`; }
async function syncDirectory(directory) {
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
}
async function replace(directory, name, value) {
    const temporary = path.join(directory, `${name}.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path.join(directory, name));
    await syncDirectory(directory);
}
function revive(key, value) {
    return value?.type === 'Buffer' && Array.isArray(value.data) ? Buffer.from(value.data) : value;
}
async function restore(directory, entries, maxRecords, load) {
    let bytes = 0;
    const files = await opendir(directory);
    for await (const file of files) {
        const { name } = file;
        if (/^[a-f0-9]{64}\.json$/u.test(name)) {
            if (entries.size >= maxRecords) { throw new Error('Spool record capacity exceeded during recovery'); }
            // Read one committed entry at a time; memory never holds the directory listing.
            const record = await load(name);
            if (typeof record.event?.eventId !== 'string' || filename(record.event.eventId) !== name
                || !Array.isArray(record.remaining) || !Array.isArray(record.recipients)) { throw new Error('Corrupt spool record'); }
            const { size } = await stat(path.join(directory, name));
            entries.set(record.event.eventId, { name, size }); bytes += size;
        }
    }
    return bytes;
}
/* eslint max-lines-per-function: ["error", 100], max-statements: ["error", 25] */
/** Single writer on a persistent local volume. Failed/ambiguous acknowledgements retain data. */
export default function deliverySpool(directory, { maxBytes, maxRecords = 100000 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) { throw new TypeError('Explicit positive spool maxBytes required'); }
    if (!Number.isSafeInteger(maxRecords) || maxRecords <= 0) { throw new TypeError('Positive safe spool maxRecords required'); }
    const entries = new Map();
    const state = { bytes: 0, ready: false, busy: false };
    async function exclusive(action) {
        if (state.busy) { throw new Error('Spool operation in progress'); }
        state.busy = true;
        try { return await action(); } finally { Object.assign(state, { busy: false }); }
    }
    function current() { if (!state.ready) { throw new Error('Spool not opened'); } }
    async function load(name) { return JSON.parse(await readFile(path.join(directory, name), 'utf8'), revive); }
    return {
        open() {
            return exclusive(async () => {
                Object.assign(state, { ready: false }); entries.clear(); state.bytes = 0;
                await mkdir(directory, { recursive: true, mode: 0o700 });
                const bytes = await restore(directory, entries, maxRecords, load);
                Object.assign(state, { bytes });
                Object.assign(state, { ready: true });
            });
        },
        append(event, recipients) {
            return exclusive(async () => {
                current();
                if (typeof event.eventId !== 'string' || !event.eventId || !Array.isArray(recipients) || !recipients.length
                    || recipients.some((item) => { return typeof item !== 'string' || !item; })
                    || new Set(recipients).size !== recipients.length) { throw new TypeError('Event identity and unique recipients required'); }
                const existing = entries.get(event.eventId);
                if (existing) {
                    const saved = await load(existing.name);
                    if (JSON.stringify(saved.event) !== JSON.stringify(event) || JSON.stringify(saved.recipients) !== JSON.stringify(recipients)) {
                        throw new Error('Conflicting event identity');
                    }
                    return;
                }
                if (entries.size >= maxRecords) { throw new Error('Spool record capacity exceeded'); }
                const value = JSON.stringify({ event, recipients, remaining: recipients });
                const size = Buffer.byteLength(value);
                if (state.bytes + size > maxBytes) { throw new Error('Spool capacity exceeded'); }
                const name = filename(event.eventId);
                // Reserve against ambiguous fsync outcomes; reopen reconciles actual files.
                entries.set(event.eventId, { name, size }); state.bytes += size;
                try { await replace(directory, name, value); } catch (error) { Object.assign(state, { ready: false }); throw error; }
            });
        },
        ack(eventId, recipient) {
            return exclusive(async () => {
                current();
                const entry = entries.get(eventId);
                if (!entry) { return; }
                const saved = await load(entry.name);
                if (!saved.recipients.includes(recipient)) { throw new Error('Unknown recipient'); }
                const remaining = saved.remaining.filter((item) => { return item !== recipient; });
                if (remaining.length === saved.remaining.length) { return; }
                try {
                    if (remaining.length === 0) {
                        await unlink(path.join(directory, entry.name)); await syncDirectory(directory);
                        entries.delete(eventId); state.bytes -= entry.size;
                    } else {
                        const value = JSON.stringify({ ...saved, remaining });
                        await replace(directory, entry.name, value);
                        const size = Buffer.byteLength(value); state.bytes += size - entry.size; entry.size = size;
                    }
                } catch (error) { Object.assign(state, { ready: false }); throw error; }
            });
        },
        pending(limit = 100) {
            return exclusive(async () => {
                current();
                if (!Number.isSafeInteger(limit) || limit <= 0) { throw new TypeError('Positive pending limit required'); }
                const rows = [];
                for (const entry of Array.from(entries.values()).slice(0, limit)) {
                    // Read sequentially to bound decoded records in memory.
                    // eslint-disable-next-line no-await-in-loop
                    const { event, remaining } = await load(entry.name);
                    rows.push({ event, remaining });
                    // Rotate the window so an offline recipient cannot starve later destinations.
                    entries.delete(event.eventId); entries.set(event.eventId, entry);
                }
                return rows;
            });
        },
        status() { return { bytes: state.bytes, maxBytes, recordLimit: maxRecords, pending: entries.size, ready: state.ready }; }
    };
}
