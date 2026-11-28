import amqpSink from '../streams/amqpSink.js';
import operationEvent from './operationEvent.js';

const exchange = 'scada.operations';

/** Confirmed operation sync writes. No broker is required for a local-only operations port. */
export default function operationAmqp(url, options = {}) {
    const sink = url ? amqpSink(url, {
        ...options,
        exchanges: [{ name: exchange, type: 'topic', options: { durable: true } }]
    }) : null;
    return {
        active() { return Boolean(sink?.active()); },
        start() { return sink ? sink.start() : Promise.resolve(); },
        stop() { return sink ? sink.stop() : Promise.resolve(); },
        publish(item) {
            if (!sink) { return Promise.resolve(); }
            return sink.write([{
                exchange,
                routingKey: `${item.machine}.${item.key}`,
                body: Buffer.from(JSON.stringify(operationEvent(item))),
                options: { contentType: 'application/json', persistent: true }
            }]);
        }
    };
}
