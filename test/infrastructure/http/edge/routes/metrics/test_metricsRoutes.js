import assert from 'assert';
import stateDataFake from '../../../../../helpers/stateDataFake.js';
import { routes } from '@yarkivaev/simple-server';
import metricsRoutes from '../../../../../../src/infrastructure/http/edge/routes/metrics/metricsRoutes.js';

function mockRes() {
    return {
        headersSent: false,
        statusCode: 200,
        headers: {},
        body: null,
        writeHead(code, hdrs) {
            this.statusCode = code;
            this.headers = hdrs;
        },
        end(data) {
            this.body = data;
        },
        destroy() {}
    };
}

function makeReqWithBody(json) {
    const buf = Buffer.from(JSON.stringify(json));
    return {
        method: 'POST',
        url: '/v1/metrics/batch',
        headers: {},
        on(event, fn) {
            if (event === 'data') {
                setImmediate(() => {
                    fn(buf);
                });
            }
            if (event === 'end') {
                setImmediate(() => {
                    fn();
                });
            }
            return this;
        },
        once(event, fn) {
            return this.on(event, fn);
        }
    };
}

describe('metricsCurrentHandler', function() {
    it('returns 400 when topic query parameter is missing', async function() {
        const data = stateDataFake({});
        const list = metricsRoutes(null, data.metrics);
        const api = routes([list[0]]);
        const res = mockRes();
        await api.handle({ method: 'GET', url: '/v1/metrics/current', headers: {} }, res);
        assert.strictEqual(res.statusCode, 400, 'should require topic');
    });

    it('returns found false when no metric row exists', async function() {
        const data = stateDataFake({});
        const list = metricsRoutes(null, data.metrics);
        const api = routes([list[0]]);
        const res = mockRes();
        await api.handle({ method: 'GET', url: '/v1/metrics/current?topic=t1', headers: {} }, res);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.found, false, 'should report not found');
    });

    it('returns latest ts and value when row exists', async function() {
        const ts = new Date('2024-01-02T00:00:00.000Z');
        const data = stateDataFake({
            metrics: [{ topic: 't/x', ts, value: 3.5 }]
        });
        const list = metricsRoutes(null, data.metrics);
        const api = routes([list[0]]);
        const res = mockRes();
        await api.handle({ method: 'GET', url: '/v1/metrics/current?topic=t%2Fx', headers: {} }, res);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.found, true, 'should find row');
        assert.strictEqual(body.value, 3.5, 'should return value');
    });
});

describe('metricsBatchHandler', function() {
    it('accepts batch payload and returns ok', async function() {
        const data = stateDataFake({});
        const list = metricsRoutes(null, data.metrics);
        const api = routes([list[3]]);
        const res = mockRes();
        await api.handle(makeReqWithBody({
            items: [{ topic: 't1', ts: '2024-01-01T00:00:00.000Z', value: 1 }]
        }), res);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.inserted, 1, 'should accept batch insert');
        assert.strictEqual(data.seed.metrics.length, 1, 'should persist metric row');
    });
});
