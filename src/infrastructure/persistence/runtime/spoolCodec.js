import { createHash } from 'node:crypto';

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
