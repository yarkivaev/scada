import { modbusSource } from '@yarkivaev/source-to-sink';

const layout = [
    { offset: 0, channel: 'AI1' },
    { offset: 3, channel: 'AI2' },
    { offset: 6, channel: 'AI3' },
    { offset: 9, channel: 'AI4' },
    { offset: 12, channel: 'AI5' }
];

/**
 * Decodes a CDAB-format float from two uint16 registers.
 *
 * @param {number} low - First uint16 register (low word)
 * @param {number} high - Second uint16 register (high word)
 * @returns {number} Decoded float32 value
 */
function decode(low, high) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint16(0, high);
    view.setUint16(2, low);
    return view.getFloat32(0);
}

/**
 * Transformer that maps MX210 register blocks to metrics sink records.
 *
 * @param {string} device - Device name in topic path
 * @param {object} collector - Collector with accept(record)
 * @returns {object} Transformer with accept(registers)
 */
export function mx210Metrics(device, collector) {
    return {
        accept(registers) {
            const ts = Date.now();
            for (const entry of layout) {
                collector.accept({
                    topic: `MX210/${device}/GET/${entry.channel}/VALUE`,
                    ts,
                    value: decode(registers[entry.offset], registers[entry.offset + 1])
                });
            }
        }
    };
}

/**
 * Owen MX210 TCP stream descriptor for central silent-stream Modbus backup.
 *
 * Opens a Modbus poll that writes ClickHouse metrics records (topic, ts, value),
 * not MQTT publish envelopes.
 *
 * @example
 *   const stream = mx210Tcp('icht-1', '192.168.2.148', 502);
 *   const poll = stream.open(collector, clock, 5);
 *   poll.start();
 *
 * @param {string} name - Stream id (device name in MX210 topics)
 * @param {string} host - Modbus TCP host
 * @param {number} port - Modbus TCP port
 * @returns {object} Stream with name() and open(collector, clock, interval)
 */
export default function mx210Tcp(name, host, port) {
    return Object.freeze({
        name() {
            return name;
        },
        open(collector, clk, interval) {
            return modbusSource(
                host,
                port,
                4000,
                14,
                interval,
                mx210Metrics(name, collector),
                clk
            );
        }
    });
}
