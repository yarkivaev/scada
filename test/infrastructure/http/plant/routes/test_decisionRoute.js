import assert from 'assert';
import { routes } from '@yarkivaev/simple-server';
import decisionRoute from '../../../../../src/infrastructure/http/plant/routes/decisionRoute.js';

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

describe('decisionRoute', function() {
    it('returns empty items when segment has no decisions', async function() {
        const catalog = {
            async list() {
                return [];
            }
        };
        const api = routes(decisionRoute('/api/v1', catalog));
        const res = mockRes();
        const start = encodeURIComponent('2024-06-01T12:00:00.000Z');
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/m-${Math.random()}/segments/${start}/decisions`,
            headers: {}
        }, res);
        const payload = JSON.parse(res.body);
        assert.strictEqual(payload.items.length, 0, 'segment without decisions must return empty list');
    });

    it('returns chronology with operator id display decidedAt and tags', async function() {
        const operatorId = 7 + Math.floor(Math.random() * 50);
        const display = `Elena_${Math.random()}`;
        const decidedAt = new Date('2024-06-01T12:05:00.000Z');
        const tag = `loading_${Math.random()}`;
        const catalog = {
            async list() {
                return [{
                    username: display,
                    operatorId,
                    decidedAt,
                    payload: JSON.stringify({
                        machine: 'm-α',
                        tags: [tag],
                        user: display
                    })
                }];
            }
        };
        const api = routes(decisionRoute('/api/v1', catalog));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/${encodeURIComponent('m-α')}/segments/${encodeURIComponent('2024-06-01T12:00:00.000Z')}/decisions`,
            headers: {}
        }, res);
        const payload = JSON.parse(res.body);
        assert.deepStrictEqual(
            payload.items[0],
            {
                operatorId,
                operator: display,
                decidedAt: decidedAt.toISOString(),
                payload: { machine: 'm-α', tags: [tag], user: display },
                tags: [tag]
            },
            'decision route did not expose operator decidedAt and tags chronology'
        );
    });

    it('passes machine id and segment start into the catalog list', async function() {
        const machine = `m-${Math.random()}`;
        const startIso = '2024-03-15T09:30:00.000Z';
        const seen = [];
        const catalog = {
            async list(id, start) {
                seen.push({ id, start: start.toISOString() });
                return [];
            }
        };
        const api = routes(decisionRoute('/api/v1', catalog));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/${encodeURIComponent(machine)}/segments/${encodeURIComponent(startIso)}/decisions`,
            headers: {}
        }, res);
        assert.deepStrictEqual(
            seen[0],
            { id: machine, start: startIso },
            'decision route did not forward machine and start to catalog'
        );
    });

    it('sorts exposed items in the order returned by the catalog', async function() {
        const first = new Date('2024-06-01T12:01:00.000Z');
        const second = new Date('2024-06-01T12:03:00.000Z');
        const catalog = {
            async list() {
                return [
                    {
                        username: 'a',
                        operatorId: 1,
                        decidedAt: first,
                        payload: '{"tags":["a"]}'
                    },
                    {
                        username: 'b',
                        operatorId: 2,
                        decidedAt: second,
                        payload: '{"tags":["b"]}'
                    }
                ];
            }
        };
        const api = routes(decisionRoute('/api/v1', catalog));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/m1/segments/${encodeURIComponent('2024-06-01T12:00:00.000Z')}/decisions`,
            headers: {}
        }, res);
        const payload = JSON.parse(res.body);
        assert.deepStrictEqual(
            payload.items.map((item) => {
                return item.decidedAt;
            }),
            [first.toISOString(), second.toISOString()],
            'decision items must keep catalog chronology order'
        );
    });

    it('lists operation decisions by key through listByKey', async function() {
        const machine = `m-${Math.random()}`;
        const key = `bath:${machine}:${Math.random().toString(36).slice(2)}`;
        const seen = [];
        const catalog = {
            async list() {
                return [];
            },
            async listByKey(id, opKey) {
                seen.push({ id, opKey });
                return [{
                    username: 'Ivan',
                    decidedAt: new Date('2024-06-01T12:05:00.000Z'),
                    payload: JSON.stringify({ kind: 'operation_op', verb: 'create', key: opKey })
                }];
            }
        };
        const api = routes(decisionRoute('/api/v1', catalog));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/${encodeURIComponent(machine)}/operations/${encodeURIComponent(key)}/decisions`,
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.strictEqual(
            seen[0].opKey === key && body.items[0].operator === 'Ivan',
            true,
            'operation decisions route did not use listByKey'
        );
    });

    it('proxies operation decisions to owning edge when owners resolve edge', async function() {
        const machine = `m-${Math.random()}`;
        const key = `bath:${machine}:${Math.random().toString(36).slice(2)}`;
        const operator = `operator_${Math.random().toString(36).slice(2)}`;
        const calls = [];
        const catalog = {
            async list() {
                return [];
            },
            async listByKey() {
                return [{ username: 'local', decidedAt: new Date(), payload: {} }];
            }
        };
        const api = routes(decisionRoute('/api/v1', catalog, {
            resolve() {
                return {
                    kind: 'edge',
                    baseUrl: 'http://edge.test/api/v1',
                    async fetch(url) {
                        calls.push(url);
                        return {
                            ok: true,
                            status: 200,
                            async text() {
                                return JSON.stringify({
                                    items: [{
                                        operator,
                                        decidedAt: '2024-06-01T12:05:00.000Z',
                                        payload: { kind: 'operation_op', verb: 'create', key }
                                    }]
                                });
                            }
                        };
                    }
                };
            }
        }));
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/${encodeURIComponent(machine)}/operations/${encodeURIComponent(key)}/decisions`,
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.strictEqual(
            calls[0].includes(`/operations/${encodeURIComponent(key)}/decisions`)
                && body.items[0].operator === operator,
            true,
            'operation decisions route did not proxy to owning edge'
        );
    });
});
