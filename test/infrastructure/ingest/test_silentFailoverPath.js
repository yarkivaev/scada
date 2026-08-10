import assert from 'assert';
import { acceptTelemetryDeliver } from '../../../src/infrastructure/ingest/telemetry/amqpMetricsIngest.js';
import silentStreams from '../../../src/infrastructure/ingest/modbus/silentStreams.js';
import bindSilentStreams from '../../../src/application/bindSilentStreams.js';
import fakeClock from '../../helpers/fakeClock.js';

/**
 * Builds a silentStreams gate wired like site-server telemetry ingest.
 *
 * @param {string} device - Stream id
 * @param {Array<string>} started - Start log
 * @param {Array<string>} stopped - Stop log
 * @param {object} clk - Fake clock
 * @param {number} budget - Silence budget seconds
 * @returns {object} Gate and onSeen callback
 */
function wiredGate(device, started, stopped, clk, budget) {
    const streams = silentStreams({
        budget,
        interval: 1,
        sources: [{
            name() {
                return device;
            },
            open() {
                return {
                    start() {
                        started.push(device);
                    },
                    stop() {
                        stopped.push(device);
                    }
                };
            }
        }],
        clock: clk,
        delay() {
            return 0;
        }
    });
    const onSeen = bindSilentStreams(streams, { write() {} });
    return { streams, onSeen };
}

describe('silent failover path', function() {
    it('does not poll while edge telemetry stays fresh', function() {
        const device = `m-${Math.random().toString(36).slice(2)}`;
        const started = [];
        const stopped = [];
        const clk = fakeClock(1000 + Math.floor(Math.random() * 500));
        const budget = 4 + Math.floor(Math.random() * 3);
        const { streams, onSeen } = wiredGate(device, started, stopped, clk, budget);
        acceptTelemetryDeliver(
            { accept() {} },
            { routingKey: `MX210.${device}.GET.AI1.VALUE` },
            Buffer.from(JSON.stringify({ value: Math.random() })),
            onSeen
        );
        streams.start();
        assert.deepStrictEqual(started, [], 'failover polled while edge telemetry was fresh');
        streams.stop();
    });

    it('polls after edge telemetry silence exceeds the budget', function() {
        const device = `m-${Math.random().toString(36).slice(2)}`;
        const started = [];
        const stopped = [];
        const clk = fakeClock(2000);
        const budget = 5;
        const { streams, onSeen } = wiredGate(device, started, stopped, clk, budget);
        acceptTelemetryDeliver(
            { accept() {} },
            { routingKey: `MX210.${device}.GET.AI1.VALUE` },
            Buffer.from(JSON.stringify({ value: Math.random() })),
            onSeen
        );
        streams.start();
        clk.advance(budget * 1000);
        streams.pulse();
        assert.deepStrictEqual(started, [device], 'failover did not poll after edge silence');
        streams.stop();
    });

    it('stops polling when edge telemetry resumes', function() {
        const device = `m-${Math.random().toString(36).slice(2)}`;
        const started = [];
        const stopped = [];
        const clk = fakeClock(3000);
        const budget = 3;
        const { streams, onSeen } = wiredGate(device, started, stopped, clk, budget);
        streams.start();
        clk.advance(budget * 1000);
        streams.pulse();
        acceptTelemetryDeliver(
            { accept() {} },
            { routingKey: `MX210.${device}.GET.AI2.VALUE` },
            Buffer.from(JSON.stringify({ value: Math.random() })),
            onSeen
        );
        assert.deepStrictEqual(stopped, [device], 'failover kept polling after edge telemetry resumed');
        streams.stop();
    });
});
