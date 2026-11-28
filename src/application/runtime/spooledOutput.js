import { randomUUID } from 'node:crypto';

/** Persist wire observations without opening a broker connection in the source lifecycle. */
export default function spooledOutput(context, destinations) {
    if (!context.deliveryQueue) { throw new TypeError('Spooled output requires node deliveryQueue'); }
    return {
        start() { return Promise.resolve(); },
        stop() { return Promise.resolve(); },
        write(records) {
            return records.reduce((pending, record) => {
                return pending.then(async () => {
                    context.signal.throwIfAborted();
                    const eventId = record.eventId ?? randomUUID();
                    const payload = JSON.parse(Buffer.isBuffer(record.body) ? record.body.toString() : record.body);
                    const body = Buffer.from(JSON.stringify({ ...payload, eventId,
                        collectorId: context.nodeId ?? process.env.COLLECTOR_NODE_ID ?? 'local', taskId: context.taskId }));
                    await context.deliveryQueue.accept({ ...record, eventId, body }, destinations);
                    context.report?.({ state: 'running' });
                });
            }, Promise.resolve());
        }
    };
}
export function amqpDestinations(url, exchange) {
    return [{ id: exchange, type: 'amqp', url,
        options: { exchanges: [{ name: exchange, type: 'topic', options: { durable: true } }] } }];
}
