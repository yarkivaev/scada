import { contourBody, contourKey } from '../../domain/contour/contourSegment.js';
import { contourRead } from '../persistence/pg/contourSegments.js';
import stompSend from '../streams/stompSend.js';
import amqpSink from '../streams/amqpSink.js';

/**
 * Publishes one page of stored edge segments.
 * The cursor advances only after the page is accepted, so a dropped publish is retried.
 *
 * {{{
 * const page = await contourOnce(pool, send, cursor);
 * }}}
 */

/** Sends one page and returns the cursor of its last row. */
export async function contourOnce(pool, send, cursor) {
    const rows = await contourRead(pool, cursor);
    if (rows.length === 0) { return { cursor, count: 0 }; }
    await send(rows.map((row) => { return contourBody(row); }));
    return { cursor: contourKey(rows.at(-1)), count: rows.length };
}

/** Publishes each body to the segment outbox the central shovel already drains. */
export function contourSend(url, destination, options) {
    return function send(bodies) {
        return bodies.reduce((chain, body) => {
            return chain.then(() => { return stompSend(url, destination, body, options); });
        }, Promise.resolve());
    };
}

/** Publishes each body to the admitted queue the segments-to-central shovel already drains. */
export function contourAmqp(url, queue) {
    const sink = amqpSink(url);
    const opened = sink.start();
    return function send(bodies) {
        const records = bodies.map((body) => {
            return { exchange: '', routingKey: queue, body: JSON.stringify(body) };
        });
        return opened.then(() => { return sink.write(records); });
    };
}
