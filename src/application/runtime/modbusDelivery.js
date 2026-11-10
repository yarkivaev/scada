import { randomUUID } from 'node:crypto';
import modbusPublish from '../../infrastructure/ingest/mqtt/modbusPublish.js';

function runtimeConfig(spec,context) {
    return {...spec.config,onFatal(error) {
        context.report?.({state:'failed',fatal:true,reason:error.code??error.name});
        spec.config.onFatal?.(error);
    }};
}

/** Preserve the telemetry wire contract while moving durable buffering ahead of the network. */
export default function modbusDelivery(spec, context, publish = modbusPublish) {
    const config=runtimeConfig(spec,context);
    if (spec.delivery !== 'spooled') { return publish(spec.url, config); }
    if (!context.deliveryQueue || !spec.sinks?.length || spec.sinks.some((sink) => { return sink.type !== 'amqp'; })) {
        throw new TypeError('Spooled Modbus requires node queue and AMQP destinations');
    }
    const output = {
        start() { return Promise.resolve(); },
        stop() { return Promise.resolve(); },
        async write(records) {
            context.signal?.throwIfAborted();
            context.report?.({ state: 'running', read: 1 });
            for (const record of records) {
                const routingKey = record.topic.replaceAll('/', '.');
                const destinations = spec.sinks.filter((sink) => { return !sink.routingKeyPrefix || routingKey.startsWith(sink.routingKeyPrefix); });
                if (!destinations.length) { throw new Error('No matching Modbus telemetry recipient'); }
                // Retain each decoded observation durably before completing source acceptance.
                // eslint-disable-next-line no-await-in-loop
                await context.deliveryQueue.accept({ eventId: record.eventId ?? randomUUID(),
                    exchange: 'scada.telemetry', routingKey, body: Buffer.from(record.payload) }, destinations);
            }
        }
    };
    return publish(spec.url, { ...config, size: 1, output });
}
