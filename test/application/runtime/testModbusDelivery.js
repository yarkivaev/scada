import assert from 'node:assert/strict';
import modbusDelivery from '../../../src/application/runtime/modbusDelivery.js';
describe('Queued Modbus measurements', () => {
    it('routes decoded legacy telemetry to durable queue without MQTT connection', async () => {
        const queued = [];
        const context = { deliveryQueue: { async accept(event, recipients) { queued.push({ event, recipients }); } }, report() {} };
        const destinations = [{ id:'owner',type:'amqp',url:'amqp://owner' }];
        const pipeline = modbusDelivery({ delivery:'spooled',url:'mqtt://unused',config:{},sinks:destinations },context,(url,config) => {
            return { async start() { await config.output.write([{topic:'MX210/icht-1/GET/AI1/VALUE',payload:'{"ts":1,"value":4}'}]); } };
        });
        await pipeline.start();
        assert.equal(queued[0].event.routingKey,'MX210.icht-1.GET.AI1.VALUE');
        assert.equal(queued[0].event.body.toString(),'{"ts":1,"value":4}');
        assert.equal(typeof queued[0].event.eventId,'string');
        assert.deepEqual(queued[0].recipients,destinations);
    });
});
it('routes grouped serial bus observations only to each owning history receiver', async () => {
    const queued = [];
    const destinations = [1, 2].map((number) => { return { id: `icht${number}`, type: 'amqp', url: `amqp://icht${number}`, routingKeyPrefix: `COOLING.icht-${number}.` }; });
    const pipeline = modbusDelivery({ delivery: 'spooled', url: 'mqtt://unused', config: {}, sinks: destinations },
        { deliveryQueue: { async accept(event, recipients) { queued.push({ event, recipients }); } } }, (url, config) => {
            return { start() { return config.output.write([{ topic: 'COOLING/icht-2/GET/AI1/VALUE', payload: '{"ts":1,"value":4}' }]); } };
        });
    await pipeline.start();
    assert.deepEqual(queued[0].recipients.map((item) => { return item.id; }), ['icht2']);
});
