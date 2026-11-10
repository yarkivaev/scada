import { capacity, checkpoint, counters, database } from './spoolDatabase.js';
import { acknowledge, insert, pending } from './spoolRecords.js';
import { encoded } from './spoolCodec.js';
import spoolMigration from './spoolMigration.js';

/* eslint max-lines-per-function: ["error", 100], max-statements: ["error", 25] */
/** Single owner, bounded cache and indexed reads. Caps count logical JSON bytes, not allocated pages. */
export default function deliverySpool(directory, { maxBytes, maxRecords = 100000, legacyMigrationMaxBytes = 16 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) { throw new TypeError('Explicit positive spool maxBytes required'); }
    if (!Number.isSafeInteger(maxRecords) || maxRecords <= 0) { throw new TypeError('Positive safe spool maxRecords required'); }
    if (!Number.isSafeInteger(legacyMigrationMaxBytes) || legacyMigrationMaxBytes <= 0) { throw new TypeError('Positive safe legacyMigrationMaxBytes required'); }
    const state = { db: null, owner: null, ready: false, busy: false, bytes: 0, records: 0 };
    function release() {
        state.ready = false;
        try { state.db?.close(); } finally { state.owner?.close(); state.db = null; state.owner = null; }
    }
    function refresh() {
        const totals = counters(state.db); state.bytes = totals.bytes; state.records = totals.records;
    }
    async function exclusive(action, requireReady = true) {
        if (state.busy) { throw new Error('Spool operation in progress'); }
        if (requireReady && !state.ready) { throw new Error('Spool not opened'); }
        state.busy = true;
        try { return await action(); } finally { Object.assign(state, { busy:false }); }
    }
    function commit(action) {
        try { const result = state.db.transaction(action)(); refresh(); return result; }
        catch (error) { if (error.code?.startsWith('SQLITE_')) { release(); } throw error; }
    }
    return {
        open() {
            return exclusive(async () => {
                if (state.ready) { return; }
                try {
                    Object.assign(state, await database(directory));
                    capacity(state.db, maxBytes, maxRecords);
                    await spoolMigration(directory, state.db, { maxBytes, maxRecords, legacyMigrationMaxBytes });
                    refresh(); Object.assign(state, { ready:true });
                } catch (error) { release(); throw error; }
            }, false);
        },
        append(event, recipients) { return exclusive(() => { return commit(() => { insert(state.db, encoded(event, recipients), maxBytes, maxRecords); }); }); },
        ack(eventId, recipient) { return exclusive(() => { return commit(() => { acknowledge(state.db, eventId, recipient); }); }); },
        pending(limit = 100) {
            return exclusive(() => {
                if (!Number.isSafeInteger(limit) || limit <= 0) { throw new TypeError('Positive pending limit required'); }
                return commit(() => { return pending(state.db, limit); });
            });
        },
        close() {
            return exclusive(() => {
                try { if (state.db) { checkpoint(state.db); } } finally { release(); }
            }, false);
        },
        status() { return { bytes: state.bytes, maxBytes, recordLimit: maxRecords, pending: state.records, ready: state.ready }; }
    };
}
