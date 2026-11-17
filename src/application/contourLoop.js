import { contourEpoch } from '../domain/contour/contourSegment.js';
import { contourAmqp, contourOnce, contourSend } from '../infrastructure/ingest/contourMirror.js';
import processingErrorLog from '../infrastructure/ingest/processingErrorLog.js';

/**
 * Republishes the edge segment table until central has every stored row.
 * A full pass repeats every ten minutes so a later tag-less heartbeat cannot stay ahead.
 *
 * {{{
 * contourLoop(pool, { STOMP_URL: 'stomp://rabbitmq:61613' });
 * }}}
 */

function pause(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function step(pool, send, state, now) {
    const due = now - state.sweep >= 600000;
    const cursor = due ? contourEpoch() : state.cursor;
    return contourOnce(pool, send, cursor).then((page) => {
        return { cursor: page.cursor, count: page.count, sweep: due ? now : state.sweep };
    });
}

function run(pool, send, state, clock) {
    return step(pool, send, state, clock()).then((next) => {
        return pause(next.count < 50 ? 5000 : 0).then(() => { return run(pool, send, next, clock); });
    }).catch((error) => {
        processingErrorLog('contour_mirror', error, { machine: state.cursor.machine });
        return pause(5000).then(() => { return run(pool, send, state, clock); });
    });
}

/** Starts the edge copy. The returned promise stays pending while the process runs. */
export default function contourLoop(pool, env, clock = Date.now) {
    const send = env.STOMP_URL
        ? contourSend(env.STOMP_URL, env.CONTOUR_STOMP_DESTINATION || '/queue/scada.segments.outbox', {
            login: env.STOMP_LOGIN || 'guest', passcode: env.STOMP_PASSCODE || 'guest', host: env.STOMP_HOST || '/'
        })
        : contourAmqp(env.HISTORY_AMQP_URL, env.CONTOUR_AMQP_QUEUE || env.SEGMENT_ADMIT_DESTINATION || 'scada.segments.admitted');
    return run(pool, send, { cursor: contourEpoch(), count: 0, sweep: 0 }, clock);
}
