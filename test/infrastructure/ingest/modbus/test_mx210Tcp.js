import assert from 'assert';
import mx210Tcp, { mx210Metrics } from '../../../../src/infrastructure/ingest/modbus/mx210Tcp.js';

/**
 * Builds a 14-register MX210 block with a non-zero AI1 float (CDAB).
 *
 * @returns {Array<number>} Register values
 */
function registersWithAi1() {
    const registers = new Array(14).fill(0);
    registers[0] = 0x0000;
    registers[1] = 0x4120;
    return registers;
}

describe('mx210Tcp', function() {
    it('exposes the stream name from the constructor', function() {
        const suffix = Math.random().toString(36).slice(2);
        const name = `icht-${suffix}`;
        const stream = mx210Tcp(name, '127.0.0.1', 1502 + Math.floor(Math.random() * 100));
        assert.strictEqual(stream.name(), name, 'mx210Tcp did not keep the stream name');
    });

    it('decodes mx210 registers into an AI1 metrics topic', function() {
        const device = `dev-${Math.random().toString(36).slice(2)}`;
        const accepted = [];
        const collector = {
            accept(record) {
                accepted.push(record);
            }
        };
        mx210Metrics(device, collector).accept(registersWithAi1());
        assert.strictEqual(
            accepted[0].topic,
            `MX210/${device}/GET/AI1/VALUE`,
            'mx210 metrics topic was not produced for AI1'
        );
    });

    it('decodes mx210 registers into a numeric metrics value', function() {
        const device = `dev-${Math.random().toString(36).slice(2)}`;
        const accepted = [];
        const collector = {
            accept(record) {
                accepted.push(record);
            }
        };
        mx210Metrics(device, collector).accept(registersWithAi1());
        assert.strictEqual(typeof accepted[0].value, 'number', 'mx210 metrics value was not numeric');
    });

    it('emits five channel metrics from one register block', function() {
        const device = `dev-${Math.random().toString(36).slice(2)}`;
        const accepted = [];
        const collector = {
            accept(record) {
                accepted.push(record);
            }
        };
        mx210Metrics(device, collector).accept(registersWithAi1());
        assert.strictEqual(accepted.length, 5, 'mx210 metrics did not emit five channels');
    });
});
