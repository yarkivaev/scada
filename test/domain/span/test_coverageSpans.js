import assert from 'node:assert';
import coverageSpans from '../../../src/domain/span/coverageSpans.js';

describe('coverageSpans', function() {
    it('marks samples within the silence gap as present', function() {
        const from = '2024-11-02T03:04:05.137Z';
        const to = '2024-11-02T03:04:45.137Z';
        const spans = coverageSpans([
            from,
            '2024-11-02T03:04:25.137Z',
            to
        ], from, to, 30000, to);
        assert.deepStrictEqual(spans, [{
            from,
            status: 'present',
            to
        }], 'samples within the silence gap were not present');
    });

    it('marks a hole longer than silence as absent after the cursor passes it', function() {
        const from = '2024-11-02T03:04:05.137Z';
        const to = '2024-11-02T03:06:05.137Z';
        const spans = coverageSpans([from, to], from, to, 30000, to);
        assert.deepStrictEqual(spans, [{
            from,
            status: 'absent',
            to
        }], 'a hole longer than silence was not absent');
    });

    it('marks an empty cursor-covered window as absent', function() {
        const from = '2024-11-02T03:04:05.137Z';
        const to = '2024-11-02T03:06:05.137Z';
        const spans = coverageSpans([], from, to, 30000, to);
        assert.deepStrictEqual(spans, [{
            from,
            status: 'absent',
            to
        }], 'an empty cursor-covered window was not absent');
    });

    it('marks time after the ingest cursor as unknown', function() {
        const from = '2024-11-02T03:04:05.137Z';
        const to = '2024-11-02T03:06:05.137Z';
        const spans = coverageSpans([
            '2024-11-02T03:05:05.137Z'
        ], from, to, 30000, '2024-11-02T03:04:05.136Z');
        assert.deepStrictEqual(spans, [{
            from,
            status: 'unknown',
            to
        }], 'time after the ingest cursor was not unknown');
    });
});
