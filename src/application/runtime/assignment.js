import { createHash } from 'node:crypto';

function canonical(value) {
    if (Array.isArray(value)) { return value.map(canonical); }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => { return [key, canonical(value[key])]; }));
    }
    return value;
}
export function taskSpecHash(spec) {
    return createHash('sha256').update(JSON.stringify(canonical(spec))).digest('hex');
}
export function identity(input) {
    if (!input || typeof input.taskId !== 'string' || !/^[\w./:-]{1,200}$/u.test(input.taskId)) {
        throw new TypeError('Invalid taskId');
    }
    if (!Number.isSafeInteger(input.generation) || input.generation < 0) { throw new TypeError('Invalid generation'); }
}
export default function assignment(input, registry) {
    identity(input);
    if (input.specVersion !== 1) { throw new TypeError('Unsupported specVersion'); }
    const json = JSON.stringify(input.spec);
    if (!json || Buffer.byteLength(json) > 1048576) { throw new TypeError('Invalid or oversized task spec'); }
    const spec = JSON.parse(json);
    Object.entries(spec.limits ?? {}).forEach(([key, value]) => {
        if (!Number.isSafeInteger(value) || value < 1) { throw new TypeError(`Invalid ${key}`); }
    });
    const adapter = registry.get(spec.adapter);
    if (!adapter) { throw new TypeError('Unknown task adapter'); }
    const hash = taskSpecHash(spec);
    if (input.specHash && input.specHash !== hash) { throw new TypeError('Invalid specHash'); }
    return { ...input, spec, specHash: hash, adapter };
}
