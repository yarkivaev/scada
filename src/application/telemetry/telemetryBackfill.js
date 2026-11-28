import { createHash } from 'node:crypto';
import { micros as epochMicro } from '../../infrastructure/persistence/clickhouse/rowBinary.js';

function valueBits(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) { throw new Error('Telemetry backfill requires finite Float64 values'); }
    const bytes = Buffer.alloc(8);
    bytes.writeDoubleBE(value);
    return bytes;
}

function appendDigest(hash, row) {
    const topic = Buffer.from(row.topic, 'utf8');
    const size = Buffer.alloc(4);
    size.writeUInt32BE(topic.length);
    const timestamp = Buffer.alloc(8);
    timestamp.writeBigInt64BE(epochMicro(row.ts));
    hash.update(size).update(topic).update(timestamp).update(valueBits(row.value));
}

function failure(message, report) {
    return Object.assign(new Error(message), { report: { ...report } });
}

function indexed(rows, report) {
    const map = new Map();
    for (const row of rows) {
        const key = row.epochMicro === undefined ? epochMicro(row.ts).toString() : String(row.epochMicro);
        if (map.has(key)) { throw failure('Canonical query returned a duplicate telemetry key', report); }
        map.set(key, new Set(row.valueBits.map(String)));
    }
    return map;
}

function missingRows(page, rows, report) {
    const map = indexed(rows, report);
    return page.filter((row) => {
        const stored = map.get(epochMicro(row.ts).toString());
        return !stored?.has(valueBits(row.value).readBigUInt64BE().toString());
    });
}

async function verifyPage(target, page, repair, report) {
    const { topic, ts: first } = page[0];
    const last = page.at(-1).ts;
    const missing = missingRows(page, await target.canonical(topic, first, last), report);
    if (!missing.length) { return; }
    if (!repair) { throw failure('Missing source telemetry keys in target', report); }
    await target.insertRows(missing);
    if (missingRows(page, await target.canonical(topic, first, last), report).length) {
        throw failure('Missing source telemetry keys after repair', report);
    }
    report.missingRepaired += missing.length;
}

function checkPage(page, topic, cursor, upper, pageSize) {
    if (page.length > pageSize) { throw new Error('Source page exceeded configured bound'); }
    let prior = cursor === null ? null : epochMicro(cursor);
    const limit = epochMicro(upper);
    for (const row of page) {
        const timestamp = epochMicro(row.ts);
        if (row.topic !== topic || (prior !== null && timestamp < prior) || timestamp > limit) {
            throw new Error('Source page is outside its ordered topic fence');
        }
        valueBits(row.value);
        prior = timestamp;
    }
}

function topics(source) {
    let previous = null;
    return {
        [Symbol.asyncIterator]() { return this; },
        async next() {
            const topic = await source.nextTopic(previous);
            if (topic === null || topic === undefined) { return { done: true }; }
            if (topic === previous) { throw new Error('Source topic discovery did not advance'); }
            previous = topic;
            return { done: false, value: topic };
        }
    };
}

function pages(source, topic, upper, pageSize) {
    let cursor = null;
    return {
        [Symbol.asyncIterator]() { return this; },
        async next() {
            const page = await source.page(topic, cursor, upper, pageSize);
            checkPage(page, topic, cursor, upper, pageSize);
            if (!page.length) { return { done: true }; }
            cursor = page.at(-1).ts;
            return { done: false, value: page };
        }
    };
}

async function progress(state, topic, cursor, upper) {
    if (state.report.sourceCount < state.nextProgress) { return; }
    await state.onProgress({ ...state.report, topic, cursor, upper });
    state.nextProgress = (Math.floor(state.report.sourceCount / 1000000) + 1) * 1000000;
}

async function topicBackfill(state, topic) {
    const upper = await state.source.upper(topic);
    if (!upper) { return; }
    state.report.topics += 1;
    for await (const page of pages(state.source, topic, upper, state.pageSize)) {
        if (state.mode === 'copy') { await state.target.insertRows(page); }
        else { await verifyPage(state.target, page, state.mode === 'repair', state.report); }
        for (const row of page) { appendDigest(state.hash, row); }
        state.report.sourceCount += page.length;
        await progress(state, topic, page.at(-1).ts, upper);
    }
}

/** Copy or reconcile ordered measurement pages while preserving the source's exact raw values. */
export default async function telemetryBackfill({ source, target }, { mode = 'copy', pageSize = 20000, onProgress = () => { return undefined; } } = {}) {
    const operation = mode.toLowerCase();
    if (!['copy', 'verify', 'repair'].includes(operation)) { throw new Error('Mode must be copy, verify or repair'); }
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100000) { throw new Error('Page size must be between 1 and 100000'); }
    const report = { mode: operation, sourceCount: 0, topics: 0, missingRepaired: 0, conflictCount: 0 };
    const hash = createHash('sha256');
    const state = { source, target, report, hash, mode: operation, pageSize, onProgress, nextProgress: 1000000 };
    for await (const topic of topics(source)) { await topicBackfill(state, topic); }
    return { ...report, digest: hash.digest('hex'),
        digestEncoding: 'sha256(length32be(topicUTF8),topicUTF8,epochMicroInt64be,valueFloat64be)' };
}
