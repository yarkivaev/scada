import { statSync } from 'node:fs';
import path from 'node:path';

const idleMs = 150;
const maxDelayMs = 2000;

export function spoolCheckpointLimits(options) {
    if (options === undefined) { return undefined; }
    if (!options || typeof options !== 'object' || Array.isArray(options)) { throw new TypeError('Invalid spool WAL checkpoint options'); }
    const { targetBytes = 2 * 1024 * 1024, maxBytes = 8 * 1024 * 1024 } = options;
    if (!Number.isSafeInteger(targetBytes) || targetBytes <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= targetBytes) {
        throw new TypeError('Spool WAL limit must be greater than its positive checkpoint target');
    }
    return { targetBytes, maxBytes };
}

export default function spoolCheckpoints(db, directory, { targetBytes, maxBytes }) {
    const file = path.join(directory, 'delivery.sqlite-wal');
    db.pragma('wal_autocheckpoint = 0');
    let timer;
    let deadline;
    let failure;

    function bytes() { return statSync(file, { throwIfNoEntry: false })?.size ?? 0; }
    function cancel() {
        clearTimeout(timer);
        timer = undefined;
        deadline = undefined;
    }
    function checkpoint(mode) { return db.pragma(`wal_checkpoint(${mode})`)[0]; }
    function maintenance() {
        cancel();
        try {
            const size = bytes();
            if (size >= maxBytes) { checkpoint('TRUNCATE'); }
            else if (size >= targetBytes) { checkpoint('PASSIVE'); }
        } catch (error) { failure = error; }
    }
    return {
        beforeWrite() {
            if (failure) {
                const error = failure;
                failure = undefined;
                throw error;
            }
            // A durable group may cross the limit. A later writer cannot extend that WAL.
            if (bytes() < maxBytes) { return; }
            cancel();
            if (checkpoint('TRUNCATE').busy !== 0) { throw new Error('Spool WAL growth limit reached while checkpoint is busy'); }
        },
        schedule() {
            try {
                if (bytes() < targetBytes) { cancel(); return; }
                const now = performance.now();
                deadline ??= now + maxDelayMs;
                // Keep the timer runnable under sustained writes once its maximum deferral expires.
                if (timer && now >= deadline) { return; }
                clearTimeout(timer);
                timer = setTimeout(maintenance, Math.min(idleMs, deadline - now));
                timer.unref();
            } catch (error) { failure = error; }
        },
        cancel
    };
}
