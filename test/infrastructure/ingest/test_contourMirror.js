import assert from 'node:assert/strict';
import { contourEpoch } from '../../../src/domain/contour/contourSegment.js';
import { contourOnce } from '../../../src/infrastructure/ingest/contourMirror.js';

describe('contour page publish', function() {
    it('does not advance past a page the broker refused', async function() {
        const tag = `шлак-${Math.random().toString(16).slice(2)}`;
        const stored = new Date(1700000000000);
        const pool = { query() {
            return Promise.resolve({ rows: [{ machine: 'печь', kind: 'phase', name: 'off', start_time: stored,
                end_time: stored, duration: 1, tags: JSON.stringify([tag]), properties: '{}', options: null,
                resolved: true, consumed: true, updated_at: stored }] });
        } };
        await assert.rejects(contourOnce(pool, () => { return Promise.reject(new Error('broker down')); }, contourEpoch()), /broker down/u);
    });

    it('publishes the stored tag before moving the cursor', async function() {
        const tag = `разливка-${Math.random().toString(16).slice(2)}`;
        const stored = new Date(1700001111000);
        const pool = { query() {
            return Promise.resolve({ rows: [{ machine: 'печь', kind: 'phase', name: 'off', start_time: stored,
                end_time: stored, duration: 2, tags: JSON.stringify([tag]), properties: '{}', options: null,
                resolved: true, consumed: true, updated_at: stored }] });
        } };
        let seen = [];
        const page = await contourOnce(pool, (bodies) => { seen = bodies; return Promise.resolve(); }, contourEpoch());
        assert.deepEqual([seen[0].tags, page.cursor.at.toISOString()], [[tag], stored.toISOString()], 'published page lost the stored tag or cursor');
    });
});
