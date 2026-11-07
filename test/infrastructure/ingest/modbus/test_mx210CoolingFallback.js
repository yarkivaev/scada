import assert from 'node:assert/strict';
import silentStreams from '../../../../src/infrastructure/ingest/modbus/silentStreams.js';
import mx210Tcp from '../../../../src/infrastructure/ingest/modbus/mx210Tcp.js';
import { acceptTelemetryDeliver } from '../../../../src/infrastructure/ingest/telemetry/amqpMetricsIngest.js';
import bindSilentStreams from '../../../../src/application/bindSilentStreams.js';
import fakeClock from '../../../helpers/fakeClock.js';

describe('MX210 fallback during cooling telemetry', function() {
    it('starts after electrical silence and stops only when MX210 resumes', function() {
        const clk = fakeClock(0);
        const started = [];
        const stopped = [];
        const rows = [];
        const device = 'device-1';
        const descriptor = mx210Tcp(device, '127.0.0.1', 502);
        const streams = silentStreams({
            budget: 15, interval: 5, clock: clk, delay: () => { return 0; }, clear() {},
            sources: [{
                name: descriptor.name,
                open(sink) {
                    return {
                        start() {
                            started.push(clk.millis());
                            sink.accept({ topic: `MX210/${device}/GET/AI1/VALUE`, ts: clk.millis(), value: 10 });
                        },
                        stop() { stopped.push(clk.millis()); }
                    };
                }
            }]
        });
        const onSeen = bindSilentStreams(streams, { write(records) { rows.push(...records); } });
        const codec = { accept() {} };
        const deliver = (family) => {
            acceptTelemetryDeliver(codec, { routingKey: `${family}.${device}.GET.AI1.VALUE` },
                Buffer.from(JSON.stringify({ ts: clk.millis(), value: 10 })), onSeen);
        };
        deliver('MX210');
        streams.start();
        try {
            for (let step = 1; step <= 6; step += 1) {
                clk.advance(5000);
                deliver('COOLING');
                streams.pulse();
                if (step < 3) { assert.equal(started.length, 0, 'must respect 15-second budget'); }
            }
            assert.deepEqual(started, [15000], 'cooling must not reset the MX210 silence timer');
            assert.equal(stopped.length, 0, 'cooling or fallback writes must not stop the backup');
            assert.equal(rows[0].topic, `MX210/${device}/GET/AI1/VALUE`, 'wire topic must stay unchanged');
            deliver('MX210');
            assert.deepEqual(stopped, [30000], 'electrical recovery must stop the backup');
            clk.advance(15000);
            deliver('COOLING');
            streams.pulse();
            assert.deepEqual(started, [15000, 45000], 'a second electrical outage must restart the backup');
        } finally { streams.stop(); }
    });
});
