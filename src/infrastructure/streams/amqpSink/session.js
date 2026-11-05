import amqp from 'amqplib';
import brokerClose, { destroyConnection } from '../brokerClose.js';
import deadline from '../deadline.js';

export function report(state, error) {
    try { state.options.onError?.(error); } catch {
        // Diagnostics cannot break recovery.
    }
}
export function closeLive(live) {
    if (!live) { return Promise.resolve(); }
    live.closing ??= Promise.resolve().then(async () => {
        live.pending.forEach((settle) => { settle(new Error('AMQP connection closed before confirmation')); });
        await brokerClose([
            () => { return live.channel?.close(); }, () => { return live.connection?.close(); }
        ], live.options.stopTimeoutMs, 'AMQP close', () => { destroyConnection(live.connection); });
    });
    return live.closing;
}
function retry(state, epoch) {
    if (state.wanted && state.epoch === epoch && !state.retry) {
        state.retry = setTimeout(() => {
            state.retry = null;
            void state.reopen().catch((error) => { report(state, error); });
        }, state.options.retryMs);
    }
}
function drop(state, live, error) {
    if (live.dead) { return; }
    live.dead = true;
    live.pending.forEach((settle) => { settle(error || new Error('AMQP connection closed')); });
    if (state.live === live) { state.live = null; }
    if (error) { report(state, error); }
    void closeLive(live).then(() => { retry(state, live.epoch); }, (failure) => { state.fatal = failure; report(state, failure); });
}
function bind(state, live, handle) {
    handle.on('error', (error) => { drop(state, live, error); });
    handle.on('close', () => { drop(state, live); });
}
function returned(live, message) {
    const settle = live.returns.get(message.properties?.headers?.['x-source-to-sink-publish-id']);
    const error = new Error(`AMQP publication returned unroutable: ${message.fields?.replyText || 'NO_ROUTE'}`);
    error.code = 'AMQP_UNROUTABLE';
    if (settle) { settle(error); } else { live.fail(error); }
}
async function configure(state, live) {
    // This attempt owns live; stop closes it after opening settles and epoch is checked below.
    // eslint-disable-next-line require-atomic-updates
    live.channel = await live.connection.createConfirmChannel();
    bind(state, live, live.channel);
    live.channel.on('return', (message) => { returned(live, message); });
    live.channel.on('drain', () => { live.blocked = false; });
    await Promise.all((state.options.exchanges || []).map((item) => {
        return live.channel.assertExchange(item.name, item.type || 'topic', item.options || {durable: true});
    }));
}
async function current(state, live) {
    if (live.epoch !== state.epoch || !state.wanted) {
        await closeLive(live);
        return false;
    }
    return true;
}
function keep(state, live) {
    if (live.epoch !== state.epoch || !state.wanted) { return closeLive(live); }
    state.live = live;
    return undefined;
}
async function connect(state, epoch) {
    const live = { options: state.options, connection: null, channel: null, pending: new Set(), returns: new Map(), epoch, dead: false, blocked: false,
        fail(error) { drop(state, live, error); } };
    try {
        live.connection = await (state.options.connect || amqp.connect)(state.url, { timeout: state.options.connectTimeoutMs });
        bind(state, live, live.connection);
        if (!await current(state, live)) { return; }
        await configure(state, live);
        if (live.dead) { throw new Error('AMQP session closed during initialization'); }
        await keep(state, live);
    } catch (error) {
        await closeLive(live).catch((failure) => { state.fatal = failure; throw failure; });
        retry(state, epoch);
        throw error;
    }
}
function recover(state, timeout) {
    if (timeout && state.fatal === timeout) {
        state.fatal = null;
        retry(state, state.epoch);
    }
}
export function begin(state) {
    if (state.fatal) { return Promise.reject(state.fatal); }
    if (state.live) { return Promise.resolve(); }
    if (state.opening) { return state.opening; }
    if (!state.wanted) { return Promise.resolve(); }
    clearTimeout(state.retry);
    state.retry = null;
    let timeout;
    const attempt = connect(state, state.epoch);
    void attempt.then(() => { recover(state, timeout); }, () => { recover(state, timeout); });
    state.opening = deadline(attempt, state.options.connectTimeoutMs, 'AMQP connect', (error) => {
        timeout = error; state.fatal = error; state.epoch += 1;
    }).finally(() => { state.opening = null; });
    return state.opening;
}
