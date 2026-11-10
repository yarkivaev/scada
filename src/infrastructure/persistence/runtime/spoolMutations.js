import { acknowledge, insert } from './spoolRecords.js';
import { encoded } from './spoolCodec.js';

function apply(db, operation, limits) {
    if (operation?.kind === 'append') { insert(db, encoded(operation.event, operation.recipients), limits.maxBytes, limits.maxRecords); }
    else if (operation?.kind === 'ack') { acknowledge(db, operation.eventId, operation.recipient); }
    else { throw new TypeError('Unknown spool mutation'); }
}
/** Ordinary admission failures are isolated; SQLite failures abort the outer durable transaction. */
export default function spoolMutations(db, operations, limits) {
    if (!Array.isArray(operations) || operations.length === 0) { throw new TypeError('Nonempty spool mutations required'); }
    return operations.map((operation) => {
        try { db.transaction(() => { apply(db, operation, limits); })(); return { ok: true }; }
        catch (error) {
            if (error.code?.startsWith('SQLITE_')) { throw error; }
            return { ok: false, error };
        }
    });
}
