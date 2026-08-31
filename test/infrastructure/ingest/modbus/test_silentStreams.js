import assert from 'assert';
import net from 'node:net';
import silentStreams from '../../../../src/infrastructure/ingest/modbus/silentStreams.js';
import mx210Tcp from '../../../../src/infrastructure/ingest/modbus/mx210Tcp.js';
import fakeClock from '../../../helpers/fakeClock.js';

/**
 * TCP listener that counts concurrent sockets on an ephemeral port.
 *
 * @returns {Promise<object>} Gate with port, live, peak, close
 */
function countingListen() {
    let live = 0;
    let peak = 0;
    const sockets = new Set();
    const server = net.createServer((sock) => {
        live += 1;
        if (live > peak) {
            peak = live;
        }
        sockets.add(sock);
        sock.on('close', () => {
            sockets.delete(sock);
            live -= 1;
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                live() {
                    return live;
                },
                peak() {
                    return peak;
                },
                close() {
                    for (const sock of sockets) {
                        sock.destroy();
                    }
                    return new Promise((done) => {
                        server.close(done);
                    });
                }
            });
        });
    });
}

/**
 * Resolves after the given delay.
 *
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise<void>} Timer promise
 */
function settle(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Waits until probe is true or the timeout elapses.
 *
 * @param {Function} probe - Condition
 * @param {number} limit - Timeout in milliseconds
 * @returns {Promise<void>} Resolves when probe holds
 */
function until(probe, limit) {
    const deadline = Date.now() + limit;
    function tick(resolve, reject) {
        if (probe()) {
            resolve();
            return;
        }
        if (Date.now() >= deadline) {
            reject(new Error('condition did not hold before timeout'));
            return;
        }
        setTimeout(() => {
            tick(resolve, reject);
        }, 20);
    }
    return new Promise(tick);
}

/**
 * No-op delay so tests drive reconcile via pulse() and fake clock.
 *
 * @returns {number} Dummy timer handle
 */
function idleDelay() {
    return 0;
}

/**
 * In-memory metrics sink.
 *
 * @returns {object} Sink with write(records)
 */
function memorySink() {
    const rows = [];
    return {
        rows,
        write(records) {
            rows.push(...records);
        }
    };
}

/**
 * Fake stream source that records start/stop.
 *
 * @param {string} label - Stream name
 * @param {Array<string>} started - Start log
 * @param {Array<string>} [stopped] - Stop log
 * @returns {object} Stream source
 */
function trackingSource(label, started, stopped = []) {
    return {
        name() {
            return label;
        },
        open() {
            return {
                start() {
                    started.push(label);
                },
                stop() {
                    stopped.push(label);
                }
            };
        }
    };
}

/**
 * Fake source that records each open() separately from start().
 *
 * @param {string} label - Stream name
 * @param {Array<string>} opened - Open log
 * @param {Array<string>} started - Start log
 * @param {Array<string>} stopped - Stop log
 * @returns {object} Stream source
 */
function openingSource(label, opened, started, stopped) {
    return {
        name() {
            return label;
        },
        open() {
            opened.push(label);
            return {
                start() {
                    started.push(label);
                },
                stop() {
                    stopped.push(label);
                }
            };
        }
    };
}

/**
 * Fake source that writes one metrics row on start via the collector.
 *
 * @param {string} label - Stream name
 * @param {Array<string>} started - Start log
 * @param {Array<string>} stopped - Stop log
 * @returns {object} Stream source
 */
function writingSource(label, started, stopped) {
    return {
        name() {
            return label;
        },
        open(collector) {
            return {
                start() {
                    started.push(label);
                    collector.accept({
                        topic: `MX210/${label}/GET/AI1/VALUE`,
                        ts: Date.now(),
                        value: Math.random() * 100
                    });
                },
                stop() {
                    stopped.push(label);
                }
            };
        }
    };
}

describe('silentStreams', function() {
    it('starts polling a stream that was never seen', function() {
        const label = `a-${Math.random().toString(36).slice(2)}`;
        const started = [];
        const clk = fakeClock(1000 + Math.floor(Math.random() * 1000));
        const budget = 3 + Math.floor(Math.random() * 5);
        const streams = silentStreams({
            budget,
            interval: 1 + Math.floor(Math.random() * 3),
            sources: [trackingSource(label, started)],
            clock: clk,
            delay: idleDelay
        });
        streams.bind(memorySink());
        streams.start();
        assert.deepStrictEqual(started, [label], 'silent stream was not polled without edge seen');
        streams.stop();
    });

    it('does not poll a stream seen within the silence budget', function() {
        const label = `b-${Math.random().toString(36).slice(2)}`;
        const started = [];
        const clk = fakeClock(5000);
        const budget = 10;
        const streams = silentStreams({
            budget,
            interval: 2,
            sources: [trackingSource(label, started)],
            clock: clk,
            delay: idleDelay
        });
        streams.bind(memorySink());
        streams.seen(label, clk.millis());
        streams.start();
        assert.deepStrictEqual(started, [], 'fresh edge stream was polled by silentStreams');
        streams.stop();
    });

    it('polls only the silent stream when a neighbour stays fresh', function() {
        const quiet = `q-${Math.random().toString(36).slice(2)}`;
        const live = `l-${Math.random().toString(36).slice(2)}`;
        const started = [];
        const clk = fakeClock(2000);
        const streams = silentStreams({
            budget: 8,
            interval: 2,
            sources: [trackingSource(quiet, started), trackingSource(live, started)],
            clock: clk,
            delay: idleDelay
        });
        streams.bind(memorySink());
        streams.seen(live, clk.millis());
        streams.start();
        assert.deepStrictEqual(started, [quiet], 'silentStreams did not poll only the quiet neighbour');
        streams.stop();
    });

    it('stops polling after edge seen resumes for that stream', function() {
        const label = `r-${Math.random().toString(36).slice(2)}`;
        const started = [];
        const stopped = [];
        const clk = fakeClock(1000);
        const streams = silentStreams({
            budget: 5,
            interval: 1,
            sources: [trackingSource(label, started, stopped)],
            clock: clk,
            delay: idleDelay
        });
        streams.bind(memorySink());
        streams.start();
        streams.seen(label, clk.millis());
        streams.pulse();
        assert.deepStrictEqual(stopped, [label], 'resumed edge stream kept central poll running');
        streams.stop();
    });

    it('keeps polling a silent neighbour after another stream resumes', function() {
        const quiet = `q-${Math.random().toString(36).slice(2)}`;
        const live = `l-${Math.random().toString(36).slice(2)}`;
        const started = [];
        const stopped = [];
        const clk = fakeClock(3000);
        const streams = silentStreams({
            budget: 6,
            interval: 1,
            sources: [
                trackingSource(quiet, started, stopped),
                trackingSource(live, started, stopped)
            ],
            clock: clk,
            delay: idleDelay
        });
        streams.bind(memorySink());
        streams.start();
        streams.seen(live, clk.millis());
        streams.pulse();
        assert.ok(
            started.includes(quiet) && !stopped.includes(quiet),
            'quiet neighbour poll was stopped when another stream resumed'
        );
        streams.stop();
    });

    it('does not treat sink writes as edge seen', function() {
        const label = `s-${Math.random().toString(36).slice(2)}`;
        const started = [];
        const stopped = [];
        const clk = fakeClock(4000);
        const streams = silentStreams({
            budget: 7,
            interval: 1,
            sources: [writingSource(label, started, stopped)],
            clock: clk,
            delay: idleDelay
        });
        streams.bind(memorySink());
        streams.start();
        streams.pulse();
        assert.deepStrictEqual(stopped, [], 'modbus sink write stopped central poll as if edge resumed');
        streams.stop();
    });

    it('stop ends every active poll', function() {
        const label = `t-${Math.random().toString(36).slice(2)}`;
        const started = [];
        const stopped = [];
        const clk = fakeClock(100);
        const streams = silentStreams({
            budget: 4,
            interval: 1,
            sources: [trackingSource(label, started, stopped)],
            clock: clk,
            delay: idleDelay
        });
        streams.bind(memorySink());
        streams.start();
        streams.stop();
        assert.deepStrictEqual(stopped, [label], 'stop did not end the active silent poll');
    });

    it('starts polling after the silence budget elapses since last seen', function() {
        const label = `u-${Math.random().toString(36).slice(2)}`;
        const started = [];
        const clk = fakeClock(10000);
        const budget = 5;
        const streams = silentStreams({
            budget,
            interval: 1,
            sources: [trackingSource(label, started)],
            clock: clk,
            delay: idleDelay
        });
        streams.bind(memorySink());
        streams.seen(label, clk.millis());
        streams.start();
        clk.advance(budget * 1000);
        streams.pulse();
        assert.deepStrictEqual(started, [label], 'stream was not polled after silence budget elapsed');
        streams.stop();
    });

    it('does not open a second poll when edge silence returns after seen', function() {
        const label = `v-${Math.random().toString(36).slice(2)}`;
        const opened = [];
        const started = [];
        const stopped = [];
        const clk = fakeClock(2000);
        const budget = 4;
        const streams = silentStreams({
            budget,
            interval: 1,
            sources: [openingSource(label, opened, started, stopped)],
            clock: clk,
            delay: idleDelay
        });
        streams.bind(memorySink());
        streams.start();
        streams.seen(label, clk.millis());
        streams.pulse();
        clk.advance(budget * 1000);
        streams.pulse();
        streams.stop();
        assert.strictEqual(opened.length, 1, 'silence after seen opened another Modbus poll');
    });

    it('does not hold a TCP socket after edge seen resumes', async function() {
        const gate = await countingListen();
        const label = `w-${Math.random().toString(36).slice(2)}`;
        const clk = fakeClock(3000);
        const streams = silentStreams({
            budget: 5,
            interval: 5,
            sources: [mx210Tcp(label, '127.0.0.1', gate.port)],
            clock: clk,
            delay: idleDelay
        });
        streams.bind(memorySink());
        streams.start();
        await until(() => {
            return gate.live() >= 1;
        }, 2000);
        streams.seen(label, clk.millis());
        streams.pulse();
        await until(() => {
            return gate.live() === 0;
        }, 2000);
        const live = gate.live();
        streams.stop();
        await gate.close();
        assert.strictEqual(live, 0, 'central poll kept a Modbus TCP socket after edge seen');
    });

    it('does not open a second TCP socket across seen and silence', async function() {
        const gate = await countingListen();
        const label = `x-${Math.random().toString(36).slice(2)}`;
        const clk = fakeClock(4000);
        const budget = 3;
        const streams = silentStreams({
            budget,
            interval: 5,
            sources: [mx210Tcp(label, '127.0.0.1', gate.port)],
            clock: clk,
            delay: idleDelay
        });
        streams.bind(memorySink());
        streams.start();
        await until(() => {
            return gate.live() >= 1;
        }, 2000);
        streams.seen(label, clk.millis());
        streams.pulse();
        await until(() => {
            return gate.live() === 0;
        }, 2000);
        clk.advance(budget * 1000);
        streams.pulse();
        await settle(300);
        const peak = gate.peak();
        streams.stop();
        await gate.close();
        assert.strictEqual(peak, 1, 'silence flicker opened a second Modbus TCP socket');
    });
});
