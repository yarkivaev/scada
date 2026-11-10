/* eslint-disable no-await-in-loop -- These integration fixtures poll sequentially for external readiness. */
import assert from 'node:assert/strict';
import { GenericContainer, Wait } from 'testcontainers';
import amqp from 'amqplib';
import amqpSink from '../../../src/infrastructure/streams/amqpSink.js';
import amqpSource from '../../../src/infrastructure/streams/amqpSource.js';
import deliveryQueue from '../../../src/application/runtime/deliveryQueue.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function pause(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}
async function until(probe, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (!await probe()) {
        if (Date.now() >= deadline) { throw new Error('AMQP recovery condition timed out'); }
        await pause(100);
    }
}

describe('AMQP source and sink integration', function() {
    let container;
    let url;
    let source;
    let sink;
    before(async function() {
        this.timeout(120000);
        container = await new GenericContainer('rabbitmq:3.13-management')
            .withEnvironment({ RABBITMQ_DEFAULT_USER: 'streams', RABBITMQ_DEFAULT_PASS: 'streams' })
            .withExposedPorts(5672)
            .withWaitStrategy(Wait.forListeningPorts())
            .withStartupTimeout(90000).start();
        url = `amqp://streams:streams@${container.getHost()}:${container.getMappedPort(5672)}`;
    });
    after(async function() {
        this.timeout(30000);
        await source?.stop();
        await sink?.stop();
        await container?.stop();
    });
    it('awaits acceptance and restores exactly one consumer and confirmed publishing after broker restart', async function() {
        this.timeout(60000);
        const received = [];
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const exchange = 'streams.integration';
        const queue = 'streams.integration.queue';
        const exchanges = [{ name: exchange, type: 'direct', options: { durable: true } }];
        source = amqpSource(url, queue, { async accept(delivery) {
            const body = delivery.content.toString();
            received.push(body);
            if (body === 'first') { await gate; }
        } }, { exchanges, bindings: [{ exchange, pattern: 'record' }], prefetch: 1, onError: () => {} });
        sink = amqpSink(url, { exchanges, retryMs: 100, onError: () => {} });
        await source.start();
        await sink.start();
        await sink.write(['first', 'second'].map((body) => {
            return { exchange, routingKey: 'record', body, options: { persistent: true } };
        }));
        await until(() => { return received.length === 1; });
        await pause(200);
        assert.deepEqual(received, ['first'], 'prefetch credit returned before acceptance');
        release();
        await until(() => { return received.length === 2; });
        const down = await container.exec(['rabbitmqctl', 'stop_app']);
        assert.equal(down.exitCode, 0, down.output);
        await until(() => { return !sink.active(); });
        const up = await container.exec(['rabbitmqctl', 'start_app']);
        assert.equal(up.exitCode, 0, up.output);
        await until(() => { return sink.active(); });
        const probe = await amqp.connect(url);
        try {
            const channel = await probe.createChannel();
            await until(async () => { return (await channel.checkQueue(queue)).consumerCount === 1; });
            await sink.write([{ exchange, routingKey: 'record', body: 'recovered' }]);
            await until(() => { return received.length >= 3; });
            await pause(200);
            assert.deepEqual(received, ['first', 'second', 'recovered']);
            assert.equal((await channel.checkQueue(queue)).consumerCount, 1);
        } finally { await probe.close(); }
    });
    it('rejects a mandatory unroutable publication despite the broker confirm', async function() {
        this.timeout(10000);
        const sender = amqpSink(url, { exchanges: [{ name: 'mandatory.integration', type: 'direct', options: { durable: false } }] });
        await sender.start();
        try {
            await assert.rejects(sender.write([{
                exchange: 'mandatory.integration', routingKey: 'no-such-queue', body: 'event',
                options: { mandatory: true, persistent: true, messageId: 'original-event' }
            }]), (error) => { return error.code === 'AMQP_UNROUTABLE'; });
            assert.equal(sender.active(), true, 'a deterministic return need not retire the connection');
        } finally { await sender.stop(); }
    });

    it('keeps one exclusive consumer and retries its head before later deliveries', async function() {
        this.timeout(60000);
        const queue=`exclusive.${Date.now()}`;
        const exchange='exclusive.integration';
        const exchanges=[{name:exchange,type:'direct',options:{durable:true}}];
        const bindings=[{exchange,pattern:'record'}];
        let release;
        const gate=new Promise(resolve=>{release=resolve;});
        const received=[];
        let rejected=false;
        let accepted=false;
        const first=amqpSource(url,queue,{accept:async()=>{accepted=true;await gate;}},{exclusive:true,prefetch:1,exchanges,bindings,onError:()=>{}});
        const second=amqpSource(url,queue,{accept:async delivery=>{
            const body=delivery.content.toString();
            received.push(body);
            if(body==='first'&&!rejected){rejected=true;throw new Error('transient fixture failure');}
        }},{exclusive:true,prefetch:1,exchanges,bindings,onError:()=>{}});
        const publisher=amqpSink(url,{exchanges});
        let result;
        try {
            await first.start();
            await publisher.start();
            await publisher.write(['first','second'].map(body=>{return {exchange,routingKey:'record',body,options:{persistent:true}}}));
            await until(()=>{return accepted;});
            await second.start();
            await pause(100);
            const premature=received.length;
            const stopped=first.stop();
            release();
            await stopped;
            await until(()=>{return received.length===3;});
            result={premature,received};
        } finally {
            release();
            await Promise.all([first.stop(),second.stop(),publisher.stop()]);
        }
        assert.deepEqual(result,{premature:0,received:['first','first','second']},'Consumers overlapped or redelivery was overtaken');
    });

    it('replays SQLite pending recipients after restart and retains mandatory returns until routing recovers', async function() {
        this.timeout(30000);
        const directory=await mkdtemp(path.join(os.tmpdir(),'sqlite-rabbit-'));
        const connection=await amqp.connect(url); const channel=await connection.createChannel();
        const exchange='sqlite.spool'; const queue='sqlite.spool.queue';
        const exchanges=[{name:exchange,type:'direct',options:{durable:true}}];
        await channel.assertExchange(exchange,'direct',{durable:true}); await channel.assertQueue(queue,{durable:true});
        await channel.bindQueue(queue,exchange,'record');
        let online=false; let first; let second; let third;
        const options={maxBytes:100000,writeTimeoutMs:2000,factory(spec) {
            return amqpSink(spec.id==='late'&&!online?'amqp://127.0.0.1:1':url,{...spec.options,retryMs:100,onError() {}});
        }};
        try {
            first=deliveryQueue(directory,options); await first.open();
            const event={eventId:'original',exchange,routingKey:'record',body:Buffer.from('frozen')};
            const recipients=['good','late'].map(id=>{return {id,type:'amqp',url:{$secret:id},options:{exchanges}};});
            await first.accept(event,recipients); assert.deepEqual(await first.drain(),{delivered:1,failed:1});
            assert.equal(first.status().pending,1); await first.close(); online=true;
            second=deliveryQueue(directory,options); await second.open();
            assert.deepEqual(await second.drain(),{delivered:1,failed:0}); assert.equal(second.status().pending,0);
            const messages=[await channel.get(queue,{noAck:true}),await channel.get(queue,{noAck:true})];
            assert.equal(await channel.get(queue,{noAck:true}),false);
            assert.deepEqual(messages.map(item=>{return [item.content.toString(),item.properties.messageId];}),[['frozen','original'],['frozen','original']]);
            await second.accept({...event,eventId:'unroutable',routingKey:'missing'},[recipients[0]]);
            assert.deepEqual(await second.drain(),{delivered:0,failed:1}); assert.equal(second.status().pending,1); await second.close();
            await channel.bindQueue(queue,exchange,'missing'); third=deliveryQueue(directory,options); await third.open();
            assert.deepEqual(await third.drain(),{delivered:1,failed:0});
            const recovered=await channel.get(queue,{noAck:true}); assert.equal(recovered.properties.messageId,'unroutable');
            assert.equal(recovered.content.toString(),'frozen'); assert.equal(third.status().pending,0);
        } finally {
            await first?.close(); await second?.close(); await third?.close();
            await connection.close(); await rm(directory,{recursive:true,force:true});
        }
    });

});
