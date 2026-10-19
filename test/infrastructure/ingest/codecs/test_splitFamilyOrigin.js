import assert from 'assert';
import segmentCodec from '../../../../src/infrastructure/ingest/codecs/segmentCodec.js';

describe('split-family origin attack', function() {
    it('keeps origin as epoch milliseconds', async function() {
        const received = [];
        const codec = segmentCodec({
            accept(record) {
                received.push(record);
                return Promise.resolve();
            }
        });
        const origin = Date.parse('2026-10-19T06:02:18.137Z');
        await codec.accept({
            destination: '/exchange/scada.segments',
            payload: JSON.stringify({
                type: 'split-family',
                machine: 'ичт-π',
                origin,
                pieces: [{
                    name: 'off',
                    start: origin,
                    end: origin + 120000,
                    duration: 120,
                    tags: ['шлак'],
                    properties: { split_of: String(origin) }
                }]
            })
        });
        assert.strictEqual(received[0].origin, origin, 'split-family origin was scaled away from milliseconds');
    });

    it('keeps split_of as the millisecond string on the normalized piece', async function() {
        const received = [];
        const codec = segmentCodec({
            accept(record) {
                received.push(record);
                return Promise.resolve();
            }
        });
        const origin = Date.parse('2026-10-19T06:14:18.137Z');
        await codec.accept({
            destination: '/exchange/scada.segments',
            payload: JSON.stringify({
                type: 'split-family',
                machine: 'ичт-π',
                origin,
                pieces: [{
                    name: 'off',
                    start: origin,
                    end: origin + 180000,
                    duration: 180,
                    tags: ['шихта'],
                    properties: { split_of: String(origin) }
                }]
            })
        });
        assert.strictEqual(
            JSON.parse(received[0].pieces[0].properties).split_of,
            String(origin),
            'codec rewrote split_of away from the parent millis string'
        );
    });
});
