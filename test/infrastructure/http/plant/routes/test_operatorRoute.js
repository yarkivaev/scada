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

function mockReq(bodyText, meta) {
    const listeners = {};
    const req = {
        method: meta.method,
        url: meta.url,
        headers: meta.headers || {},
        on(event, fn) {
            listeners[event] = fn;
            if (listeners.end) {
                queueMicrotask(() => {
                    if (listeners.data) {
                        listeners.data(Buffer.from(bodyText));
                    }
                    listeners.end();
                });
            }
            return req;
        }
    };
    return req;
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

    it('returns internal error when operators provider fails', async function() {
        const detail = `permission denied for table operators-${Math.random()}`;
        const provider = {
            async list() {
                throw new Error(detail);
            }
        };
        const api = routes(operatorRoute('/api/v1', provider, { error() {} }));
        const res = mockRes();
        await api.handle({ method: 'GET', url: '/api/v1/operators', headers: {} }, res);
        const payload = JSON.parse(res.body);
        assert.strictEqual(payload.error.message, detail, 'operator route did not expose provider failure');
    });

    it('creates operator on POST and returns created record', async function() {
        const uid = `post-${Math.random().toString(36).slice(2)}`;
        const provider = {
            async list() {
                return [];
            },
            async create(fields) {
                return operator(42, fields.cardUid, fields.firstName, fields.lastName, fields.displayName);
            }
        };
        const api = routes(operatorRoute('/api/v1', provider));
        const res = mockRes();
        const req = mockReq(
            JSON.stringify({
                cardUid: `  ${uid}  `,
                firstName: 'Ирина',
                lastName: 'Ковалёва',
                displayName: 'Ирина Ковалёва'
            }),
            { method: 'POST', url: '/api/v1/operators' }
        );
        await api.handle(req, res);
        const payload = JSON.parse(res.body);
        assert.deepStrictEqual(
            { status: res.statusCode, cardUid: payload.cardUid, id: payload.id },
            { status: 200, cardUid: uid.toUpperCase(), id: 42 },
            'operator route did not create operator with normalized card uid'
        );
    });

    it('rejects duplicate cardUid on POST with conflict', async function() {
        const uid = `dup-${Math.random().toString(36).slice(2)}`.toUpperCase();
        const provider = {
            async list() {
                return [];
            },
            async create() {
                const err = new Error(`operator cardUid '${uid}' already exists`);
                err.routeCode = 'CONFLICT';
                err.routeStatus = 409;
                throw err;
            }
        };
        const api = routes(operatorRoute('/api/v1', provider, { error() {} }));
        const res = mockRes();
        const req = mockReq(
            JSON.stringify({
                cardUid: uid,
                firstName: 'Пётр',
                lastName: 'Сидоров',
                displayName: 'Пётр Сидоров'
            }),
            { method: 'POST', url: '/api/v1/operators' }
        );
        await api.handle(req, res);
        const payload = JSON.parse(res.body);
        assert.deepStrictEqual(
            { status: res.statusCode, code: payload.error.code },
            { status: 409, code: 'CONFLICT' },
            'operator route did not reject duplicate card uid as conflict'
        );
    });

    it('returns registration enabled flag on GET', async function() {
        const provider = {
            async list() {
                return [];
            },
            async enabled() {
                return true;
            }
        };
        const api = routes(operatorRoute('/api/v1', provider));
        const res = mockRes();
        await api.handle(
            { method: 'GET', url: '/api/v1/operators/registration-enabled', headers: {} },
            res
        );
        const payload = JSON.parse(res.body);
        assert.strictEqual(payload.enabled, true, 'operator route did not expose registration flag');
    });

    it('updates registration enabled flag on PUT', async function() {
        let stored = false;
        const provider = {
            async list() {
                return [];
            },
            async enabled() {
                return stored;
            },
            async permit(flag) {
                stored = flag;
                return stored;
            }
        };
        const api = routes(operatorRoute('/api/v1', provider));
        const res = mockRes();
        const req = mockReq(
            JSON.stringify({ enabled: true }),
            { method: 'PUT', url: '/api/v1/operators/registration-enabled' }
        );
        await api.handle(req, res);
        const payload = JSON.parse(res.body);
        assert.strictEqual(payload.enabled, true, 'operator route did not update registration flag');
    });
});
