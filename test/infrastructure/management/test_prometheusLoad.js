import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import prometheusLoad from '../../../src/infrastructure/management/prometheusLoad.js';

async function withPrometheus(handle, exercise) {
    const server = createServer(handle);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        await exercise(`http://127.0.0.1:${server.address().port}`);
    } finally {
        const closed = once(server, 'close');
        server.close();
        await closed;
    }
}

function success(res, resultType, result) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', data: { resultType, result } }));
}

describe('Prometheus load observations', () => {
    it('reads a configured vector using a GET with server-side authorization', async () => {
        const query = '100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))';
        const requests = [];
        await withPrometheus((req, res) => {
            requests.push({ method: req.method, url: new URL(req.url, 'http://127.0.0.1'), auth: req.headers.authorization });
            success(res, 'vector', [
                { metric: { instance: 'worker-1', other: 'unused' }, value: [10, '14.75'] },
                { metric: { instance: 'worker-2' }, value: [10, '0'] },
                { metric: { instance: 'unavailable' }, value: [10, 'NaN'] },
                { metric: { instance: 'invalid' }, value: [10, null] }
            ]);
        }, async (url) => {
            const reader = prometheusLoad({
                site: 'central', url, tokenEnv: 'MONITOR_TOKEN',
                metrics: [{ name: 'cpu', query, unit: '%', resourceLabel: 'instance' }]
            }, { MONITOR_TOKEN: 'read-only-example' });
            assert.equal(reader.site, 'central');
            assert.deepEqual(await reader.sample(), [
                { name: 'cpu', unit: '%', resource: 'worker-1', value: 14.75 },
                { name: 'cpu', unit: '%', resource: 'worker-2', value: 0 }
            ]);
        });
        assert.equal(requests.length, 1);
        assert.equal(requests[0].method, 'GET');
        assert.equal(requests[0].url.pathname, '/api/v1/query');
        assert.equal(requests[0].url.searchParams.get('query'), query);
        assert.equal(requests[0].url.searchParams.get('limit'), '201');
        assert.equal(requests[0].auth, 'Bearer read-only-example');
    });

    it('reports failing or empty queries separately alongside a scalar', async () => {
        await withPrometheus((req, res) => {
            const query = new URL(req.url, 'http://127.0.0.1').searchParams.get('query');
            if (query === 'missing') {
                success(res, 'vector', []);
            } else if (query === 'invalid') {
                res.writeHead(503);
                res.end('secret backend diagnostics');
            } else {
                success(res, 'scalar', [10, '3.5']);
            }
        }, async (url) => {
            const reader = prometheusLoad({ site: 'central', url, metrics: [
                { name: 'load', unit: 'count', query: 'scalar(load)' },
                { name: 'not-observed', unit: 'bytes', query: 'missing' },
                { name: 'bad', unit: 'bytes', query: 'invalid' }
            ] });
            assert.deepEqual(await reader.sample(), [
                { name: 'load', unit: 'count', value: 3.5 },
                { name: 'not-observed', unit: 'bytes', error: 'no finite Prometheus samples' },
                { name: 'bad', unit: 'bytes', error: 'Prometheus query failed' }
            ]);
        });
    });

    it('bounds the bytes and series of a configured query response', async () => {
        await withPrometheus((req, res) => {
            const query = new URL(req.url, 'http://127.0.0.1').searchParams.get('query');
            if (query === 'body') {
                res.end(' '.repeat(1024 * 1024 + 1));
                return;
            }
            success(res, 'vector', Array.from({ length: 201 }, () => { return { value: [10, '3.5'] }; }));
        }, async (url) => {
            const reader = prometheusLoad({ site: 'central', url, metrics: [
                { name: 'bytes', unit: 'count', query: 'body' },
                { name: 'series', unit: 'count', query: 'vector' }
            ] });
            assert.deepEqual(await reader.sample(), [
                { name: 'bytes', unit: 'count', error: 'Prometheus query failed' },
                { name: 'series', unit: 'count', error: 'too many Prometheus series for this query' }
            ]);
        });
    });

    it('keeps redirects from forwarding the request or credential', async () => {
        let requests = 0;
        await withPrometheus((req, res) => {
            requests += 1;
            res.writeHead(302, { location: '/redirected' });
            res.end();
        }, async (url) => {
            const reader = prometheusLoad({
                site: 'central', url, tokenEnv: 'MONITOR_TOKEN',
                metrics: [{ name: 'cpu', unit: '%', query: 'load' }]
            }, { MONITOR_TOKEN: 'read-only-example' });
            assert.deepEqual(await reader.sample(), [{ name: 'cpu', unit: '%', error: 'Prometheus query failed' }]);
        });
        assert.equal(requests, 1);
    });

    it('rejects non-loopback plaintext and missing configured credentials', () => {
        assert.throws(() => { prometheusLoad({ url: 'http://192.0.2.1' }, {}); }, /HTTPS origin/u);
        assert.throws(() => {
            prometheusLoad({ url: 'https://example.invalid', tokenEnv: 'MONITOR_TOKEN' }, {});
        }, /missing credential MONITOR_TOKEN/u);
    });
});
