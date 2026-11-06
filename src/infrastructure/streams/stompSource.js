import stompit from 'stompit';
import follow from './follow.js';
import stompLifecycle from './stompLifecycle.js';
import deadline from './deadline.js';
import { acceptStomp, readStomp, stompSettings } from './stompBody.js';

/**
 * Idle state for STOMP source.
 *
 * @returns {object} State with subscribed() returning false
 */
function idle() {
  return {
    subscribed() {
      return false;
    }
  };
}

/**
 * Subscribed state for STOMP source.
 *
 * @param {object} channel - STOMP channel
 * @returns {object} State with subscribed() returning true
 */
function subscribed(channel, delivery) {
  return {
    subscribed() {
      return true;
    },
    channel() {
      return channel;
    },
    delivery
  };
}

/**
 * Builds STOMP server configuration from a URL.
 *
 * @param {URL} parsed - Parsed URL object
 * @param {object} options - Connection options
 * @returns {object} Server config for ConnectFailover
 */
function serverConfig(parsed, options) {
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 61613,
    connectHeaders: {
      host: options.host || parsed.hostname,
      login: options.login || '',
      passcode: options.passcode || ''
    }
  };
}

/**
 * Builds settle helpers for one STOMP frame.
 *
 * @param {object} channel - STOMP channel
 * @param {object} message - STOMP frame
 * @returns {{ ack: Function, nack: Function }}
 */
function settleOf(channel, message, lifecycle) {
  let settled = false;
  return {
    ack() {
      if (lifecycle.active && !settled) { channel.ack(message); settled = true; }
    },
    nack(requeue = true) {
      if (lifecycle.active && !settled) { channel.nack(message, { requeue: String(requeue) }); settled = true; }
    }
  };
}

/**
 * Delivers one STOMP body to the collector and settles the frame.
 *
 * @param {object} ctx - delivery context with channel/message/destination/collector/manualAck
 * @param {string} body - UTF-8 payload
 * @returns {Promise<void>}
 */
async function deliver(ctx, body) {
  const settle = settleOf(ctx.channel, ctx.message, ctx.lifecycle);
  try {
    await deadline(Promise.resolve().then(() => {
      return acceptStomp(ctx, body, settle);
    }), ctx.lifecycle.acceptTimeoutMs, 'STOMP acceptance', (error) => {
      ctx.lifecycle.fail(error);
    });
    if (!ctx.manualAck) {
      settle.ack();
    }
  } catch (error) {
    if (!ctx.manualAck) {
      settle.nack();
    }
    throw error;
  }
}

/**
 * Subscribes a channel and routes frames to the collector.
 * Arrivals stay in subscribe order through follow, even when persist overlaps.
 *
 * @param {object} channel - STOMP channel
 * @param {string} destination - queue destination
 * @param {object} collector - message collector
 * @param {object} delivery - serial, manualAck and prefetch settings
 * @returns {undefined}
 */
function bind(channel, destination, collector, delivery) {
  const { serial, manualAck, prefetch, lifecycle } = delivery;
  let pending = Promise.resolve();
  channel.subscribe({ destination, ack: 'client-individual', 'prefetch-count': String(prefetch) }, (err, message) => {
    if (err) {
      lifecycle.fail(err);
      return;
    }
    const ctx = { channel, message, destination, collector, manualAck, lifecycle };
    pending = follow(pending, () => {
      if (!lifecycle.active) { return Promise.reject(new Error('STOMP source stopped')); }
      return deadline(readStomp(message, lifecycle.maxMessageBytes), lifecycle.acceptTimeoutMs, 'STOMP read').catch((error) => {
        lifecycle.fail(error); throw error;
      });
    }, (body) => {
      const task = deliver(ctx, body);
      lifecycle.pending.add(task);
      return task.finally(() => { lifecycle.pending.delete(task); });
    }, serial, (error) => { lifecycle.report(error); });
    lifecycle.chain = pending;
    void pending.catch((error) => { lifecycle.report(error); });
  });
}

/**
 * STOMP subscription source for streaming messages to a collector.
 *
 * Messages are `{destination, payload, settle}`. Default ack-after-accept;
 * with `manualAck` the collector owns settle. Arrivals enqueue in
 * subscribe order. With `serial: false` persist may overlap after enqueue.
 * A finite prefetch (default 32) bounds unacknowledged broker deliveries.
 *
 * @param {string} url - STOMP broker URL
 * @param {string} destination - STOMP destination
 * @param {object} collector - Collector with accept()
 * @param {object} [options] - Connection and delivery options
 * @param {number} [options.prefetch=32] - Positive integer delivery window
 * @returns {object} Source with start() and stop() methods
 */
function watchConnection(failover, lifecycle) {
  failover.on('connect', () => { lifecycle.transition('running'); });
  failover.on('connecting', () => { lifecycle.transition(lifecycle.connected ? 'degraded' : 'starting'); });
  failover.on('error', (error) => { lifecycle.transition('degraded'); lifecycle.report(error); });
}

export default function stompSource(url, destination, collector, options = {}) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('URL must be a non-empty string');
  }
  if (typeof destination !== 'string' || destination.length === 0) {
    throw new Error('Destination must be a non-empty string');
  }
  if (!collector || typeof collector.accept !== 'function') {
    throw new Error('Collector must have an accept() method');
  }
  const prefetch = options.prefetch ?? 32;
  if (!Number.isSafeInteger(prefetch) || prefetch < 1) {
    throw new Error('prefetch must be a positive safe integer');
  }
  const settings = stompSettings(options, prefetch);
  const parsed = new URL(url);
  const serial = options.serial !== false;
  const manualAck = options.manualAck === true;
  let state = idle();
  return {
    start() {
      if (state.subscribed()) {
        if (state.delivery.fatal) { throw state.delivery.fatal; }
        return;
      }
      const failover = new stompit.ConnectFailover([serverConfig(parsed, options)], {
        initialReconnectDelay: 10,
        maxReconnectDelay: 30000,
        maxReconnects: -1
      });
      const channel = new stompit.Channel(failover);
      const lifecycle = stompLifecycle(settings, channel, destination);
      watchConnection(failover, lifecycle);
      bind(channel, destination, collector, { serial, manualAck, prefetch, lifecycle });
      state = subscribed(channel, lifecycle);
    },
    // Asynchronous downstream work uses the same fence as delivery deadlines.
    fail(error) { if (state.subscribed()) { state.delivery.fail(error); } },
    health() { return state.subscribed() ? state.delivery.health() : { state: 'idle', reason: null }; },
    stop() {
      if (!state.subscribed()) { return Promise.resolve(); }
      const stopped = state;
      stopped.delivery.halt();
      return deadline(Promise.allSettled([stopped.delivery.chain, ...stopped.delivery.pending]), options.stopTimeoutMs ?? 5000, 'STOMP stop').then(() => {
        if (stopped.delivery.fatal) { throw stopped.delivery.fatal; }
        if (state === stopped) { state = idle(); }
      });
    }
  };
}
