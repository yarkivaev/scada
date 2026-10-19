import assert from 'assert';
import abutSegments from '../../../../src/infrastructure/ingest/sinks/abutSegments.js';

describe('abutSegments', function() {
    it('extends a closed segment end to the next same-name start inside the budget', async function() {
        const queries = [];
        const pool = {
            query(sql, params) {
                queries.push({ sql, params });
                return Promise.resolve({ rowCount: 1 });
            }
        };
        const budget = 20 + Math.floor(Math.random() * 15);
        await abutSegments(pool, budget);
        const sql = queries[0].sql.replace(/\s+/gu, ' ');
        assert.ok(
            sql.includes('SET end_time = right_row.start_time') &&
                sql.includes('left_row.name = right_row.name') &&
                queries[0].params[0] === budget,
            'startup repair did not close gaps between continuous same-name segments'
        );
    });
});
