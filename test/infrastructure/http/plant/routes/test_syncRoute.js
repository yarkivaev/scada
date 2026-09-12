import assert from 'assert';
import syncRoute from '../../../../../src/infrastructure/http/plant/routes/syncRoute.js';
import { jobs, jobRoutes, routes } from '@yarkivaev/simple-server';

function mockRes() {
    return {
        statusCode: 200,
        body: null,
        writeHead(code) {
            this.statusCode = code;
        },
        end(data) {
            this.body = data;
        }
    };
}

function mockReq(bodyText, headers) {
    const listeners = {};
    const req = {
        method: 'POST',
        url: '/api/v1/sync',
        headers: headers || {},
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

describe('syncRoute', function() {
    it('starts a job and returns its id', async function() {
        const board = jobs(() => {
            return new Date();
        });
        const api = routes([
            ...syncRoute('/api/v1', {
                run() {
                    return new Promise(() => {});
                }
            }, undefined, board),
            ...jobRoutes('/api/v1', board)
        ], { requestTimeoutMs: 1000 });
        const res = mockRes();
        await api.handle(mockReq(JSON.stringify({
            site: 'edge-icht-1',
            from: '2026-09-10T00:00:00.000Z',
            to: '2026-09-12T00:00:00.000Z',
            machines: ['icht1'],
            kinds: ['segments']
        })), res);
        const body = JSON.parse(res.body);
        if (body.id) {
            board.stop(body.id);
        }
        assert.strictEqual(
            res.statusCode === 202 && typeof body.id === 'string',
            true,
            'syncRoute did not start a job'
        );
    });

    it('rejects a missing bearer token', async function() {
        const api = routes(syncRoute('/api/v1', {
            run() {
                return Promise.resolve({ counts: {} });
            }
        }, `tok-${Math.random().toString(36).slice(2)}`));
        const res = mockRes();
        await api.handle(mockReq(JSON.stringify({
            site: 'edge-icht-1',
            from: '2026-09-10T00:00:00.000Z',
            to: '2026-09-12T00:00:00.000Z'
        })), res);
        assert.strictEqual(res.statusCode, 401, 'syncRoute accepted a request without the sync token');
    });
});
