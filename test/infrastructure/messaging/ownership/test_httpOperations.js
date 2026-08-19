import assert from 'assert';
import httpOperations from '../../../../src/infrastructure/messaging/ownership/httpOperations.js';

function auditBody(id) {
    return { operatorId: id, client: 'monitoring' };
}

describe('httpOperations', function() {
    it('POSTs create body with operatorId to owner operations', async function() {
        const machine = `m-α-${Math.floor(Math.random() * 9000 + 1000)}`;
        const amount = Number((Math.random() * 20 + 1).toFixed(1));
        const calls = [];
        const port = httpOperations({
            baseUrl: 'http://edge.test/api/v1',
            token: 'sëcret',
            async fetch(url, options) {
                calls.push({ url, options });
                return {
                    ok: true,
                    status: 200,
                    async text() {
                        return JSON.stringify({ key: `bath:${machine}:1`, kind: 'bath' });
                    }
                };
            }
        }, machine);
        const body = {
            kind: 'bath',
            payload: { action: 'set', amount, unit: 't', source: 'api' },
            ...auditBody(7)
        };
        const result = await port.create(body);
        assert.deepStrictEqual(calls[0], {
            url: `http://edge.test/api/v1/machines/${encodeURIComponent(machine)}/operations`,
            options: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sëcret' },
                body: JSON.stringify(body)
            }
        }, 'httpOperations did not POST create to owner operations');
        assert.strictEqual(result.kind, 'bath', 'create did not return owner JSON body');
    });

    it('PUTs update body to owner operation key path', async function() {
        const machine = `m-β-${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `bath:${machine}:${Math.floor(Math.random() * 90 + 10)}`;
        const calls = [];
        const port = httpOperations({
            baseUrl: 'http://edge.test/api/v1/',
            async fetch(url, options) {
                calls.push({ url, options });
                return {
                    ok: true,
                    status: 200,
                    async text() {
                        return JSON.stringify({ key, kind: 'bath' });
                    }
                };
            }
        }, machine);
        await port.update(key, { kind: 'bath', payload: { action: 'charge', amount: 2, unit: 't', source: 'api' }, ...auditBody(3) });
        assert.strictEqual(
            calls[0].url,
            `http://edge.test/api/v1/machines/${encodeURIComponent(machine)}/operations/${encodeURIComponent(key)}`,
            'httpOperations did not PUT owner operation key'
        );
        assert.strictEqual(calls[0].options.method, 'PUT', 'update did not use PUT');
    });

    it('GETs owner operation decisions by key', async function() {
        const machine = `m-ε-${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `bath:${machine}:hist`;
        const calls = [];
        const port = httpOperations({
            baseUrl: 'http://edge.test/api/v1',
            async fetch(url, options) {
                calls.push({ url, options });
                return {
                    ok: true,
                    status: 200,
                    async text() {
                        return JSON.stringify({
                            items: [{ operator: 'Ivan', payload: { kind: 'operation_op', verb: 'create', key } }]
                        });
                    }
                };
            }
        }, machine);
        const items = await port.decisions(key);
        assert.strictEqual(
            calls[0].options.method === 'GET'
                && calls[0].url.includes(`/operations/${encodeURIComponent(key)}/decisions`)
                && items[0].operator === 'Ivan',
            true,
            'httpOperations did not GET owner operation decisions'
        );
    });

    it('DELETEs owner operation key with audit body', async function() {
        const machine = `m-γ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `bath:${machine}:del`;
        const calls = [];
        const port = httpOperations({
            baseUrl: 'http://edge.test/api/v1',
            async fetch(url, options) {
                calls.push({ url, options });
                return {
                    ok: true,
                    status: 200,
                    async text() {
                        return JSON.stringify({ key, kind: 'bath' });
                    }
                };
            }
        }, machine);
        await port.remove(key, auditBody(9));
        assert.deepStrictEqual(
            {
                url: calls[0].url,
                method: calls[0].options.method,
                body: JSON.parse(calls[0].options.body)
            },
            {
                url: `http://edge.test/api/v1/machines/${encodeURIComponent(machine)}/operations/${encodeURIComponent(key)}`,
                method: 'DELETE',
                body: auditBody(9)
            },
            'httpOperations did not DELETE owner operation with audit'
        );
    });

    it('throws SERVICE_UNAVAILABLE when owner fetch rejects', async function() {
        const machine = `m-δ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const port = httpOperations({
            baseUrl: 'http://down.test/api/v1',
            async fetch() {
                throw new Error('ECONNREFUSED');
            }
        }, machine);
        await assert.rejects(
            () => {
                return port.create({ kind: 'bath', payload: {} });
            },
            (err) => {
                return err.routeCode === 'SERVICE_UNAVAILABLE' && err.routeStatus === 503;
            },
            'unreachable owner did not fail with SERVICE_UNAVAILABLE'
        );
    });

    it('throws BAD_GATEWAY when owner returns non-ok status', async function() {
        const machine = `m-ε-${Math.floor(Math.random() * 9000 + 1000)}`;
        const port = httpOperations({
            baseUrl: 'http://edge.test/api/v1',
            async fetch() {
                return {
                    ok: false,
                    status: 500,
                    async text() {
                        return 'boom';
                    }
                };
            }
        }, machine);
        await assert.rejects(
            () => {
                return port.create({ kind: 'bath', payload: {} });
            },
            (err) => {
                return err.routeCode === 'BAD_GATEWAY' && err.routeStatus === 502;
            },
            'non-ok owner did not fail with BAD_GATEWAY'
        );
    });

    it('GETs list from owner operations path with kinds query', async function() {
        const machine = `m-ξ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const calls = [];
        const port = httpOperations({
            baseUrl: 'http://edge.test/api/v1',
            async fetch(url, options) {
                calls.push({ url, options });
                return {
                    ok: true,
                    status: 200,
                    async text() {
                        return JSON.stringify({ items: [] });
                    }
                };
            }
        }, machine);
        await port.list({ kinds: 'bath', from: '2026-08-19T06:00:00.000Z' });
        assert.deepStrictEqual(
            {
                url: calls[0].url,
                method: calls[0].options.method
            },
            {
                url: `http://edge.test/api/v1/machines/${encodeURIComponent(machine)}/operations?kinds=bath&from=2026-08-19T06%3A00%3A00.000Z`,
                method: 'GET'
            },
            'httpOperations did not GET owner operations list'
        );
    });

    it('POSTs createMany body to owner operations batch path', async function() {
        const machine = `m-ζ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const calls = [];
        const port = httpOperations({
            baseUrl: 'http://edge.test/api/v1',
            async fetch(url, options) {
                calls.push({ url, options });
                return {
                    ok: true,
                    status: 200,
                    async text() {
                        return JSON.stringify({ items: [] });
                    }
                };
            }
        }, machine);
        const body = {
            items: [{ kind: 'load', payload: { lot: 'η' } }],
            operatorId: 4
        };
        await port.createMany(body);
        assert.deepStrictEqual(
            {
                url: calls[0].url,
                method: calls[0].options.method,
                sent: JSON.parse(calls[0].options.body)
            },
            {
                url: `http://edge.test/api/v1/machines/${encodeURIComponent(machine)}/operations/batch`,
                method: 'POST',
                sent: body
            },
            'httpOperations did not POST createMany to owner batch path'
        );
    });
});
