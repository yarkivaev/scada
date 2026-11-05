// Each session is mutated only by its generation; disposal waits for subscription.
/* eslint-disable require-atomic-updates */
import brokerClose, { destroyConnection } from '../brokerClose.js';
import deadline from '../deadline.js';
import positive from '../positive.js';

async function connectBroker(url, options) {
    const { default: amqp } = await import('amqplib');
    return amqp.connect(url, { heartbeat: 10, ...options });
}
function reportFailure(error) {
    process.stderr.write(`amqp consume failed ${error.message}\n`);
}
async function closeLive(live, ctx) {
    try {
        await brokerClose([
            () => { return live.tag ? live.channel.cancel(live.tag) : undefined; },
            () => { return ctx.drain?.(live.channel); },
            () => { return live.channel?.close(); },
            () => { return live.connection?.close(); }
        ], ctx.stopTimeoutMs, 'AMQP cleanup', () => { destroyConnection(live.connection); });
    } catch (error) { ctx.state.fatal = error; throw error; }
}
function dispose(live, ctx) {
    if (!live) { return Promise.resolve(); }
    if (!live.closing) { live.closing = closeLive(live, ctx); }
    return live.closing;
}

function current(ctx, generation) {
    return !ctx.state.fatal && ctx.state.running && ctx.state.generation === generation;
}
function retry(ctx, generation) {
    if (!current(ctx, generation) || ctx.state.timer !== undefined) { return; }
    const pause = ctx.state.delay;
    ctx.state.delay = Math.min(pause * 2, 30000);
    ctx.state.timer = ctx.schedule(() => {
        ctx.state.timer = undefined;
        ctx.state.opening = ctx.attempt(generation);
        void ctx.state.opening.catch(ctx.report);
        return ctx.state.opening;
    }, pause);
}
function bind(ctx, generation, live, emitter) {
    function lost(error) {
        if (live.lost || !current(ctx, generation)) { return; }
        live.lost = true;
        if (error) { ctx.report(error); }
        ctx.state.cleanup = live.ready.then(() => { return dispose(live, ctx); }).then(() => { retry(ctx, generation); });
        void ctx.state.cleanup.catch(ctx.report);
    }
    emitter.on('error', lost);
    emitter.on('close', lost);
}
async function subscribe(ctx, generation, live) {
    if (!current(ctx, generation) || live.lost) { return; }
    live.channel = await live.connection.createChannel();
    bind(ctx, generation, live, live.channel);
    if (!current(ctx, generation) || live.lost) { return; }
    live.tag = await ctx.subscribe(live.channel);
}
async function open(ctx, generation) {
    let complete;
    const live = { closed: false, ready: new Promise((resolve) => { complete = resolve; }) };
    try {
        live.connection = await ctx.connect(ctx.url, { timeout: ctx.connectTimeoutMs });
        bind(ctx, generation, live, live.connection);
        await subscribe(ctx, generation, live);
        if (!current(ctx, generation) || live.lost) { await dispose(live, ctx); return; }
        ctx.state.live = live;
        ctx.state.delay = 1000;
    } catch (error) {
        ctx.report(error);
        await dispose(live, ctx);
        retry(ctx, generation);
    } finally { complete(); }
}
function recover(ctx, timeout) {
    if (timeout && ctx.state.fatal === timeout) {
        ctx.state.fatal = undefined;
        retry(ctx, ctx.state.generation);
    }
}
function attempt(ctx, generation) {
    let timeout;
    const opening = ctx.open(generation);
    void opening.then(() => { recover(ctx, timeout); }, () => { recover(ctx, timeout); });
    return deadline(opening, ctx.connectTimeoutMs, 'AMQP connect', (error) => {
        timeout = error; ctx.state.fatal = error; ctx.state.generation += 1;
    });
}
async function begin(ctx) {
    if (ctx.state.fatal) { throw ctx.state.fatal; }
    if (ctx.state.running) { await ctx.state.opening; return; }
    ctx.state.running = true;
    ctx.state.generation += 1;
    const { generation } = ctx.state;
    await ctx.state.stopping;
    await ctx.state.cleanup;
    if (current(ctx, generation)) {
        ctx.state.opening = attempt(ctx, generation);
        await ctx.state.opening;
    }
}
async function end(ctx) {
    ctx.state.running = false;
    ctx.state.generation += 1;
    if (ctx.state.timer !== undefined) { ctx.clear(ctx.state.timer); ctx.state.timer = undefined; }
    await ctx.state.opening;
    await ctx.state.cleanup;
    await dispose(ctx.state.live, ctx);
    ctx.state.live = undefined;
}
/** Shared AMQP session lifecycle; subscribe returns a consumer tag. */
export default function amqpSession(url, subscribeChannel, options = {}) {
    positive(options.stopTimeoutMs ?? 5000, 'stopTimeoutMs');
    positive(options.connectTimeoutMs ?? 5000, 'connectTimeoutMs');
    const ctx = {
        stopTimeoutMs: options.stopTimeoutMs ?? 5000, connectTimeoutMs: options.connectTimeoutMs ?? 5000,
        url, subscribe: subscribeChannel, drain: options.drain,
        connect: options.connect || connectBroker,
        schedule: options.schedule || setTimeout,
        clear: options.clear || clearTimeout,
        report: options.onError || options.report || reportFailure,
        state: { generation: 0, running: false, delay: 1000 },
        open(generation) { return open(ctx, generation); },
        attempt(generation) { return attempt(ctx, generation); }
    };
    return {
        start() { return begin(ctx); },
        stop() {
            ctx.state.stopping = end(ctx);
            return ctx.state.stopping;
        },
        generation() { return ctx.state.generation; },
        active() { return !ctx.state.fatal && ctx.state.running; }
    };
}
