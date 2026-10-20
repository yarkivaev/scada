import assert from 'assert';
import segmentCodec from '../../../../src/infrastructure/ingest/codecs/segmentCodec.js';

describe('split-family codec', function() {
    it('normalizes every piece and keeps the origin', async function() {
        const received = [];
        const codec = segmentCodec({
            accept(record) {
                received.push(record);
                return Promise.resolve();
            }
        });
        const origin = Date.parse('2026-10-19T06:02:18.000Z');
        await codec.accept({
            destination: '/exchange/scada.segments',
            payload: JSON.stringify({
                type: 'split-family',
                machine: 'ичт-2',
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
        assert.strictEqual(received[0].type, 'split-family', 'family type was lost');
        assert.strictEqual(received[0].pieces[0].name, 'off', 'piece was not kept off');
        assert.ok(received[0].pieces[0].properties.includes('split_of'), 'split_of was dropped');
    });
});
