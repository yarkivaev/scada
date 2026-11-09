import { createHash } from 'node:crypto';
import centralPoint from './centralPoint.js';
import { CENTRAL_RULE_FIELDS, centralRule } from './centralPolicy.js';

export const MAX_BATCH_BYTES = 2097152;
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function address(value, protocols) {
    const url = new URL(value);
    if (!protocols.includes(url.protocol)) { throw new TypeError('Invalid central admission endpoint'); }
    const ports = { 'amqp:': '5672', 'amqps:': '5671', 'http:': '80', 'https:': '443' };
    const path = url.protocol.startsWith('amqp') ? decodeURIComponent(url.pathname.slice(1) || '/') : url.pathname;
    return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || ports[url.protocol]}/${path}`;
}
export function targetIdentity(url) { return digest(address(url, ['http:', 'https:'])); }
export function admissionDomain(url, queue, target) {
    return digest(`${address(url, ['amqp:', 'amqps:'])}|${queue}|${target}`);
}
function keys(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => { return !allowed.includes(key); })) {
        throw new TypeError('Invalid central admission envelope');
    }
}
function observation(value) {
    keys(value, ['topic', 'ts', 'value', ...CENTRAL_RULE_FIELDS]);
    if (CENTRAL_RULE_FIELDS.some((key) => { return value[key] === undefined; })) { throw new TypeError('Missing frozen central policy'); }
    const rule = centralRule(Object.fromEntries(CENTRAL_RULE_FIELDS.map((key) => { return [key, value[key]]; })));
    return { ...centralPoint(value), ...rule };
}
export function encodeBatch(records, policy, target) {
    if (!Array.isArray(records) || !records.length || records.length > 1000) { throw new TypeError('Invalid central batch length'); }
    const body = JSON.stringify({ version: 4, target, admittedAt: Date.now(), records: records.map((record) => {
        const point = centralPoint(record);
        return { ...point, ...centralRule(policy.forTopic(point.topic)) };
    }) });
    if (Buffer.byteLength(body) > MAX_BATCH_BYTES) { throw new TypeError('Central batch byte capacity exceeded'); }
    return body;
}
export function decodeBatch(content, target) {
    if (Buffer.byteLength(content) > MAX_BATCH_BYTES) { throw new TypeError('Central batch byte capacity exceeded'); }
    const batch = JSON.parse(content.toString());
    keys(batch, ['version', 'target', 'admittedAt', 'records']);
    if (batch.version !== 4 || batch.target !== target) { throw new TypeError('Invalid central envelope version or target'); }
    if (!Array.isArray(batch.records) || !batch.records.length || batch.records.length > 1000) { throw new TypeError('Invalid central batch length'); }
    if (!Number.isSafeInteger(batch.admittedAt) || batch.admittedAt < 0) { throw new TypeError('Invalid central admission time'); }
    return { records: batch.records.map(observation), admittedAt: batch.admittedAt, batchId: digest(content) };
}
