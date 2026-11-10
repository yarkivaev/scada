import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function revive(key, value) {
    return value?.type === 'Buffer' && Array.isArray(value.data) ? Buffer.from(value.data) : value;
}
export function validate(event, recipients, remaining = recipients) {
    if (typeof event?.eventId !== 'string' || !event.eventId || !Array.isArray(recipients) || !recipients.length
        || recipients.some((item) => { return typeof item !== 'string' || !item; })
        || new Set(recipients).size !== recipients.length || !Array.isArray(remaining) || !remaining.length
        || new Set(remaining).size !== remaining.length || remaining.some((item) => { return !recipients.includes(item); })) {
        throw new TypeError('Event identity and unique recipients required; corrupt spool record');
    }
}
export function encoded(event, recipients, remaining = recipients) {
    validate(event, recipients, remaining);
    const original = JSON.stringify(event);
    const snapshot = JSON.parse(original);
    const destinations = Array.isArray(snapshot.destinations) ? snapshot.destinations.map((item) => {
        const json = JSON.stringify(item); return { id: digest(json), json };
    }) : null;
    if (destinations) { snapshot.destinations = []; }
    return {
        id: event.eventId, fingerprint: digest(JSON.stringify({ event, recipients })),
        payload: deflateSync(JSON.stringify(snapshot)), destinations,
        recipients: JSON.stringify(recipients), remaining: JSON.stringify(remaining),
        bytes: Buffer.byteLength(JSON.stringify({ event, recipients, remaining }))
    };
}
export function decoded(row, db) {
    const event = JSON.parse(inflateSync(row.payload).toString(), revive);
    if (row.destinations !== null) {
        event.destinations = JSON.parse(row.destinations).map((id) => {
            const descriptor = db.prepare('SELECT json FROM destinations WHERE id = ?').get(id);
            if (!descriptor) { throw new Error('Corrupt spool destination'); }
            return JSON.parse(descriptor.json, revive);
        });
    }
    return { event, remaining: JSON.parse(row.remaining) };
}
