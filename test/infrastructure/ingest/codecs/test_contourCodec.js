import assert from 'node:assert/strict';
import { decodeSegment } from '../../../../src/infrastructure/ingest/codecs/segmentCodec.js';
import { contourGate } from '../../../../src/infrastructure/persistence/pg/contourSegments.js';

describe('contour ingest', function() {
    it('keeps the edge stored time instead of the receive time', function() {
        const stored = '2026-11-17T08:41:03.166Z';
        const record = decodeSegment({ payload: JSON.stringify({
            type: 'contour', machine: 'печь', name: 'off', kind: 'phase', start: 1700000000000, end: 1700000005000,
            duration: 5, tags: ['reception_delay'], properties: { split_of: '1794899829930' }, storedAt: stored
        }) });
        assert.equal(record.updated_at, stored, 'contour decode replaced the edge stored time');
    });

    it('writes the edge tags onto an existing central row', async function() {
        const tag = JSON.stringify([`ожидание-${Math.random().toString(16).slice(2)}`]);
        let sql = '';
        let params = [];
        const pool = { query(text, values) { sql = text; params = values; return Promise.resolve({ rowCount: 1 }); } };
        const route = contourGate({ accept() { return Promise.resolve(); } }, pool);
        await route.accept({ type: 'contour', machine: 'печь', kind: 'phase', name: 'off',
            start_time: '2026-11-17T07:17:09.930Z', end_time: '2026-11-17T08:40:05.979Z', duration: 5000,
            options: null, tags: tag, properties: '{"split_of":"1"}', resolved: true, consumed: true,
            updated_at: '2026-11-17T08:41:03.166Z' });
        assert.equal(sql.includes('tags = EXCLUDED.tags') && params.includes(tag), true, 'central contour apply left the edge tag off the row');
    });
});
