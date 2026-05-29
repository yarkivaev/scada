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
});
