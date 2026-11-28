import assert from 'node:assert/strict';
import historySeed from '../../../../src/infrastructure/persistence/pg/historySeed.js';

describe('history seed scan', function() {
    it('bounds the carried-run scan to one gap before the page', async function() {
        const calls = [];
        const pool = { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } };
        await historySeed(pool, 'line-3', 1700000099000, 30000, { bounded: true });
        assert.deepEqual(calls[0].params, ['line-3', 1700000099000, 30000, 1700000069000], 'The seed scan walked the entire machine history');
    });
});
