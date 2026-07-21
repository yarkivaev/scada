import { clock } from '@yarkivaev/source-to-sink';

/**
 * Whether a stream is past the silence budget.
 *
 * @param {Map<string, number>} lastSeen - Stream id to last edge millis
 * @param {string} name - Stream id
 * @param {object} clk - Clock
 * @param {number} budgetMs - Silence budget in milliseconds
 * @returns {boolean} True when Modbus backup should run
 */
function isSilent(lastSeen, name, clk, budgetMs) {
    const at = lastSeen.get(name);
    if (at === undefined) {
        return true;
    }
    return clk.millis() - at >= budgetMs;
}

/**
 * Stops one active poll if present.
 *
 * @param {Map<string, object>} active - Active polls by name
 * @param {string} name - Stream id
 */
function stopOne(active, name) {
    const poll = active.get(name);
    if (!poll) {
        return;
    }
    poll.stop();
    active.delete(name);
}

/**
 * Starts one poll when not already active.
 *
 * @param {Map<string, object>} active - Active polls by name
 * @param {object} source - Stream source
 * @param {object} collector - Metrics collector
 * @param {object} clk - Clock
 * @param {number} intervalSec - Poll interval seconds
 */
function startOne(active, source, collector, clk, intervalSec) {
    const name = source.name();
    if (active.has(name)) {
        return;
    }
    const poll = source.open(collector, clk, intervalSec);
    active.set(name, poll);
    poll.start();
}

/**
 * Reconciles active polls with current silence state.
 *
 * @param {object} state - Gate mutable state
 */
function pulse(state) {
    if (!state.running || !state.collector) {
        return;
    }
    for (const source of state.sources) {
        const name = source.name();
        if (isSilent(state.lastSeen, name, state.clk, state.budgetMs)) {
            startOne(state.active, source, state.collector, state.clk, state.intervalSec);
        } else {
            stopOne(state.active, name);
        }
    }
}

/**
 * Builds mutable gate state from config.
 *
 * @param {object} config - silentStreams config
 * @returns {object} Mutable state bag
 */
function gateState(config) {
    const { budget, interval, sources } = config;
    return {
        budgetMs: budget * 1000,
        intervalSec: interval,
        sources,
        clk: config.clock || clock(),
        delay: config.delay || ((fn, ms) => {
            return setInterval(fn, ms);
        }),
        clear: config.clear || clearInterval,
        lastSeen: new Map(),
        active: new Map(),
        collector: undefined,
        timer: undefined,
        running: false
    };
}

/**
 * Polls configured Modbus streams only while their edge telemetry is silent.
 *
 * Edge freshness is reported via seen(name); Modbus writes go to the bound sink
 * and never count as seen. Streams never seen are treated as already silent.
 *
 * @example
 *   const streams = silentStreams({
 *     budget: 15,
 *     interval: 5,
 *     sources: [mx210Tcp('icht-1', '192.168.2.148', 502)]
 *   });
 *   streams.bind(clickhouseSink);
 *   streams.start();
 *
 * @param {object} config - budget (sec), interval (sec), sources, optional clock/delay/clear
 * @returns {object} Gate with seen, bind, start, stop, pulse
 */
export default function silentStreams(config) {
    const state = gateState(config);
    function runPulse() {
        pulse(state);
    }
    return {
        seen(name, at = state.clk.millis()) {
            state.lastSeen.set(name, at);
            if (state.running) {
                runPulse();
            }
        },
        bind(sink) {
            state.collector = {
                accept(record) {
                    sink.write([record]);
                }
            };
        },
        start() {
            state.running = true;
            runPulse();
            state.timer = state.delay(runPulse, state.intervalSec * 1000);
        },
        stop() {
            state.running = false;
            if (state.timer !== undefined) {
                state.clear(state.timer);
                state.timer = undefined;
            }
            for (const name of [...state.active.keys()]) {
                stopOne(state.active, name);
            }
        },
        pulse: runPulse
    };
}
