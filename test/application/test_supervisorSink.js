import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import supervisorSink, { readDeploymentConfig } from '../../src/application/supervisorSink.js';
import stateDataFromMemory from '../../src/infrastructure/persistence/stateDataFromMemory.js';
import { createEdgeApi } from '../../src/infrastructure/http/edge/edgeApi.js';

async function response(sink, url) {
    const res = {
        writeHead() {},
        end(body) { this.body = body; }
    };
    await createEdgeApi(sink.dataAccess).handle({ method: 'GET', url, headers: {} }, res);
    return JSON.parse(res.body);
}

function replacement(data, pool) {
    pool.query = async () => { throw new Error('Unexpected PostgreSQL telemetry query'); };
    const memory = stateDataFromMemory({ metrics: [
        { topic: 'sensor-37', ts: new Date('2026-10-29T08:19:23.000Z'), value: 237.5 }
    ] });
    return { ...data, metrics: memory.metrics,
        checkpoints: { ...data.checkpoints, readings: memory.checkpoints.readings } };
}

describe('supervisorSink state data', function() {
    it('serves HTTP metrics from the supplied state data factory', async function() {
        const sink = supervisorSink({}, { stateData: replacement });
        try {
            const body = await response(sink, '/v1/metrics/current?topic=sensor-37');
            assert.equal(body.value, 237.5, 'metrics ignored the state data override');
        } finally {
            await sink.pool.end();
        }
    });

    it('serves HTTP checkpoint readings from the supplied state data factory', async function() {
        const sink = supervisorSink({}, { stateData: replacement });
        try {
            const body = await response(sink, '/v1/checkpoint/readings?topic=sensor-37&from=0');
            assert.deepEqual(body.items, [{ topic: 'sensor-37', timestamp: 1793261963, value: 237.5 }],
                'checkpoint readings ignored the state data override');
        } finally {
            await sink.pool.end();
        }
    });

    it('keeps PostgreSQL phase checkpoints alongside replacement telemetry', async function() {
        const sink = supervisorSink({}, { stateData: replacement });
        sink.pool.query = async () => { return { rows: [{ cursor: 1793261907 }] }; };
        try {
            const body = await response(sink, '/v1/checkpoint/replay-cursor?machineId=machine-71');
            assert.equal(body.cursor, 1793261907, 'phase checkpoint lost its PostgreSQL port');
        } finally {
            await sink.pool.end();
        }
    });

    it('serves PostgreSQL metrics when the state data factory is absent', async function() {
        const sink = supervisorSink({});
        sink.pool.query = async () => { return { rows: [{ ts: new Date('2026-10-29T08:19:23.000Z'), value: 173.8 }] }; };
        try {
            const body = await response(sink, '/v1/metrics/current?topic=sensor-37');
            assert.equal(body.value, 173.8, 'default metrics lost their PostgreSQL port');
        } finally {
            await sink.pool.end();
        }
    });
});


describe('supervisorSink migration mode', function() {
    it('rejects unrecognized migration modes before constructing a pool', function() {
        assert.throws(() => { readDeploymentConfig({SUPERVISOR_MIGRATIONS:'skip'}); }, /SUPERVISOR_MIGRATIONS/u);
    });

    it('still requires administrative credentials in legacy mode', async function() {
        const sink = supervisorSink({SINK_PIPELINES:'false'});
        try { await assert.rejects(sink.run(), /POSTGRES_ADMIN_URL is required/u); }
        finally { await sink.pool.end(); }
    });

    for (const adminUrl of [undefined,'postgresql://must-not-be-used/scada']) {
    it(`verifies through runtime pool with admin URL ${adminUrl ? 'ignored' : 'absent'}`, async function() {
        const files = (await fs.readdir('db/migrations')).filter((name) => {
            return name.endsWith('.sql') && !name.startsWith('C') && !name.startsWith('V0009');
        });
        const sink = supervisorSink({SUPERVISOR_MIGRATIONS:'verify',SINK_PIPELINES:'false',
            POSTGRES_ADMIN_URL:adminUrl});
        const original = Object.getOwnPropertyDescriptor(pg,'Pool');
        Object.defineProperty(pg,'Pool',{value:function value() { throw new Error('Admin pool constructed'); }});
        sink.pool.query = async (sql) => {
            assert.match(sql, /^SELECT version FROM public\.schema_migrations/u);
            return {rows:files.map((version) => { return {version}; })};
        };
        try { await sink.run(); }
        finally { Object.defineProperty(pg,'Pool',original); await sink.pool.end(); }
    });

    }

    it('fails before HTTP startup if migration verification fails', async function() {
        const sink = supervisorSink({SUPERVISOR_MIGRATIONS:'verify',SINK_PIPELINES:'false'});
        let started = false;
        sink.pool.query = async () => { return {rows:[]}; };
        try {
            await assert.rejects(sink.run({start() { started = true; }}), /Missing database migrations/u);
            assert.equal(started,false);
        } finally { await sink.pool.end(); }
    });
});
