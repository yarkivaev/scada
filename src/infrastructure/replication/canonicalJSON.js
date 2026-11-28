import { createHash } from 'node:crypto';

export function canonicalJSON(value) {
    if (Array.isArray(value)) { return `[${value.map(canonicalJSON).join(',')}]`; }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => {
            return `${JSON.stringify(key)}:${canonicalJSON(value[key])}`;
        }).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function jsonDigest(value) {
    return createHash('sha256').update(canonicalJSON(value)).digest('hex');
}
