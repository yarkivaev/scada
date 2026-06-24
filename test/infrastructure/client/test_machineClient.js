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

    it('fetches meltings with cursor params', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return { ok: true, json: async () => {return { items: [] }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.meltings({ after: '2024-01-01', before: '2024-02-01', limit: 5 });
        assert(fetchedUrl.includes('after=') && fetchedUrl.includes('limit=5'));
    });

    it('fetches single melting by id', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return { ok: true, json: async () => {return { id: 5 }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.melting(5);
        assert(fetchedUrl.includes('/meltings/5'));
    });

    it('creates melting stream connection', function() {
        let createdUrl;
        const FakeEventSource = function(url) {
            createdUrl = url;
            this.addEventListener = () => {};
            this.close = () => {};
        };
        const client = machineClient('http://localhost/api', 'icht1', () => {}, FakeEventSource);
        client.meltingStream();
        assert(createdUrl.includes('/meltings/stream'));
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

    it('starts melting with POST', async function() {
        let method;
        let fetchedUrl;
        const fakeFetch = async (url, options) => {
            fetchedUrl = url;
            method = options.method;
            return { ok: true, json: async () => {return { id: 'm1' }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.startMelting();
        assert(method === 'POST' && fetchedUrl.includes('/meltings/start'));
    });

    it('stops melting with POST', async function() {
        let method;
        let fetchedUrl;
        const fakeFetch = async (url, options) => {
            fetchedUrl = url;
            method = options.method;
            return { ok: true, json: async () => {return { id: 'm1' }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.stopMelting('m1');
        assert(method === 'POST' && fetchedUrl.includes('/meltings/m1/stop'));
    });

    it('fetches machine weight', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return { ok: true, json: async () => {return { amount: 150 }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        const result = await client.weight();
        assert(fetchedUrl.includes('/weight') && result.amount === 150);
    });

    it('sets machine weight with PUT', async function() {
        let method;
        let body;
        const fakeFetch = async (url, options) => {
            method = options.method;
            body = options.body;
            return { ok: true, json: async () => {return { amount: 200 }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.setWeight(200);
        assert(method === 'PUT' && JSON.parse(body).amount === 200);
    });

    it('loads material with POST', async function() {
        let method;
        let body;
        const fakeFetch = async (url, options) => {
            method = options.method;
            body = options.body;
            return { ok: true, json: async () => {return { amount: 50 }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.load(50);
        assert(method === 'POST' && JSON.parse(body).amount === 50);
    });

    it('dispenses material with POST', async function() {
        let method;
        let body;
        const fakeFetch = async (url, options) => {
            method = options.method;
            body = options.body;
            return { ok: true, json: async () => {return { amount: 30 }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.dispense(30);
        assert(method === 'POST' && JSON.parse(body).amount === 30);
    });

    it('fetches meltings with active filter', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return { ok: true, json: async () => {return { items: [] }} };
        };
        const client = machineClient('http://localhost/api', 'icht1', fakeFetch, function() {});
        await client.meltings({ active: true });
        assert(fetchedUrl.includes('active=true'), 'should include active=true');
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
});
