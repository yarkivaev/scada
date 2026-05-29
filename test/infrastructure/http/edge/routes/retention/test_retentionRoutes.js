import assert from 'assert';
import { routes } from '@yarkivaev/simple-server';
import retentionRoutes from '../../../../../../src/infrastructure/http/edge/routes/retention/retentionRoutes.js';

function mockRes() {
    return {
        headersSent: false,
        statusCode: 200,
        body: null,
        writeHead(code) {
            this.statusCode = code;
        },
        end(data) {
            this.body = data;
        },
        destroy() {}
    };
}

async function noopPurge() {
    return { retentionDays: 30, deleted: {} };
}

describe('retentionRoutes', function() {
    it('returns 403 when bearer token does not match', async function() {
        const pool = { query() { return Promise.reject(new Error('no')); } };
        const api = routes(retentionRoutes(`tok-${Math.random()}`, pool, 30, noopPurge));
        const res = mockRes();
        await api.handle({
            method: 'POST',
            url: '/v1/admin/retention',
            headers: { authorization: 'Bearer wrong' }
        }, res);
        assert.strictEqual(res.statusCode, 403, 'should reject invalid token');
    });
});

describe('retention disabled', function() {
    it('returns 404 when retention routes are not registered', async function() {
        const { createEdgeApi } = await import('../../../../../../src/infrastructure/http/edge/edgeApi.js');
        const { default: stateDataFake } = await import('../../../../../helpers/stateDataFake.js');
        const api = createEdgeApi(stateDataFake({}), {
            retentionEnabled: false,
            metricsEnabled: false,
            pool: { query() { return Promise.resolve({ rowCount: 0 }); } }
        });
        const res = mockRes();
        await api.handle({
            method: 'POST',
            url: '/v1/admin/retention',
            headers: {}
        }, res);
        assert.strictEqual(res.statusCode, 404, 'central prod must not expose retention route');
    });
});
