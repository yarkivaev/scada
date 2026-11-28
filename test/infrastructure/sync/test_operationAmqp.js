import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as scada from '@yarkivaev/scada';
import operationCodec from '../../../src/infrastructure/sync/operationCodec.js';

const identity = {
    machine: 'unit-1',
    occurred_at: new Date('2025-02-03T04:05:06.789Z'),
    kind: 'inspection',
    key: 'fixture'
};

describe('operation publication', function () {
    it('round-trips upserts and payload-free deletion markers through the receiver codec', async function () {
        const upsert = { ...identity, payload: { completed: true } };
        const events = [];
        const codec = operationCodec({
            accept(item) { events.push(item); },
            remove(item) { events.push({ ...item, type: 'deleted' }); }
        });
        const deletion = scada.operationEvent({ ...upsert, type: 'deleted' });
        assert.equal(Object.hasOwn(deletion, 'payload'), false);
        await codec.accept(Buffer.from(JSON.stringify(scada.operationEvent(upsert))));
        await codec.accept(Buffer.from(JSON.stringify(deletion)));
        assert.deepEqual(events, [upsert, { ...identity, type: 'deleted' }]);
    });

    it('publishes a persistent message on the durable exchange and waits for its broker confirm', async function () {
        const channel = new EventEmitter();
        const connection = new EventEmitter();
        let pending;
        let publication;
        let declaration;
        Object.assign(channel, {
            assertExchange(...args) { declaration = args; },
            publish(exchange, routingKey, body, options, confirm) {
                publication = { exchange, routingKey, body: JSON.parse(body.toString()), options };
                pending = confirm;
                return true;
            },
            close() {}
        });
        Object.assign(connection, {
            createConfirmChannel() { return channel; },
            close() {}
        });
        const amqp = scada.operationAmqp('amqp://localhost', { connect() { return connection; } });
        try {
            await amqp.start();
            let confirmed = false;
            const publishing = amqp.publish({ ...identity, payload: {} }).then(() => { confirmed = true; });
            await new Promise((resolve) => { setImmediate(resolve); });
            assert.equal(confirmed, false);
            assert.deepEqual(declaration, ['scada.operations', 'topic', { durable: true }]);
            assert.equal(publication.routingKey, 'unit-1.fixture');
            assert.equal(publication.exchange, 'scada.operations');
            assert.equal(publication.options.persistent, true);
            assert.equal(publication.options.contentType, 'application/json');
            assert.equal(publication.body.external_key, 'fixture');
            pending(null);
            await publishing;
            assert.equal(confirmed, true);
        } finally {
            await amqp.stop();
        }
    });

    it('publishes a committed batch in request order and waits for every item', async function () {
        const local = scada.plantOperations(scada.stateDataFake().operations);
        const observed = [];
        const wrapped = scada.publishingOperations(local, async (item) => {
            const stored = await local.get(item.machine, item.key);
            assert.equal(stored.key, item.key);
            observed.push(item.key);
        });
        await wrapped.upsertMany([
            { ...identity, key: 'one', payload: {} },
            { ...identity, key: 'two', payload: {} }
        ]);
        assert.deepEqual(observed, ['one', 'two']);
    });
});
