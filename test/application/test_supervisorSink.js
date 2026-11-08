import assert from 'node:assert/strict';
import supervisorSink from '../../src/application/supervisorSink.js';
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
