import assert from 'node:assert/strict';
import createDelivery from '../../../src/application/runtime/deliveryQueue.js';

const owned = [];
function deliveryQueue(...args) {
    const item = createDelivery(...args); owned.push(item); return item;
}
async function closeOwned() {
    await Promise.all(owned.splice(0).map((item) => { return item.close(); }));
}

describe('Node delivery queue', () => {
    afterEach(closeOwned);
    it('accepts while offline and delivers after connectivity returns', async () => {
        let online = false;
        const received = [];
        const queue = deliveryQueue({ maxBytes: 10000, failureCooldownMs: 0, factory(spec) {
            assert.equal(spec.url, 'amqp://host');
            if (!online) { throw new Error('offline'); }
            return { async write(records) { received.push(records[0]); } };
        } });
        await queue.open();
        await queue.accept({ eventId: 'a', body: Buffer.from('hello') }, [{ id: 'one', type: 'amqp', url: 'amqp://host' }]);
        assert.deepEqual(await queue.drain(), { delivered: 0, failed: 1 });
        assert.equal(queue.status().pending, 1);
        online = true;
        assert.deepEqual(await queue.drain(), { delivered: 1, failed: 0 });
        assert.equal(received[0].body.toString(), 'hello');
        assert.equal(received[0].options.mandatory, true);
        assert.equal(received[0].options.messageId, 'a');
        assert.equal(queue.status().pending, 0);
    });
    it('retries offline recipients without resending to confirmed ones', async () => {
        let unavailable = true;
        const received = [];
        const queue = deliveryQueue({ maxBytes: 10000, failureCooldownMs: 0, factory(spec) {
            return { async write() {
                if (spec.id === 'bad' && unavailable) { throw new Error('offline'); }
                received.push(spec.id);
            } };
        } });
        await queue.open();
        await queue.accept({ eventId: 'a' }, [{ id: 'good', type: 'amqp' }, { id: 'bad', type: 'amqp' }]);
        assert.deepEqual(await queue.drain(), { delivered: 1, failed: 1 });
        assert.deepEqual(received, ['good']);
        assert.equal(queue.status().pending, 1);
        unavailable = false;
        assert.deepEqual(await queue.drain(), { delivered: 1, failed: 0 });
        assert.deepEqual(received, ['good', 'bad']);
        assert.equal(queue.status().pending, 0);
    });
    it('does not starve a healthy later destination behind an offline batch', async () => {
        const received = [];
        const queue = deliveryQueue({ maxBytes: 10000, batchSize: 1, factory(spec) {
            return { async write() { if (spec.id === 'bad') { throw new Error('offline'); } received.push(spec.id); } };
        } });
        await queue.open();
        await queue.accept({ eventId: 'a' }, [{ id: 'bad', type: 'amqp' }]);
        await queue.accept({ eventId: 'b' }, [{ id: 'good', type: 'amqp' }]);
        await queue.drain(); await queue.drain();
        assert.deepEqual(received, ['good']);
        await queue.close();
        await assert.rejects(queue.accept({ eventId:'c' },[{id:'good',type:'amqp'}]),/closed/u);
    });

    it('discards undelivered records when the queue closes', async () => {
        const options = { maxBytes: 10000, factory() { throw new Error('offline'); } };
        const first = deliveryQueue(options);
        await first.open();
        await first.accept({ eventId: 'a' }, [{ id: 'one', type: 'amqp' }]);
        assert.equal(first.status().pending, 1);
        await first.close();
        assert.equal(first.status().pending, 0);
        const second = deliveryQueue(options);
        await second.open();
        assert.deepEqual(await second.peek(), []);
        assert.deepEqual(await second.drain(), { delivered: 0, failed: 0 });
        await assert.rejects(first.open(), /closed/u);
    });

    it('freezes recipient identities together with caller-owned destination descriptors', async () => {
        const received=[];
        const queue=deliveryQueue({maxBytes:10000,factory(spec) {return {async write() {received.push(spec.id);}};}});
        await queue.open();
        const destinations=[{id:'frozen',type:'amqp'}];
        const accepted=queue.accept({eventId:'a'},destinations); destinations[0].id='mutated'; destinations.push({id:'extra',type:'amqp'});
        await accepted; assert.deepEqual(await queue.drain(),{delivered:1,failed:0});
        assert.deepEqual(received,['frozen']); await queue.close();
    });

});
