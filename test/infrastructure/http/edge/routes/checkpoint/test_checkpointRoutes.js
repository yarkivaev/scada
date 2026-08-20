import assert from 'assert';
import checkpointRoutes from '../../../../../../src/infrastructure/http/edge/routes/checkpoint/checkpointRoutes.js';
import { routes } from '@yarkivaev/simple-server';
import stateDataFake from '../../../../../helpers/stateDataFake.js';

function mockRes() {
    return {
        headersSent: false,
        statusCode: 200,
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

describe('checkpointRoutes', function() {
    it('returns 400 when replay-cursor is called without machineId', async function() {
        const data = stateDataFake({});
        const api = routes(checkpointRoutes(null, data.checkpoints));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: '/v1/checkpoint/replay-cursor',
            headers: {}
        }, res);
        assert.strictEqual(res.statusCode, 400, 'should require machineId');
    });

    it('returns 400 when readings from is not a finite number', async function() {
        const data = stateDataFake({});
        const api = routes(checkpointRoutes(null, data.checkpoints));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: '/v1/checkpoint/readings?from=not-a-number',
            headers: {}
        }, res);
        assert.strictEqual(res.statusCode, 400, 'should reject non-numeric from');
    });

    it('returns 400 when segment is called without machineId', async function() {
        const data = stateDataFake({});
        const api = routes(checkpointRoutes(null, data.checkpoints));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: '/v1/checkpoint/segment?start=1700000000',
            headers: {}
        }, res);
        assert.strictEqual(res.statusCode, 400, 'should require machineId');
    });

    it('returns 400 when segment start is not a finite number', async function() {
        const data = stateDataFake({});
        const api = routes(checkpointRoutes(null, data.checkpoints));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: '/v1/checkpoint/segment?machineId=mx&start=not-a-number',
            headers: {}
        }, res);
        assert.strictEqual(res.statusCode, 400, 'should reject non-numeric start');
    });

    it('returns null item when segment is absent', async function() {
        const data = stateDataFake({});
        const api = routes(checkpointRoutes(null, data.checkpoints));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: '/v1/checkpoint/segment?machineId=mx&start=1700000000',
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.item, null, 'should return null when segment is absent');
    });

    it('returns segment item when row exists', async function() {
        const start = new Date('2024-01-01T00:00:00.000Z');
        const end = new Date('2024-01-01T01:00:00.000Z');
        const data = stateDataFake({
            segments: [{
                machine: 'mx',
                name: 'off',
                start_time: start,
                end_time: end,
                duration: 3600,
                options: '["repair","analysis_wait"]',
                tags: '["repair"]',
                properties: '{}',
                resolved: true,
                consumed: false
            }]
        });
        const api = routes(checkpointRoutes(null, data.checkpoints));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/v1/checkpoint/segment?machineId=mx&start=${start.getTime() / 1000}`,
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.item.machine, 'mx', 'should return machine id');
        assert.deepStrictEqual(body.item.options, ['repair', 'analysis_wait'], 'should parse options');
        assert.deepStrictEqual(body.item.tags, ['repair'], 'should parse tags');
    });

    it('returns replay cursor payload when machineId is present', async function() {
        const start = new Date('2024-01-01T00:00:00.000Z');
        const end = new Date('2024-01-01T01:00:00.000Z');
        const data = stateDataFake({
            segments: [{
                machine: 'mx',
                name: 'on',
                start_time: start,
                end_time: end,
                duration: 3600,
                options: '[]',
                tags: '[]',
                properties: '{}',
                resolved: false,
                consumed: false
            }]
        });
        const api = routes(checkpointRoutes(null, data.checkpoints));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: '/v1/checkpoint/replay-cursor?machineId=mx',
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.cursor, end.getTime() / 1000, 'should return cursor from checkpoint layer');
    });

    it('returns readings for every repeated topic query key', async function() {
        const from = 1_700_000_000 + Math.floor(Math.random() * 1000);
        const voltage = `MX210/icht-\u03b1-${10 + Math.floor(Math.random() * 90)}/GET/AI1/VALUE`;
        const cosphi = `MX210/icht-\u03b1-${10 + Math.floor(Math.random() * 90)}/GET/AI4/VALUE`;
        const data = stateDataFake({
            metrics: [
                { topic: voltage, ts: new Date((from + 1) * 1000), value: 380 + Math.random() },
                { topic: cosphi, ts: new Date((from + 2) * 1000), value: 0.82 + Math.random() * 0.1 }
            ]
        });
        const api = routes(checkpointRoutes(null, data.checkpoints));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/v1/checkpoint/readings?from=${from}&topic=${encodeURIComponent(voltage)}&topic=${encodeURIComponent(cosphi)}`,
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.deepStrictEqual(
            (body.items || []).map((item) => {
                return item.topic;
            }).sort(),
            [voltage, cosphi].sort(),
            'repeated topic query keys did not return both voltage and cosphi readings'
        );
    });

    it('returns 400 when cycle-prior is called without machineId', async function() {
        const data = stateDataFake({});
        const api = routes(checkpointRoutes(null, data.checkpoints));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: '/v1/checkpoint/cycle-prior?before=1700000000&reset=lining_inspection',
            headers: {}
        }, res);
        assert.strictEqual(res.statusCode, 400, 'should require machineId');
    });

    it('returns prior items until the reset tag', async function() {
        const reset = `якорь-${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = new Date('2026-08-20T04:16:06.589Z');
        const end = new Date('2026-08-20T04:33:22.543Z');
        const later = new Date('2026-08-20T10:10:21.277Z');
        const laterEnd = new Date('2026-08-20T10:33:52.644Z');
        const data = stateDataFake({
            segments: [{
                machine: 'mx',
                name: 'off',
                start_time: later,
                end_time: laterEnd,
                duration: 1411,
                options: '[]',
                tags: '["to_ladle"]',
                properties: '{}',
                resolved: true,
                consumed: false
            }, {
                machine: 'mx',
                name: 'off',
                start_time: start,
                end_time: end,
                duration: 1035,
                options: '[]',
                tags: JSON.stringify([reset]),
                properties: '{}',
                resolved: true,
                consumed: false
            }]
        });
        const api = routes(checkpointRoutes(null, data.checkpoints));
        const res = mockRes();
        const before = Date.parse('2026-08-20T12:29:24.318Z') / 1000;
        await api.handle({
            method: 'GET',
            url: `/v1/checkpoint/cycle-prior?machineId=mx&before=${before}&reset=${encodeURIComponent(reset)}`,
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.deepStrictEqual(
            (body.items || []).map((item) => {
                return item.tags;
            }),
            [[reset], ['to_ladle']],
            'cycle-prior did not stop at the reset tag'
        );
    });
});
