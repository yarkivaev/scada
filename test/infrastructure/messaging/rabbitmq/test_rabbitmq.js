import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import rabbitmqDefinitions from '../../../../src/infrastructure/messaging/rabbitmq/definitions.js';
import reconcileRabbitmq, { reconcileRabbitmqTopology } from '../../../../src/infrastructure/messaging/rabbitmq/reconcile.js';

const vhost = 'unit/test';
const authorization = `Basic ${Buffer.from('operator:unit-password').toString('base64')}`;
const desired = rabbitmqDefinitions({ vhost, exchanges: ['events'], queues: ['inbox'],
    bindings: [{ source: 'events', destination: 'inbox', key: 'local' }],
    outboxes: [{ queue: 'delivery', exchange: 'events', keys: ['shared.*'],
        shovel: { name: 'forward', sourceUri: 'amqp://source.invalid', destinationUri: 'amqp://target.invalid',
            destinationExchange: 'ingest', reconnectDelay: 12 } }] });

function fixture() {
    const stale = { source: 'events', destination: 'delivery', destination_type: 'queue',
        routing_key: 'obsolete', properties_key: 'stale/#', arguments: {} };
    return { exchanges: [], queues: [{ name: 'retained', messages: 17 }],
        bindings: [stale, { ...stale, source: 'other', properties_key: 'foreign' },
            { ...stale, routing_key: 'shared.*', destination_type: 'exchange', properties_key: 'exchange' }],
        parameters: [{ name: 'retired', value: { 'src-queue': 'retained' } }, { name: 'another', value: {} }],
        upstreams: [{ name: 'retired-upstream', value: {} }, { name: 'external-upstream', value: {} }],
        policies: [{ name: 'retired-policy' }, { name: 'external-policy' }] };
}

function endpoint(state, writes, method, url, body) {
    const parts = url.slice('/api/'.length).split('/').map(decodeURIComponent);
    let [kind] = parts;
    if (kind === 'parameters' && parts.splice(1, 1)[0] === 'federation-upstream') { kind = 'upstreams'; }
    assert.equal(parts[1], vhost);
    if (method === 'GET') { return state[kind]; }
    writes.push([method, kind, ...parts.slice(2)]);
    if (kind === 'bindings') {
        if (method === 'POST') {
            state.bindings.push({ ...body, source: parts[3], destination_type: 'queue', destination: parts[5] });
        } else {
            state.bindings = state.bindings.filter((item) => { return item.properties_key !== parts[6]; });
        }
    } else {
        state[kind] = state[kind].filter((item) => { return item.name !== parts[2]; });
        if (method === 'PUT') { state[kind].push({ ...body, name: parts[2] }); }
    }
    return null;
}

describe('RabbitMQ durable definitions and management reconciliation', function() {
    let server;
    let state;
    let writes;
    let options;
    beforeEach(async function() {
        state = fixture();
        writes = [];
        server = createServer(async (request, response) => {
            try {
                assert.equal(request.headers.authorization, authorization);
                const chunks = [];
                for await (const chunk of request) { chunks.push(chunk); }
                const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
                const result = endpoint(state, writes, request.method, request.url, body);
                response.end(JSON.stringify(result));
            } catch {
                response.writeHead(400).end();
            }
        });
        await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
        options = { vhost, username: 'operator', password: 'unit-password', base: `http://127.0.0.1:${server.address().port}`,
            ownsBinding: (row) => { return row.source === 'events' && row.destination_type === 'queue'; },
            ownsShovel: (row) => { return row.name === 'retired'; } };
    });
    afterEach(async function() { await new Promise((resolve) => { server.close(resolve); }); });
    it('declares the topology, scopes deletions, retains queues and leaves a converged broker alone', async function() {
        assert.equal(await reconcileRabbitmq(desired, options), 8);
        assert.deepEqual(writes.filter(([method]) => { return method === 'DELETE'; }), [
            ['DELETE', 'bindings', 'e', 'events', 'q', 'delivery', 'stale/#'], ['DELETE', 'parameters', 'retired']]);
        assert.equal(state.queues.find(({ name }) => { return name === 'retained'; }).messages, 17);
        assert(state.parameters.some(({ name }) => { return name === 'another'; }));
        assert(state.bindings.some(({ properties_key: key }) => { return key === 'exchange'; }));
        assert(state.bindings.some(({ properties_key: key }) => { return key === 'foreign'; }));
        assert.equal(state.parameters.find(({ name }) => { return name === 'forward'; }).value['dest-exchange'], 'ingest');
        assert.equal(state.queues.find(({ name }) => { return name === 'delivery'; }).durable, true);
        writes.length = 0;
        assert.equal(await reconcileRabbitmq(desired, options), 0);
        assert.deepEqual(writes, []);
    });
    it('changes only declared and owned federation objects after declaring the underlying topology', async function() {
        const topology = { ...desired, parameters: [...desired.parameters, { component: 'federation-upstream',
            name: 'remote', vhost, value: { uri: 'amqp://remote.invalid' } }], policies: [{ name: 'link', vhost,
            pattern: '^events$', definition: { 'federation-upstream': 'remote' }, 'apply-to': 'exchanges', priority: 1 }] };
        const managed = { ...options, ownsUpstream: (row) => { return row.name === 'retired-upstream'; },
            ownsPolicy: (row) => { return row.name === 'retired-policy'; } };
        assert.equal(await reconcileRabbitmqTopology(topology, managed), 12);
        assert.deepEqual(writes.slice(-4), [
            ['PUT', 'upstreams', 'remote'], ['PUT', 'policies', 'link'],
            ['DELETE', 'upstreams', 'retired-upstream'], ['DELETE', 'policies', 'retired-policy']]);
        assert.deepEqual(state.upstreams.map(({ name }) => { return name; }), ['external-upstream', 'remote']);
        assert.deepEqual(state.policies.map(({ name }) => { return name; }), ['external-policy', 'link']);
        assert.equal(await reconcileRabbitmqTopology(topology, managed), 0);
    });
    it('performs no deletions without a declared ownership policy', async function() {
        const connection = { ...options, ownsBinding: undefined, ownsShovel: undefined };
        await reconcileRabbitmq(desired, connection);
        assert(!writes.some(([method]) => { return method === 'DELETE'; }));
    });
    it('rejects a conflicting vhost before making changes', async function() {
        await assert.rejects(reconcileRabbitmq(desired, { ...options, vhost: 'other' }), /different virtual host/u);
        assert.deepEqual(writes, []);
    });
    it('stops on a management request error', async function() {
        await assert.rejects(reconcileRabbitmq(desired, { ...options, password: '' }), /broker GET.*HTTP 400/u);
        assert.deepEqual(writes, []);
    });
});
