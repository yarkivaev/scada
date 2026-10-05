import amqp from 'amqplib';

function connectBroker(url) {
    return amqp.connect(url, { heartbeat: 10 });
}

function scheduleLater(fn, pause) {
    return setTimeout(fn, pause);
}

function clearLater(handle) {
    clearTimeout(handle);
}

function reportFailure(error) {
    process.stderr.write(`amqp consume failed ${error.message}\n`);
}

function nextDelay(delay) {
    return Math.min(delay * 2, 30000);
}

function blankState() {
    return {
        generation: 0,
        timer: undefined,
        stopping: false,
        delay: 1000,
        session: undefined
    };
}

function running(state) {
    return Boolean(state.session) || (state.generation > 0 && !state.stopping);
}

function scheduleRetry(ctx, generation) {
    if (ctx.state.stopping || generation !== ctx.state.generation) {
        return;
    }
    const pause = ctx.state.delay;
    ctx.state.delay = nextDelay(ctx.state.delay);
    ctx.state.timer = ctx.schedule(() => {
        ctx.state.timer = undefined;
        return ctx.open(generation);
    }, pause);
}

function bindClose(ctx, generation, live) {
    let dropped = false;
    function lose() {
        if (dropped || ctx.state.stopping || generation !== ctx.state.generation) {
            return;
        }
        dropped = true;
        if (ctx.state.session === live) {
            ctx.state.session = undefined;
        }
        scheduleRetry(ctx, generation);
    }
    live.connection.on('error', lose);
    live.connection.on('close', lose);
    live.channel.on('error', lose);
    live.channel.on('close', lose);
}

async function accept(ctx, generation, connection) {
    if (ctx.state.stopping || generation !== ctx.state.generation) {
        await connection.close();
        return null;
    }
    return connection.createChannel();
}

async function keep(ctx, generation, connection, channel, tag) {
    if (ctx.state.stopping || generation !== ctx.state.generation) {
        await channel.close();
        await connection.close();
        return false;
    }
    const live = { connection, channel, tag };
    ctx.state.session = live;
    ctx.state.delay = 1000;
    bindClose(ctx, generation, live);
    return true;
}

async function open(ctx, generation) {
    if (ctx.state.stopping || generation !== ctx.state.generation) {
        return;
    }
    try {
        const connection = await ctx.connect(ctx.url);
        const channel = await accept(ctx, generation, connection);
        if (!channel) {
            return;
        }
        const tag = await ctx.subscribe(channel);
        await keep(ctx, generation, connection, channel, tag);
    } catch (error) {
        ctx.report(error);
        scheduleRetry(ctx, generation);
    }
}

function begin(ctx) {
    if (running(ctx.state)) {
        return Promise.resolve();
    }
    ctx.state.stopping = false;
    ctx.state.generation += 1;
    ctx.state.delay = 1000;
    return open(ctx, ctx.state.generation);
}

async function end(ctx) {
    ctx.state.stopping = true;
    ctx.state.generation += 1;
    if (ctx.state.timer) {
        ctx.clear(ctx.state.timer);
        ctx.state.timer = undefined;
    }
    const live = ctx.state.session;
    ctx.state.session = undefined;
    if (!live) {
        return;
    }
    await live.channel.cancel(live.tag);
    await live.channel.close();
    await live.connection.close();
}

/**
 * Keeps one AMQP consumer subscribed across broker restarts.
 *
 * @param {string} url - RabbitMQ AMQP URL
 * @param {function} subscribe - async (channel) => consumerTag
 * @param {object} [options] - connect, schedule, clear, report overrides
 * @returns {object} session with start and stop
 *
 * @example
 *   const session = durableConsume('amqp://localhost', async (channel) => {
 *       const tag = await channel.consume('scada.telemetry.ingest', () => {});
 *       return tag.consumerTag;
 *   });
 *   await session.start();
 */
export default function durableConsume(url, subscribe, options = {}) {
    const ctx = {
        url,
        subscribe,
        connect: options.connect || connectBroker,
        schedule: options.schedule || scheduleLater,
        clear: options.clear || clearLater,
        report: options.report || reportFailure,
        state: blankState(),
        open(generation) {
            return open(ctx, generation);
        }
    };
    return {
        start() {
            return begin(ctx);
        },
        stop() {
            return end(ctx);
        }
    };
}
