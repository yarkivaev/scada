import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import deliveryQueue from '../../../src/application/runtime/deliveryQueue.js';

describe('Node delivery queue', () => {
    let directory;
    beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'queue-')); });
    afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
    it('accepts while offline, recovers destinations after restart and drains independently of source', async () => {
        const options = { maxBytes: 10000, factory() { throw new Error('offline'); } };
        const first = deliveryQueue(directory, options);
        await first.open();
        await first.accept({ eventId: 'a', body: Buffer.from('hello') }, [{ id: 'one', type: 'amqp', url: 'amqp://host' }]);
        assert.equal((await first.drain()).failed, 1);
        const received = [];
        await first.close();
        const second = deliveryQueue(directory, { ...options, factory(spec) {
            assert.equal(spec.url, 'amqp://host');
            return { async write(records) { received.push(records[0]); } };
        } });
        await second.open();
        assert.equal((await second.drain()).delivered, 1);
        assert.equal(received[0].body.toString(), 'hello');
        assert.equal(received[0].options.mandatory, true);
        assert.equal(received[0].options.messageId, 'a');
        assert.equal(second.status().pending, 0);
    });
    it('isolates offline recipients and remembers confirmed ones', async () => {
        const received = [];
        const queue = deliveryQueue(directory, { maxBytes: 10000, factory(spec) {
            return { async write() { if (spec.id === 'bad') { throw new Error('offline'); } received.push(spec.id); } };
        } });
        await queue.open();
        await queue.accept({ eventId: 'a' }, [{ id: 'good', type: 'amqp' }, { id: 'bad', type: 'amqp' }]);
        await queue.drain(); await queue.drain();
        assert.deepEqual(received, ['good']);
        assert.equal(queue.status().pending, 1);
    });
    it('does not starve a healthy later destination behind an offline batch', async () => {
        const received = [];
        const queue = deliveryQueue(directory, { maxBytes: 10000, batchSize: 1, factory(spec) {
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

    it('releases the durable spool owner only after an accepted write finishes', async () => {
        const options = { maxBytes:10000, factory() { throw new Error('offline'); } };
        const first=deliveryQueue(directory,options); await first.open();
        const accepted=first.accept({eventId:'a'},[{id:'one',type:'amqp'}]);
        await first.close(); await accepted;
        const second=deliveryQueue(directory,options); await second.open();
        assert.equal(second.status().pending,1); await second.close();
        await assert.rejects(first.open(),/closed/u);
    });

    it('freezes recipient identities together with caller-owned destination descriptors', async () => {
        const received=[];
        const queue=deliveryQueue(directory,{maxBytes:10000,factory(spec) {return {async write() {received.push(spec.id);}};}});
        await queue.open();
        const destinations=[{id:'frozen',type:'amqp'}];
        const accepted=queue.accept({eventId:'a'},destinations); destinations[0].id='mutated'; destinations.push({id:'extra',type:'amqp'});
        await accepted; assert.deepEqual(await queue.drain(),{delivered:1,failed:0});
        assert.deepEqual(received,['frozen']); await queue.close();
    });

});
