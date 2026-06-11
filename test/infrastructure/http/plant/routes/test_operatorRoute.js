import assert from 'assert';
import { routes } from '@yarkivaev/simple-server';
import operator from '../../../../../src/domain/operator/operator.js';
import operatorRoute from '../../../../../src/infrastructure/http/plant/routes/operatorRoute.js';

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

describe('operatorRoute', function() {
    it('returns operators as json items on GET', async function() {
        const uid = `route-${Math.random()}`;
        const provider = {
            async list() {
                return [operator(9, uid, 'Елена', 'Волкова', 'Елена Волкова')];
            }
        };
        const api = routes(operatorRoute('/api/v1', provider));
        const res = mockRes();
        await api.handle({ method: 'GET', url: '/api/v1/operators', headers: {} }, res);
        const payload = JSON.parse(res.body);
        assert.strictEqual(payload.items[0].cardUid, uid, 'operator route did not expose card uid');
    });
});
