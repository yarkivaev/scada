import { randomUUID } from 'node:crypto';
import modbusPublish from '../../infrastructure/ingest/mqtt/modbusPublish.js';

/** Preserve the telemetry wire contract while moving durable buffering ahead of the network. */
export default function modbusDelivery(spec, context, publish = modbusPublish) {
    if (spec.delivery !== 'spooled') { return publish(spec.url, spec.config); }
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
                // Retain each decoded observation durably before completing source acceptance.
                // eslint-disable-next-line no-await-in-loop
                await context.deliveryQueue.accept({ eventId: record.eventId ?? randomUUID(),
                    exchange: 'scada.telemetry', routingKey: record.topic.replaceAll('/', '.'), body: Buffer.from(record.payload) }, spec.sinks);
            }
        }
    };
    return publish(spec.url, { ...spec.config, size: 1, output });
}
