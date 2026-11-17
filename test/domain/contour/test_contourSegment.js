import assert from 'node:assert/strict';
import { contourBody, contourKey } from '../../../src/domain/contour/contourSegment.js';

describe('contour segment body', function() {
    it('keeps the operator tag stored on the edge row', function() {
        const tag = `приёмка-${Math.random().toString(16).slice(2)}`;
        const stored = new Date(Math.floor(Math.random() * 1e12));
        const body = contourBody({
            machine: 'печь', kind: 'phase', name: 'off', start_time: new Date(stored.getTime() - 1000),
            end_time: stored, duration: 1, tags: JSON.stringify([tag]), properties: '{"split_of":"1"}',
            options: null, resolved: true, consumed: true, updated_at: stored
        });
        assert.deepEqual(body.tags, [tag], 'edge operator tag was dropped from the contour body');
    });

    it('uses the stored update time as the cursor key', function() {
        const stored = new Date(1700000000000 + Math.floor(Math.random() * 1000));
        const key = contourKey({ updated_at: stored, machine: 'печь', kind: 'phase', start_time: stored });
        assert.equal(key.at.toISOString(), stored.toISOString(), 'contour cursor ignored the stored update time');
    });
});
