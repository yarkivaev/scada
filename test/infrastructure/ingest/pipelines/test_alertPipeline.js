import assert from 'node:assert/strict';
import alertPipeline from '../../../../src/infrastructure/ingest/pipelines/alertPipeline.js';
import alertCodec from '../../../../src/infrastructure/ingest/codecs/alertCodec.js';

describe('alertPipeline translations', function() {
    it('defaults to empty translations so rule names stay as messages', async function() {
        const received = [];
        const codec = alertCodec({
            async accept(row) {
                received.push(row);
            }
        }, {});
        const name = `rule_${Math.random().toString(36).slice(2)}`;
        await codec.accept({
            destination: '/exchange/scada.alerts',
            payload: JSON.stringify({
                name,
                machine: 'm1',
                severity: 'warning',
                status: 'pending',
                start: 1700000000
            })
        });
        assert.equal(received[0].message, name, 'empty translations did not fall back to rule name');
    });

    it('exposes alertPipeline factory for stomp and pool wiring', function() {
        assert.equal(typeof alertPipeline, 'function', 'alertPipeline export was missing');
    });
});
