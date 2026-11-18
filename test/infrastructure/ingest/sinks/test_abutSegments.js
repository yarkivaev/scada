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
            sql.includes('SET end_time = next_row.next_start') &&
                sql.includes('lead(start_time) OVER') &&
                sql.includes('left_row.name = next_row.next_name') &&
                !sql.includes('LATERAL') &&
                queries[0].params[0] === budget,
            'startup repair did not stop at the immediate next segment inside the budget'
        );
    });

    it('deletes the next same-name row that overlaps or abuts inside the budget', async function() {
        const queries = [];
        const pool = {
            query(sql, params) {
                queries.push({ sql, params });
                return Promise.resolve({ rowCount: 1 });
            }
        };
        const budget = 20 + Math.floor(Math.random() * 15);
        await abutSegments(pool, budget);
        const sql = queries.map((item) => {
            return item.sql.replace(/\s+/gu, ' ');
        }).join(' ');
        assert.ok(
            sql.includes('DELETE FROM segments') &&
                sql.includes('lead(start_time) OVER') &&
                sql.includes('next_name') &&
                queries.some((item) => {
                    return item.params[0] === budget;
                }),
            'startup repair left overlapping same-name fragments in place'
        );
    });
});
