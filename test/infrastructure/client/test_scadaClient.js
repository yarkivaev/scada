import assert from 'assert';
import scadaClient from '../../../src/infrastructure/client/scadaClient.js';

describe('scadaClient', function() {
    it('returns object with machines method', function() {
        const client = scadaClient('http://localhost', () => {}, function() {});
        assert(typeof client.machines === 'function');
    });

    it('returns object with machine method', function() {
        const client = scadaClient('http://localhost', () => {}, function() {});
        assert(typeof client.machine === 'function');
    });

    it('fetches machines from correct URL', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return {
                ok: true,
                json: async () => {return { items: [] }}
            };
        };
        const client = scadaClient('http://localhost/api', fakeFetch, function() {});
        await client.machines();
        assert(fetchedUrl === 'http://localhost/api/machines');
    });

    it('returns machines response', async function() {
        const items = [{ id: `m${Math.random()}` }];
        const fakeFetch = async () => {return {
            ok: true,
            json: async () => {return { items }}
        }};
        const client = scadaClient('http://localhost/api', fakeFetch, function() {});
        const result = await client.machines();
        assert(result.items[0].id === items[0].id);
    });

    it('throws error on failed machines request', async function() {
        const fakeFetch = async () => {return {
            ok: false,
            json: async () => {return { error: { code: 'ERROR', message: 'Failed' } }}
        }};
        const client = scadaClient('http://localhost/api', fakeFetch, function() {});
        let thrown;
        try {
            await client.machines();
        } catch (err) {
            thrown = err;
        }
        assert(thrown.code === 'ERROR');
    });

    it('returns machine client for machine id', function() {
        const client = scadaClient('http://localhost/api', () => {}, function() {});
        const machine = client.machine('m1');
        assert(typeof machine.info === 'function');
    });

    it('returns object with jump method', function() {
        const client = scadaClient('http://localhost', () => {}, function() {});
        assert(typeof client.jump === 'function', 'client should have jump method');
    });

    it('returns object with reset method', function() {
        const client = scadaClient('http://localhost', () => {}, function() {});
        assert(typeof client.reset === 'function', 'client should have reset method');
    });

    it('returns object with simulation method', function() {
        const client = scadaClient('http://localhost', () => {}, function() {});
        assert(typeof client.simulation === 'function', 'client should have simulation method');
    });

    it('returns object with heartbeatStream method', function() {
        const client = scadaClient('http://localhost', () => {}, function() {});
        assert(typeof client.heartbeatStream === 'function', 'client should have heartbeatStream method');
    });

    it('creates heartbeat connection to correct URL', function() {
        let captured;
        const fakeEventSource = function(url) {
            captured = url;
            this.addEventListener = function() {};
            this.close = function() {};
        };
        const client = scadaClient('http://localhost/api', () => {}, fakeEventSource);
        client.heartbeatStream();
        assert(captured === 'http://localhost/api/heartbeat/stream', 'should connect to heartbeat stream URL');
    });

    it('posts jump to correct URL', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return {
                ok: true,
                json: async () => {return { timestamp: '2025-01-01T00:00:00Z', offset: -1000 }}
            };
        };
        const client = scadaClient('http://localhost/api', fakeFetch, function() {});
        await client.jump('2025-01-01T00:00:00Z');
        assert(fetchedUrl.includes('/simulation/jump'), 'should post to simulation/jump URL');
    });

    it('posts jump with timestamp in body', async function() {
        let captured;
        const sent = new Date(Date.now() - Math.random() * 86400000).toISOString();
        const fakeFetch = async (url, options) => {
            captured = options;
            return {
                ok: true,
                json: async () => {return { timestamp: sent, offset: -1000 }}
            };
        };
        const client = scadaClient('http://localhost/api', fakeFetch, function() {});
        await client.jump(sent);
        assert(JSON.parse(captured.body).timestamp === sent, 'body should contain sent timestamp');
    });

    it('sends DELETE for reset to correct URL', async function() {
        let fetchedUrl;
        let fetchedMethod;
        const fakeFetch = async (url, options) => {
            fetchedUrl = url;
            fetchedMethod = options.method;
            return {
                ok: true,
                json: async () => {return { timestamp: new Date().toISOString(), offset: 0 }}
            };
        };
        const client = scadaClient('http://localhost/api', fakeFetch, function() {});
        await client.reset();
        assert(fetchedUrl.includes('/simulation') && fetchedMethod === 'DELETE', 'should send DELETE to simulation URL');
    });

    it('fetches simulation state from correct URL', async function() {
        let fetchedUrl;
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return {
                ok: true,
                json: async () => {return { timestamp: new Date().toISOString(), offset: 0 }}
            };
        };
        const client = scadaClient('http://localhost/api', fakeFetch, function() {});
        await client.simulation();
        assert(fetchedUrl === 'http://localhost/api/simulation', 'should fetch from simulation URL');
    });

    it('throws error on failed jump request', async function() {
        const fakeFetch = async () => {return {
            ok: false,
            json: async () => {return { error: { code: 'BAD_REQUEST', message: 'Invalid' } }}
        }};
        const client = scadaClient('http://localhost/api', fakeFetch, function() {});
        let thrown;
        try {
            await client.jump('invalid');
        } catch (err) {
            thrown = err;
        }
        assert(thrown.code === 'BAD_REQUEST', 'should throw with error code');
    });
});
