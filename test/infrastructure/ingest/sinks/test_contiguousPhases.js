import assert from 'node:assert/strict';
import contiguousPhases, { phaseAnchors } from '../../../../src/infrastructure/ingest/sinks/contiguousPhases.js';
import closeSilentOpen from '../../../../src/infrastructure/ingest/sinks/closeSilentOpen.js';

const origin = '2026-11-26T14:10:12.840Z';

describe('contiguous phase configuration', function () {
    it('requires a certified UTC origin for each protected machine', function () {
        assert.deepEqual(phaseAnchors(undefined), new Map());
        assert.deepEqual(phaseAnchors(JSON.stringify({ cm8: origin })), new Map([['cm8', origin]]));
        assert.throws(() => {return phaseAnchors('{"cm8":"2026-11-26"}')}, /Invalid contiguous phase anchor/u);
    });

    it('keeps unrelated dispatch routing and refuses a geometry-changing split on a protected track', async function () {
        const calls = [];
        const existing = { accept(row, client) { calls.push([row, client]); } };
        const route = contiguousPhases({}, phaseAnchors(JSON.stringify({ cm8: origin })), existing);
        await route.accept({ type: 'segment', machine: 'furnace' }, 'client');
        await route.accept({ type: 'retag', machine: 'cm8' }, 'client');
        assert.equal(calls.length, 2);
        await route.accept({ type: 'split', machine: 'cm8' });
        assert.equal(calls.length, 2);
        assert.throws(() => { return route.accept({ type: 'split-family', machine: 'cm8' }); }, { permanent: true });
    });

    it('does not manufacture a close for the protected current tail on consumer silence', async function () {
        const calls = [];
        const pool = { query(query, args) { calls.push([query, args]); } };
        await closeSilentOpen(pool, ['cm8']).close(30);
        assert.match(calls[0][0], /NOT \(machine = ANY\(\$2::text\[\]\)\)/u);
        assert.deepEqual(calls[0][1], [30, ['cm8']]);
    });
});
