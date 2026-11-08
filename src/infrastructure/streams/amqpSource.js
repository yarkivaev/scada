/* eslint-disable no-await-in-loop */
import amqpSession from './amqpSource/session.js';
import budgetAccept from './budgetAccept.js';

function capacity(options) {
    const settings = { prefetch: 32, maxMessageBytes: 1048576, ...options };
    settings.maxPendingBytes ??= settings.prefetch * settings.maxMessageBytes;
    ['prefetch', 'maxMessageBytes', 'maxPendingBytes'].forEach((name) => {
        if (!Number.isSafeInteger(settings[name]) || settings[name] < 1) { throw new TypeError(`${name} must be a positive safe integer`); }
    });
    return settings;
}

function deliveryFor(channel, message, options) {
    let settled = false;
    return {
        content: message.content, fields: message.fields, properties: message.properties,
        active() {return !settled && options.active();},
        ack() {
            if (!settled && options.active()) { channel.ack(message); settled = true; }
        },
        reject(requeue = true) {
            if (!settled && options.active()) { channel.nack(message, false, requeue); settled = true; }
        }
    };
}
function reportFailure(options, error) {
    const report = options.onError || options.report;
    try {
        if (report) { report(error); }
        else { process.stderr.write(`amqp delivery failed ${error.message}\n`); }
    } catch {
        // Error reporting must not reject a broker callback.
    }
}
function rejectDelivery(delivery, options, error) {
    try { delivery.reject(true); }
    catch (settlementError) { reportFailure(options, settlementError); }
    reportFailure(options, error);
}
function consume(channel, collector, options) {
    return async (message) => {
        if (!message) { channel.emit('close'); return; }
        const delivery = deliveryFor(channel, message, options);
        try {
            await budgetAccept(collector, delivery, message.content.length, options);
            if (options.ackMode !== 'manual') { delivery.ack(); }
        } catch (error) {
            rejectDelivery(delivery, options, error);
        }
    };
}
async function rejectCapacity(channel,message,options) {
    reportFailure(options,new Error(options.preserveOnCapacity ? 'AMQP payload capacity exceeded; retained for retry' : 'AMQP payload capacity exceeded; rejected without requeue'));
    if (options.preserveOnCapacity) {
        // Never NACK a canonical head into the ready queue behind later data.
        while(options.active()) {await new Promise((resolve) => {setTimeout(resolve,250);});}
        return;
    }
    try {channel.nack(message,false,false);}
    catch(error) {reportFailure(options,error);}
}
function trackedConsume(channel, collector, options, pending) {
    const accept = consume(channel, collector, options);
    const state = { bytes: 0 };
    return (message) => {
        if (!options.active()) { return Promise.resolve(); }
        const bytes = message?.content?.length ?? 0;
        if (bytes > options.maxMessageBytes || state.bytes + bytes > options.maxPendingBytes) {
            return rejectCapacity(channel,message,options);
        }
        state.bytes += bytes;
        const delivery = accept(message);
        pending.add(delivery);
        return delivery.finally(() => { state.bytes -= bytes; pending.delete(delivery); });
    };
}
async function topology(channel, queue, options) {
    await Promise.all((options.exchanges || []).map((exchange) => {
        return channel.assertExchange(exchange.name, exchange.type, exchange.options);
    }));
    const declared = await channel.assertQueue(queue, options.queueOptions || { durable: true });
    const name = declared?.queue || queue;
    await Promise.all((options.bindings || []).map((binding) => {
        return channel.bindQueue(name, binding.exchange, binding.pattern, binding.args);
    }));
    await channel.prefetch(options.prefetch || 32);
    return name;
}
/** Delivers AMQP records, acknowledging only after collector acceptance. */
export default function amqpSource(url, queue, collector, options = {}) {
    if (!collector || typeof collector.accept !== 'function') { throw new Error('Collector must have an accept() method'); }
    const settings = capacity(options);
    if (![undefined, true, false].includes(settings.exclusive)) { throw new TypeError('AMQP exclusive must be boolean'); }
    const pending = new Set();
    const state = {};
    const session = amqpSession(url, async (channel) => {
        const generation = state.session.generation();
        const live = {closed:false};
        channel.on('close',() => {live.closed=true;});
        channel.on('error',() => {live.closed=true;});
        const config = { ...settings, active() {
            return !live.closed && state.session.active() && state.session.generation() === generation;
        } };
        const name = await topology(channel, queue, settings);
        const result = await channel.consume(name, trackedConsume(channel, collector, config, pending), { noAck: false, ...(settings.exclusive ? { exclusive: true } : {}) });
        return result.consumerTag;
    }, { ...settings, drain() { return Promise.all([...pending]); } });
    state.session = session;
    return session;
}
