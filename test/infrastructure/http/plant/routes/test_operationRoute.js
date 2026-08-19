import assert from 'assert';
import { virtualClock } from '@yarkivaev/simple-server';
import plant from '../../../../../src/domain/plant/plant.js';
import initialized from '../../../../../src/domain/shared/initialized.js';
import shop from '../../../../../src/domain/plant/shop.js';
import machine from '../../../../../src/domain/plant/machine.js';
import { alert, acknowledgedAlert, alerts } from '../../../../../index.js';
import plantApi from '../../../../../src/application/plantApi.js';
import plantOperations from '../../../../../src/application/plantOperations.js';
import stateDataFake from '../../../../helpers/stateDataFake.js';

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

function buildPlant(data, machineId, kindSources) {
    const wrapped = plantOperations(data.operations, kindSources);
    const history = alerts(alert, acknowledgedAlert);
    const item = machine(machineId, {
        sensors: {},
        alerts: history,
        timeline: {
            list: async () => {
                return [];
            },
            pending: async () => {
                return [];
            },
            stream: () => {
                return { cancel() {} };
            }
        }
    });
    const area = shop('area', initialized({ [machineId]: item }, Object.values), history);
    return {
        plant: plant(initialized({ area }, Object.values), { operations: wrapped }),
        wrapped
    };
}

function apiFor(p) {
    return plantApi('/api/v1', p, {
        clock: virtualClock(() => {
            return new Date();
        })
    });
}

describe('operationRoute', function() {
    it('returns empty items when machine is absent', async function() {
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, `missing-${Math.random()}`);
        const api = apiFor(p);
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/unknown-${Math.random()}/operations?kind=chem`,
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.items.length, 0, 'unknown machine must return empty list');
    });

    it('returns only rows matching kind and occurred_at window', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const { plant: p, wrapped } = buildPlant(data, machineId);
        const key = `op-${Math.random()}`;
        await wrapped.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'chem',
            key,
            payload: { lot: 'α' }
        });
        await wrapped.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T13:00:00.000Z'),
            kind: 'qc',
            key: `qc-${Math.random()}`,
            payload: {}
        });
        const api = apiFor(p);
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/${machineId}/operations?kind=chem&from=2024-06-01T00:00:00.000Z&to=2024-06-02T00:00:00.000Z`,
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.items.length, 1, 'kind filter must exclude other kinds');
    });

    it('merges kinds from postgres and injectable source sorted by occurred_at', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const stamp = `temp-${Math.random()}`;
        const kindSources = {
            temp: {
                list(id) {
                    return Promise.resolve([
                        {
                            machine: id,
                            occurred_at: new Date('2024-06-01T11:00:00.000Z'),
                            kind: 'temp',
                            key: `${stamp}-early`,
                            payload: { temperature: 1483.5 }
                        },
                        {
                            machine: id,
                            occurred_at: new Date('2024-06-01T13:00:00.000Z'),
                            kind: 'temp',
                            key: `${stamp}-late`,
                            payload: { temperature: 1550.25 }
                        }
                    ]);
                }
            }
        };
        const { plant: p, wrapped } = buildPlant(data, machineId, kindSources);
        await wrapped.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'chem',
            key: `chem-${Math.random()}`,
            payload: { lot: 'β' }
        });
        const api = apiFor(p);
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/${machineId}/operations?kinds=chem,temp&from=2024-06-01T00:00:00.000Z&to=2024-06-02T00:00:00.000Z`,
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.deepStrictEqual(
            body.items.map((row) => {
                return row.kind;
            }),
            ['temp', 'chem', 'temp'],
            'merged kinds must sort by occurred_at ascending'
        );
    });

    it('defaults requested kinds to injectable source keys when query omits kind filters', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const key = `temp-only-${Math.random()}`;
        const kindSources = {
            temp: {
                list(id) {
                    return Promise.resolve([
                        {
                            machine: id,
                            occurred_at: new Date('2024-06-01T09:30:00.000Z'),
                            kind: 'temp',
                            key,
                            payload: { temperature: 1510 }
                        }
                    ]);
                }
            }
        };
        const { plant: p } = buildPlant(data, machineId, kindSources);
        const api = apiFor(p);
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/${machineId}/operations`,
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.items[0].external_key, key, 'default kinds must use injectable source keys');
    });

    it('creates operation via POST and returns external_key from body key', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `key-${Math.random().toString(36).slice(2)}`;
        const kind = `chem-${Math.floor(Math.random() * 900 + 100)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const api = apiFor(p);
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                kind,
                key,
                payload: { lot: 'αβγ', amount: 12.5 + Math.random() }
            }), {
                method: 'POST',
                url: `/api/v1/machines/${machineId}/operations`
            }),
            res
        );
        const body = JSON.parse(res.body);
        assert.strictEqual(body.external_key, key, 'POST must not drop caller-supplied operation key');
    });

    it('lists POST-created operation on subsequent GET', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `list-${Math.random().toString(36).slice(2)}`;
        const kind = `qc-${Math.floor(Math.random() * 900 + 100)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const api = apiFor(p);
        const write = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                kind,
                key,
                occurred_at: '2024-06-01T12:00:00.000Z',
                payload: { note: 'loading' }
            }), {
                method: 'POST',
                url: `/api/v1/machines/${machineId}/operations`
            }),
            write
        );
        const read = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/${machineId}/operations?kind=${kind}&from=2024-06-01T00:00:00.000Z&to=2024-06-02T00:00:00.000Z`,
            headers: {}
        }, read);
        const body = JSON.parse(read.body);
        assert.strictEqual(body.items[0].external_key, key, 'GET list cannot miss operation created by POST');
    });

    it('generates key when POST omits key', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const kind = `bath-${Math.floor(Math.random() * 900 + 100)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const api = apiFor(p);
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                kind,
                payload: { action: 'load', unit: 'kg' }
            }), {
                method: 'POST',
                url: `/api/v1/machines/${machineId}/operations`
            }),
            res
        );
        const body = JSON.parse(res.body);
        assert(
            typeof body.external_key === 'string'
            && body.external_key.includes(kind)
            && body.external_key.includes(machineId),
            'generated key cannot omit kind or machine id'
        );
    });

    it('returns 404 when POST targets unknown machine', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const missing = `missing-${Math.random().toString(36).slice(2)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const api = apiFor(p);
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                kind: 'chem',
                payload: { lot: 'δ' }
            }), {
                method: 'POST',
                url: `/api/v1/machines/${missing}/operations`
            }),
            res
        );
        assert.strictEqual(res.statusCode, 404, 'unknown machine POST cannot succeed');
    });

    it('returns 404 when plant has no operations port', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const history = alerts(alert, acknowledgedAlert);
        const item = machine(machineId, {
            sensors: {},
            alerts: history,
            timeline: {
                list: async () => {
                    return [];
                },
                pending: async () => {
                    return [];
                },
                stream: () => {
                    return { cancel() {} };
                }
            }
        });
        const area = shop('area', initialized({ [machineId]: item }, Object.values), history);
        const p = plant(initialized({ area }, Object.values));
        const api = apiFor(p);
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                kind: 'chem',
                payload: { lot: 'ε' }
            }), {
                method: 'POST',
                url: `/api/v1/machines/${machineId}/operations`
            }),
            res
        );
        assert.strictEqual(res.statusCode, 404, 'POST without operations port cannot succeed');
    });

    it('returns 400 when POST omits kind', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const api = apiFor(p);
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                payload: { lot: 'ζ' }
            }), {
                method: 'POST',
                url: `/api/v1/machines/${machineId}/operations`
            }),
            res
        );
        const body = JSON.parse(res.body);
        assert.strictEqual(body.error.code, 'BAD_REQUEST', 'POST without kind cannot be accepted');
    });

    it('returns 400 when POST omits payload', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const api = apiFor(p);
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                kind: `chem-${Math.random()}`
            }), {
                method: 'POST',
                url: `/api/v1/machines/${machineId}/operations`
            }),
            res
        );
        const body = JSON.parse(res.body);
        assert.strictEqual(body.error.code, 'BAD_REQUEST', 'POST without payload cannot be accepted');
    });

    it('updates existing operation via PUT and returns new payload', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `edit-${Math.random().toString(36).slice(2)}`;
        const kind = `bath-${Math.floor(Math.random() * 900 + 100)}`;
        const data = stateDataFake({});
        const { plant: p, wrapped } = buildPlant(data, machineId);
        await wrapped.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind,
            key,
            payload: { action: 'load', amount: 1 }
        });
        const api = apiFor(p);
        const amount = 10 + Math.random();
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                payload: { action: 'load', amount, unit: 'kg' }
            }), {
                method: 'PUT',
                url: `/api/v1/machines/${machineId}/operations/${encodeURIComponent(key)}`
            }),
            res
        );
        const body = JSON.parse(res.body);
        assert.strictEqual(body.payload.amount, amount, 'PUT cannot leave stale payload');
    });

    it('lists PUT-updated occurred_at on subsequent GET', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `time-${Math.random().toString(36).slice(2)}`;
        const kind = `chem-${Math.floor(Math.random() * 900 + 100)}`;
        const data = stateDataFake({});
        const { plant: p, wrapped } = buildPlant(data, machineId);
        await wrapped.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind,
            key,
            payload: { lot: 'α' }
        });
        const api = apiFor(p);
        const occurred = '2024-06-01T15:30:00.000Z';
        await api.handle(
            mockReq(JSON.stringify({
                occurred_at: occurred,
                payload: { lot: 'β' }
            }), {
                method: 'PUT',
                url: `/api/v1/machines/${machineId}/operations/${encodeURIComponent(key)}`
            }),
            mockRes()
        );
        const read = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/${machineId}/operations?kind=${kind}&from=2024-06-01T00:00:00.000Z&to=2024-06-02T00:00:00.000Z`,
            headers: {}
        }, read);
        const body = JSON.parse(read.body);
        assert.strictEqual(body.items[0].occurred_at, occurred, 'GET cannot miss PUT occurred_at change');
    });

    it('returns 404 when PUT targets unknown key', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const api = apiFor(p);
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                payload: { lot: 'γ' }
            }), {
                method: 'PUT',
                url: `/api/v1/machines/${machineId}/operations/missing-${Math.random().toString(36).slice(2)}`
            }),
            res
        );
        assert.strictEqual(res.statusCode, 404, 'PUT unknown key cannot succeed');
    });

    it('returns 404 when PUT targets key owned by another machine', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const otherId = `other-${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `other-${Math.random().toString(36).slice(2)}`;
        const data = stateDataFake({});
        const { plant: p, wrapped } = buildPlant(data, machineId);
        await wrapped.upsert({
            machine: otherId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'chem',
            key,
            payload: { lot: 'δ' }
        });
        const api = apiFor(p);
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                payload: { lot: 'ε' }
            }), {
                method: 'PUT',
                url: `/api/v1/machines/${machineId}/operations/${encodeURIComponent(key)}`
            }),
            res
        );
        assert.strictEqual(res.statusCode, 404, 'PUT cannot mutate key for wrong machine');
    });

    it('deletes existing operation via DELETE', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `del-${Math.random().toString(36).slice(2)}`;
        const kind = `bath-${Math.floor(Math.random() * 900 + 100)}`;
        const data = stateDataFake({});
        const { plant: p, wrapped } = buildPlant(data, machineId);
        await wrapped.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind,
            key,
            payload: { action: 'load' }
        });
        const api = apiFor(p);
        const del = mockRes();
        await api.handle({
            method: 'DELETE',
            url: `/api/v1/machines/${machineId}/operations/${encodeURIComponent(key)}`,
            headers: {}
        }, del);
        const read = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/${machineId}/operations?kind=${kind}&from=2024-06-01T00:00:00.000Z&to=2024-06-02T00:00:00.000Z`,
            headers: {}
        }, read);
        const body = JSON.parse(read.body);
        assert.strictEqual(body.items.length, 0, 'GET cannot still list deleted operation');
    });

    it('returns 404 when DELETE targets unknown key', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const api = apiFor(p);
        const res = mockRes();
        await api.handle({
            method: 'DELETE',
            url: `/api/v1/machines/${machineId}/operations/missing-${Math.random().toString(36).slice(2)}`,
            headers: {}
        }, res);
        assert.strictEqual(res.statusCode, 404, 'DELETE unknown key cannot succeed');
    });

    it('stamps operator display name into payload on POST', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const name = `Operator_${Math.floor(Math.random() * 900 + 100)}`;
        const api = plantApi('/api/v1', p, {
            clock: virtualClock(() => {
                return new Date();
            }),
            timelineOperator: {
                anonymousUsers: { hmi: name }
            }
        });
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                kind: 'bath',
                client: 'hmi',
                payload: { action: 'set', amount: 3, unit: 't', source: 'hmi' }
            }), {
                method: 'POST',
                url: `/api/v1/machines/${machineId}/operations`
            }),
            res
        );
        const body = JSON.parse(res.body);
        assert.strictEqual(body.payload.operator, name, 'POST did not stamp operator into payload');
    });

    it('records create decision when decisions port is provided', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const rows = [];
        const api = plantApi('/api/v1', p, {
            clock: virtualClock(() => {
                return new Date();
            }),
            timelineOperator: {
                anonymousUsers: { monitoring: 'Anonymous monitoring user' }
            },
            operationDecisions: {
                async insert(row) {
                    rows.push(row);
                }
            }
        });
        await api.handle(
            mockReq(JSON.stringify({
                kind: 'bath',
                client: 'monitoring',
                key: `bath:${machineId}:audit-${Math.random().toString(36).slice(2)}`,
                payload: { action: 'set', amount: 2, unit: 't', source: 'api' }
            }), {
                method: 'POST',
                url: `/api/v1/machines/${machineId}/operations`
            }),
            mockRes()
        );
        assert.strictEqual(
            rows.length === 1 && rows[0].payload.verb === 'create',
            true,
            'create did not insert user_decisions audit row'
        );
    });

    it('proxies POST to owning edge without local upsert', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const calls = [];
        const api = plantApi('/api/v1', p, {
            clock: virtualClock(() => {
                return new Date();
            }),
            timelineOperator: {
                anonymousUsers: { monitoring: 'Anonymous monitoring user' }
            },
            owners: {
                resolve() {
                    return {
                        kind: 'edge',
                        baseUrl: 'http://edge.test/api/v1',
                        async fetch(url, options) {
                            calls.push({ url, options });
                            return {
                                ok: true,
                                status: 200,
                                async text() {
                                    return JSON.stringify({
                                        machine: machineId,
                                        kind: 'bath',
                                        external_key: `bath:${machineId}:edge`,
                                        payload: { action: 'set', amount: 0, unit: 't', source: 'api' }
                                    });
                                }
                            };
                        }
                    };
                }
            }
        });
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                kind: 'bath',
                client: 'monitoring',
                payload: { action: 'set', amount: 0, unit: 't', source: 'api' }
            }), {
                method: 'POST',
                url: `/api/v1/machines/${machineId}/operations`
            }),
            res
        );
        assert.strictEqual(res.statusCode, 200, 'owner proxy POST did not succeed');
        assert.strictEqual(
            calls.length === 1 && calls[0].options.method === 'POST',
            true,
            'owner proxy did not POST to edge'
        );
        assert.strictEqual(
            JSON.parse(res.body).external_key,
            `bath:${machineId}:edge`,
            'owner proxy did not return edge response body'
        );
    });

    it('records create decision on central when proxying to owning edge', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const rows = [];
        const api = plantApi('/api/v1', p, {
            clock: virtualClock(() => {
                return new Date();
            }),
            timelineOperator: {
                anonymousUsers: { monitoring: 'Anonymous monitoring user' }
            },
            operationDecisions: {
                async insert(row) {
                    rows.push(row);
                }
            },
            owners: {
                resolve() {
                    return {
                        kind: 'edge',
                        baseUrl: 'http://edge.test/api/v1',
                        async fetch() {
                            return {
                                ok: true,
                                status: 200,
                                async text() {
                                    return JSON.stringify({
                                        machine: machineId,
                                        kind: 'bath',
                                        external_key: `bath:${machineId}:edge-audit`,
                                        occurred_at: '2024-06-01T10:00:00.000Z',
                                        payload: { action: 'set', amount: 1, unit: 't', source: 'api' }
                                    });
                                }
                            };
                        }
                    };
                }
            }
        });
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                kind: 'bath',
                client: 'monitoring',
                payload: { action: 'set', amount: 1, unit: 't', source: 'api' }
            }), {
                method: 'POST',
                url: `/api/v1/machines/${machineId}/operations`
            }),
            res
        );
        assert.strictEqual(
            res.statusCode === 200
                && rows.length === 1
                && rows[0].payload.verb === 'create'
                && rows[0].payload.key === `bath:${machineId}:edge-audit`,
            true,
            'owner proxy create did not insert central user_decisions row'
        );
    });

    it('creates many operations via POST batch and lists them in occurred_at order', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const early = `early-${Math.random().toString(36).slice(2)}`;
        const late = `late-${Math.random().toString(36).slice(2)}`;
        const kind = `load-${Math.floor(Math.random() * 900 + 100)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const api = apiFor(p);
        const write = mockRes();
        await api.handle(
            mockReq(JSON.stringify({
                items: [
                    {
                        kind,
                        key: early,
                        occurred_at: '2024-06-01T12:00:00.000Z',
                        payload: { lot: 'α' }
                    },
                    {
                        kind,
                        key: late,
                        occurred_at: '2024-06-01T12:00:00.001Z',
                        payload: { lot: 'β' }
                    }
                ]
            }), {
                method: 'POST',
                url: `/api/v1/machines/${machineId}/operations/batch`
            }),
            write
        );
        const read = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/${machineId}/operations?kind=${kind}&from=2024-06-01T00:00:00.000Z&to=2024-06-02T00:00:00.000Z`,
            headers: {}
        }, read);
        const body = JSON.parse(read.body);
        assert.deepStrictEqual(
            body.items.map((row) => {
                return row.external_key;
            }),
            [early, late],
            'batch POST did not persist both operations in occurred_at order'
        );
    });

    it('returns 400 when POST batch items is empty', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, machineId);
        const api = apiFor(p);
        const res = mockRes();
        await api.handle(
            mockReq(JSON.stringify({ items: [] }), {
                method: 'POST',
                url: `/api/v1/machines/${machineId}/operations/batch`
            }),
            res
        );
        assert.strictEqual(res.statusCode, 400, 'empty batch POST cannot succeed');
    });
});
