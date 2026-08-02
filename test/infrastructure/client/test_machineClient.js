import assert from 'assert';
import machineClient from '../../../src/infrastructure/client/machineClient.js';

describe('machineClient', function() {
    it('fetches machine info from correct URL', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return { ok: true, json: async () => {return { id: 'icht1' }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.info();
        assert(fetchedUrl === 'http://localhost/api/machines/icht1');
    });

    it('returns machine info', async function() {
        const info = { id: `m${Math.random()}`, name: 'Test' };
        const fakeFetch = async () => {return { ok: true, json: async () => {return info} }};
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        const result = await client.info();
        assert(result.id === info.id);
    });

    it('fetches measurements with query params', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return { ok: true, json: async () => {return { items: [] }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.measurements({ keys: ['voltage'], from: 'now-1h', to: 'now', step: 60 });
        assert(fetchedUrl.includes('keys=voltage') && fetchedUrl.includes('step=60'));
    });

    it('fetches measurements without options', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return { ok: true, json: async () => {return { items: [] }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.measurements();
        assert(fetchedUrl === 'http://localhost/api/machines/icht1/measurements');
    });

    it('creates measurement stream connection', function() {
        let createdUrl;
        const FakeEventSource = function(url) {
            createdUrl = url;
            this.addEventListener = () => {};
            this.close = () => {};
        };
        const client = machineClient('http://localhost/api', 'icht1', () => {}, FakeEventSource);
        client.measurementStream({ keys: ['voltage'] });
        assert(createdUrl.includes('/measurements/stream') && createdUrl.includes('keys=voltage'));
    });

    it('fetches alerts with pagination', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return { ok: true, json: async () => {return { items: [] }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.alerts({ page: 2, size: 20, acknowledged: false });
        assert(fetchedUrl.includes('page=2') && fetchedUrl.includes('size=20') && fetchedUrl.includes('acknowledged=false'));
    });

    it('creates alert stream connection', function() {
        let createdUrl;
        const FakeEventSource = function(url) {
            createdUrl = url;
            this.addEventListener = () => {};
            this.close = () => {};
        };
        const client = machineClient('http://localhost/api', 'icht1', () => {}, FakeEventSource);
        client.alertStream();
        assert(createdUrl.includes('/alerts/stream'));
    });

    it('acknowledges alert with PATCH', async function() {
        let method;
        let body;
        const fakeFetch = async (url, options) => {
            ({ method, body } = options);
            return { ok: true, json: async () => {return { id: 'a1', acknowledged: true }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.acknowledge('alert-1');
        assert(method === 'PATCH' && JSON.parse(body).acknowledged === true);
    });

    it('throws error on failed request', async function() {
        const fakeFetch = async () => {return {
            ok: false,
            json: async () => {return { error: { code: 'NOT_FOUND', message: 'Not found' } }}
        }};
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        let thrown;
        try {
            await client.info();
        } catch (err) {
            thrown = err;
        }
        assert(thrown.error.code === 'NOT_FOUND');
    });

    it('fetches cycles with from and to query params', async function() {
        let fetchedUrl;
        const from = `2024-0${1 + Math.floor(Math.random() * 9)}-15T12:34:56.789Z`;
        const to = `2024-1${Math.floor(Math.random() * 2)}-28T23:45:01.234Z`;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return { ok: true, json: async () => {return { items: [] }} };
        };
        const client = machineClient('http://localhost/api', `icht-${Math.random()}`, fakeFetch, function() {});
        await client.cycles({ from, to });
        assert(
            fetchedUrl.includes('/cycles?')
            && fetchedUrl.includes(`from=${encodeURIComponent(from)}`)
            && fetchedUrl.includes(`to=${encodeURIComponent(to)}`),
            'cycles GET must include from and to query params'
        );
    });

    it('returns cycles payload from GET response', async function() {
        const payload = { items: [{ id: `цикл-${Math.random()}`, startedAt: '2024-03-01T00:00:00.000Z' }] };
        const fakeFetch = async () => {return { ok: true, json: async () => {return payload} }};
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        const result = await client.cycles({ from: 'now-1d', to: 'now' });
        assert.strictEqual(result, payload, 'cycles must return response body');
    });

    it('fetches cycles without options', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return { ok: true, json: async () => {return { items: [] }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.cycles();
        assert(fetchedUrl === 'http://localhost/api/machines/icht1/cycles', 'cycles without options must hit base path');
    });

    it('fetches operations with kind and range query params', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return { ok: true, json: async () => {return { items: [] }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.operations({
            kind: 'chem',
            from: '2024-06-01T00:00:00.000Z',
            to: '2024-06-02T00:00:00.000Z'
        });
        assert(
            fetchedUrl.includes('/operations?')
            && fetchedUrl.includes('kind=chem')
            && fetchedUrl.includes('from=')
            && fetchedUrl.includes('to='),
            'operations GET must include kind and range query params'
        );
    });

    it('returns operations items array from GET response', async function() {
        const items = [{ key: `op-${Math.random()}`, kind: 'chem' }];
        const fakeFetch = async () => {return { ok: true, json: async () => {return { items }} }};
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        const result = await client.operations({ kind: 'chem' });
        assert.strictEqual(result, items, 'operations must return items array not wrapper object');
    });

    it('fetches operations without options', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return { ok: true, json: async () => {return { items: [] }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.operations();
        assert(fetchedUrl === 'http://localhost/api/machines/icht1/operations', 'operations without options must hit base path');
    });

    it('creates operations stream on plant SSE endpoint', function() {
        let createdUrl;
        const FakeEventSource = function(url) {
            createdUrl = url;
            this.addEventListener = () => {};
            this.close = () => {};
        };
        const client = machineClient('http://localhost/api/v1', 'icht1', () => {}, FakeEventSource);
        client.operationsStream(() => {});
        assert(createdUrl === 'http://localhost/api/v1/operations/stream', 'operations stream must use plant-wide SSE endpoint');
    });

    it('notifies callback on operation_created SSE event', function() {
        const listeners = {};
        const FakeEventSource = function() {
            this.addEventListener = (event, fn) => {
                listeners[event] = fn;
            };
            this.close = () => {};
        };
        let received;
        const client = machineClient('http://localhost/api/v1', 'icht1', () => {}, FakeEventSource);
        client.operationsStream((payload) => {
            received = payload;
        });
        listeners.operation_created({ data: '{"key":"α"}' });
        assert(received.key === 'α', 'operation_created event must invoke stream callback');
    });

    it('notifies callback on operation_updated SSE event', function() {
        const listeners = {};
        const FakeEventSource = function() {
            this.addEventListener = (event, fn) => {
                listeners[event] = fn;
            };
            this.close = () => {};
        };
        let received;
        const client = machineClient('http://localhost/api/v1', 'icht1', () => {}, FakeEventSource);
        client.operationsStream((payload) => {
            received = payload;
        });
        listeners.operation_updated({ data: '{"key":"β"}' });
        assert(received.key === 'β', 'operation_updated event must invoke stream callback');
    });

    it('posts createOperation with kind and payload', async function() {
        let method;
        let fetchedUrl;
        let body;
        const kind = `bath-${Math.floor(Math.random() * 900 + 100)}`;
        const payload = { action: 'load', unit: 'кг', amount: 3 + Math.random() };
        const fakeFetch = async (url, options) => {
            fetchedUrl = url;
            method = options.method;
            body = options.body;
            return { ok: true, json: async () => {return { external_key: `${kind}:x` }} };
        };
        const client = machineClient('http://localhost/api', `icht-${Math.random()}`, fakeFetch, function() {});
        await client.createOperation({ kind, payload });
        const parsed = JSON.parse(body);
        assert(
            method === 'POST'
            && fetchedUrl.includes('/operations')
            && parsed.kind === kind
            && parsed.payload.unit === payload.unit,
            'createOperation cannot skip POST body fields'
        );
    });

    it('posts createOperation with occurred_at and key when provided', async function() {
        let body;
        const key = `ключ-${Math.random().toString(36).slice(2)}`;
        const occurredAt = `2024-0${1 + Math.floor(Math.random() * 9)}-15T12:34:56.789Z`;
        const fakeFetch = async (url, options) => {
            body = options.body;
            return { ok: true, json: async () => {return { external_key: key }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.createOperation({
            kind: 'chem',
            payload: { lot: 'η' },
            occurredAt,
            key
        });
        const parsed = JSON.parse(body);
        assert.deepStrictEqual(
            { occurred_at: parsed.occurred_at, key: parsed.key },
            { occurred_at: occurredAt, key },
            'createOperation cannot drop optional occurredAt or key'
        );
    });

    it('puts updateOperation with payload and optional fields', async function() {
        let method;
        let fetchedUrl;
        let body;
        const key = `прав-${Math.random().toString(36).slice(2)}`;
        const kind = `bath-${Math.floor(Math.random() * 900 + 100)}`;
        const occurredAt = `2024-0${1 + Math.floor(Math.random() * 9)}-20T08:15:00.000Z`;
        const payload = { action: 'load', unit: 'кг', amount: 7 + Math.random() };
        const fakeFetch = async (url, options) => {
            fetchedUrl = url;
            method = options.method;
            body = options.body;
            return { ok: true, json: async () => {return { external_key: key }} };
        };
        const client = machineClient('http://localhost/api', `icht-${Math.random()}`, fakeFetch, function() {});
        await client.updateOperation(key, { kind, payload, occurredAt });
        const parsed = JSON.parse(body);
        assert(
            method === 'PUT'
            && fetchedUrl.includes(`/operations/${encodeURIComponent(key)}`)
            && parsed.kind === kind
            && parsed.occurred_at === occurredAt
            && parsed.payload.unit === payload.unit,
            'updateOperation cannot skip PUT body fields'
        );
    });

    it('deletes via deleteOperation by key', async function() {
        let method;
        let fetchedUrl;
        const key = `удал-${Math.random().toString(36).slice(2)}`;
        const fakeFetch = async (url, options) => {
            fetchedUrl = url;
            method = options.method;
            return { ok: true, json: async () => {return {}} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.deleteOperation(key);
        assert(
            method === 'DELETE' && fetchedUrl.includes(`/operations/${encodeURIComponent(key)}`),
            'deleteOperation cannot skip DELETE by key'
        );
    });

    it('notifies callback on operation_deleted SSE event', function() {
        const listeners = {};
        const FakeEventSource = function() {
            this.addEventListener = (event, fn) => {
                listeners[event] = fn;
            };
            this.close = () => {};
        };
        let received;
        const client = machineClient('http://localhost/api/v1', 'icht1', () => {}, FakeEventSource);
        client.operationsStream((payload) => {
            received = payload;
        });
        listeners.operation_deleted({ data: '{"key":"γ"}' });
        assert(received.key === 'γ', 'operation_deleted event must invoke stream callback');
    });

    it('does not expose removed weight and meltings methods', function() {
        const client = machineClient('http://localhost/api', 'icht1', () => {}, function() {});
        assert.strictEqual(
            [
                client.weight,
                client.setWeight,
                client.load,
                client.dispense,
                client.meltings,
                client.melting,
                client.meltingStream,
                client.startMelting,
                client.stopMelting
            ].every((value) => {
                return value === undefined;
            }),
            true,
            'machineClient cannot keep removed weight or meltings methods'
        );
    });
});
