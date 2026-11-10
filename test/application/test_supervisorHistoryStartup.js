import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import supervisorSink from '../../src/application/supervisorSink.js';

function receiver() {
    return supervisorSink({ SUPERVISOR_MIGRATIONS: 'verify', SINK_PIPELINES: 'false',
        HISTORY_AMQP_ENABLED: 'true', HISTORY_AMQP_URL: 'amqp://unused.invalid',
        HISTORY_AMQP_BINDINGS: '["MX210.icht-1.#"]' });
}
async function applied() {
    const files = await fs.readdir('db/migrations');
    return { rows: files.filter((name) => {
        return name.endsWith('.sql') && !name.startsWith('C') && !name.startsWith('V0009');
    }).map((version) => { return { version }; }) };
}

describe('history receiver with runtime-only migration verification', function() {
    it('verifies the complete schema before starting telemetry and HTTP', async function() {
        const sink = receiver();
        const events = [];
        let verified;
        let entered;
        const querying = new Promise((resolve) => { entered = resolve; });
        sink.pool.query = () => {
            entered();
            return new Promise((resolve) => { verified = resolve; });
        };
        sink.historyTelemetry.start = async () => { events.push('history'); };
        try {
            const running = sink.run({ start() { events.push('http'); } });
            await querying;
            assert.deepEqual(events, []);
            verified(await applied());
            await running;
            assert.deepEqual(events, ['history', 'http']);
        } finally { await sink.pool.end(); }
    });

    it('does not consume telemetry or bind HTTP with missing migrations', async function() {
        const sink = receiver();
        const events = [];
        sink.pool.query = async () => { return { rows: [] }; };
        sink.historyTelemetry.start = async () => { events.push('history'); };
        try {
            await assert.rejects(sink.run({ start() { events.push('http'); } }), /Missing database migrations/u);
            assert.deepEqual(events, []);
        } finally { await sink.pool.end(); }
    });

    it('does not report ready or bind HTTP when telemetry startup fails', async function() {
        const sink = receiver();
        sink.pool.query = applied;
        sink.historyTelemetry.start = async () => { throw new Error('History transport unavailable'); };
        let bound = false;
        try {
            await assert.rejects(sink.run({ start() { bound = true; } }), /History transport unavailable/u);
            assert.equal(bound, false);
            assert.equal(sink.health().ready, false);
        } finally { await sink.pool.end(); }
    });
});
