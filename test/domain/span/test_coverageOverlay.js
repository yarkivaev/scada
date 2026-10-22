import assert from 'node:assert';
import coverageOverlay from '../../../src/domain/span/coverageOverlay.js';

describe('coverageOverlay', function() {
    it('splits a span on overlapping timeline names', function() {
        const from = '2024-11-02T03:04:05.137Z';
        const mid = '2024-11-02T03:04:25.137Z';
        const to = '2024-11-02T03:04:45.137Z';
        const first = `шлак-α-${Math.floor(Math.random() * 90)}`;
        const second = `простой-β-${Math.floor(Math.random() * 90)}`;
        const spans = coverageOverlay([{
            from,
            status: 'present',
            to
        }], [
            { end_time: mid, name: first, start_time: from },
            { end_time: to, name: second, start_time: mid }
        ]);
        assert.deepStrictEqual(spans, [
            { from, phase: first, status: 'present', to: mid },
            { from: mid, phase: second, status: 'present', to }
        ], 'overlapping timeline names were not painted onto coverage spans');
    });
});
