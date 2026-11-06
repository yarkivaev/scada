import positive from './positive.js';
import budgetAccept from './budgetAccept.js';

export function stompSettings(options, prefetch) {
    const config = { acceptTimeoutMs: 10000, stopTimeoutMs: 5000, maxMessageBytes: 1048576, ...options };
    config.deliveryTimeoutMs ??= config.acceptTimeoutMs;
    config.maxPendingBytes ??= prefetch * config.maxMessageBytes;
    ['acceptTimeoutMs', 'deliveryTimeoutMs', 'stopTimeoutMs', 'maxMessageBytes', 'maxPendingBytes'].forEach((key) => { positive(config[key], key); });
    if (!Number.isSafeInteger(config.maxMessageBytes) || !Number.isSafeInteger(config.maxPendingBytes)) {
        throw new TypeError('STOMP byte capacities must be safe integers');
    }
    return config;
}
function overflow() { return new Error('STOMP payload capacity exceeded'); }
function legacyRead(message, maximum) {
    return new Promise((resolve, reject) => {
        message.readString('utf-8', (error, body) => {
            if (error) { reject(error); }
            else if (Buffer.byteLength(body) > maximum) { reject(overflow()); }
            else { resolve(body.toString()); }
        });
    });
}
/** Native stompit frames are Readables: bound bytes before concatenating the body. */
export async function readStomp(message, maximum) {
    if (!message[Symbol.asyncIterator]) { return legacyRead(message, maximum); }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of message) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maximum) { throw overflow(); }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
}
/** Counters and global leases follow real acceptance, including after an uncertain timeout. */
export async function acceptStomp(ctx, body, settle) {
    if (!ctx.lifecycle.active) { throw new Error('STOMP source stopped'); }
    const bytes = Buffer.byteLength(body);
    if (ctx.lifecycle.bytes + bytes > ctx.lifecycle.maxPendingBytes) { throw overflow(); }
    ctx.lifecycle.bytes += bytes;
    try {
        return await budgetAccept(ctx.collector, { destination: ctx.destination, payload: body, settle }, bytes,
            ctx.lifecycle, { signal: ctx.lifecycle.controller.signal });
    } finally { ctx.lifecycle.bytes -= bytes; }
}
