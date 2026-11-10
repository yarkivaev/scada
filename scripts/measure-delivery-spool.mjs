/** Run with Node22 --expose-gc, an actual adapter fixture JSON path and record count. Emits sizes/timing only. */
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';
import deliveryQueue from '../src/application/runtime/deliveryQueue.js';
import { revive } from '../src/infrastructure/persistence/runtime/spoolCodec.js';

const options = { maxBytes: 1e12, maxRecords: 10000000, factory() { return { write() { return Promise.resolve(); } }; } };
function memory() { global.gc?.(); return process.memoryUsage(); }
function statistics(directory) {
    const db = new Database(path.join(directory, 'delivery.sqlite'), { readonly: true });
    const result = {
        pageBytes: db.pragma('page_size', { simple: true }), pages: db.pragma('page_count', { simple: true }),
        freePages: db.pragma('freelist_count', { simple: true }),
        events: db.prepare('SELECT count(*) AS records,sum(length(payload)) AS compressedBytes FROM events').get(),
        destinations: db.prepare('SELECT count(*) AS descriptors,sum(length(json)) AS jsonBytes,sum(refs) AS referenceCount FROM destinations').get()
    };
    try { result.tables = db.prepare('SELECT name,sum(pgsize) AS bytes FROM dbstat GROUP BY name').all(); }
    catch { result.tables = 'dbstat unavailable'; }
    db.close(); return result;
}
async function allocated(directory) {
    const files = await readdir(directory);
    return Promise.all(files.map(async (name) => {
        const info = await stat(path.join(directory, name)); return { name, bytes: info.size, allocated: info.blocks * 512 };
    }));
}
async function recovery(directory) {
    const queue = deliveryQueue(directory, options); const before = memory(); const start = performance.now();
    await queue.open(); const recoveredMs = performance.now() - start; const after = memory();
    const { pending } = queue.status(); await queue.close(); return { recoveredMs, pending, before, after };
}
async function append(queue, samples, count, snapshots, concurrency = 64) {
    const start = performance.now(); let index = 0; let peakOperations = 0; let peakBytes = 0;
    while (index < count) {
        const size = Math.min(concurrency, count - index, 10000 - index % 10000);
        const writes = [];
        for (let offset = 0; offset < size; offset += 1) {
            const sample = samples[index % samples.length]; index += 1;
            // New identity preserves actual wire body, routing and destination shape.
            writes.push(queue.accept({ ...sample.event, eventId: randomUUID() }, sample.destinations));
        }
        const queued = queue.status(); peakOperations = Math.max(peakOperations, queued.queuedOperations); peakBytes = Math.max(peakBytes, queued.queuedBytes);
        // Bound producer concurrency instead of allocating one promise per retained event.
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(writes);
        if (index % 10000 === 0) { snapshots.push({ records: index, elapsedMs: performance.now() - start, ...memory() }); }
    }
    return { elapsedMs: performance.now() - start, peakOperations, peakBytes, concurrency };
}
/* eslint max-statements: ["error", 40] */
async function benchmark(fixture, count) {
    const samples = JSON.parse(await readFile(fixture, 'utf8'), revive);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'spool-measure-'));
    const queue = deliveryQueue(directory, options); const snapshots = [];
    try {
        await queue.open(); const before = memory(); const producer = await append(queue, samples, count, snapshots); const appendMs = producer.elapsedMs;
        const admitted = queue.status(); const afterAppend = memory(); const beforeCloseFiles = await allocated(directory);
        await queue.close(); const stored = statistics(directory); const files = await allocated(directory);
        const child = fork(new URL(import.meta.url), ['--recover', directory], { silent: true });
        const exited = once(child, 'exit'); const [recovered] = await once(child, 'message'); await exited;
        const drainQueue = deliveryQueue(directory, options); await drainQueue.open(); let delivered = 0;
        const drainStart = performance.now();
        while (drainQueue.status().pending) {
            // eslint-disable-next-line no-await-in-loop
            const result = await drainQueue.drain(); delivered += result.delivered;
        }
        const drainMs = performance.now() - drainStart;
        await drainQueue.close(); const drained = statistics(directory);
        const refill = deliveryQueue(directory, options); await refill.open();
        await append(refill, samples, 10000, []); await refill.close(); const reused = statistics(directory);
        return { count, producer, fixtureSamples: samples.length, admitted, before, afterAppend, snapshots, appendMs,
            appendPerSecond: count * 1000 / appendMs, beforeCloseFiles, files, stored, recovered,
            drainMs, delivered, drainPerSecond: delivered * 1000 / drainMs, drained, reused,
            limits: ['Mac APFS timing is not a Linux PVC throughput guarantee', 'Memory includes Node and runtime modules',
                'Logical admission counts full JSON envelopes; allocated SQLite pages are measured separately',
                'Producer uses bounded 64-record bursts; a serial await producer remains limited by sparse flush latency',
                'Drain uses confirmed-sink stand-in; real RabbitMQ recovery is tested separately'] };
    } finally { await queue.close(); await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[2] === '--recover') { process.send(await recovery(process.argv[3])); }
else { console.log(JSON.stringify(await benchmark(process.argv[2], Number(process.argv[3] ?? 120000)), null, 2)); }
