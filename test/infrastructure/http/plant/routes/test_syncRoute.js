import assert from 'assert';
import syncRoute from '../../../../../src/infrastructure/http/plant/routes/syncRoute.js';
import { routes } from '@yarkivaev/simple-server';

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
    it('returns counts from siteSync.run', async function() {
        const api = routes(syncRoute('/api/v1', {
            run(request) {
                return Promise.resolve({
                    site: request.site,
                    machines: request.machines,
                    counts: { segments: 3 }
                });
            }
        }));
        const res = mockRes();
        await api.handle(mockReq(JSON.stringify({
            site: 'edge-icht-1',
            from: '2026-09-10T00:00:00.000Z',
            to: '2026-09-12T00:00:00.000Z',
            machines: ['icht1'],
            kinds: ['segments']
        })), res);
        const body = JSON.parse(res.body);
        assert.strictEqual(
            body.counts.segments === 3 && body.site === 'edge-icht-1',
            true,
            'syncRoute did not return siteSync counts'
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
