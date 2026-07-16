import assert from 'assert';
import closeSilentOpen from '../../../../src/infrastructure/ingest/sinks/closeSilentOpen.js';

function fakePool() {
    const queries = [];
    return {
        queries,
        query(sql, params) {
            queries.push({ sql, params });
            return Promise.resolve({ rowCount: 0 });
        }
    };
}

describe('closeSilentOpen', function() {
    it('executes exactly one update per close call', async function() {
        const pool = fakePool();
        const closer = closeSilentOpen(pool);
        await closer.close(Math.floor(Math.random() * 40) + 2);
        assert.strictEqual(pool.queries.length, 1, 'silence close did not run one query');
    });

    it('updates only open rows older than the silence budget', async function() {
        const pool = fakePool();
        const closer = closeSilentOpen(pool);
        await closer.close(30);
        const sql = pool.queries[0].sql;
        assert.ok(
            sql.includes('duration = 0') && sql.includes('make_interval'),
            'silence close must target stale open rows only'
        );
    });

    it('does not insert a synthetic open segment', async function() {
        const pool = fakePool();
        const closer = closeSilentOpen(pool);
        await closer.close(30);
        assert.ok(
            !/insert/iu.test(pool.queries[0].sql),
            'silence close must not invent a new open row'
        );
    });

    it('binds the silence budget seconds as a query parameter', async function() {
        const pool = fakePool();
        const closer = closeSilentOpen(pool);
        const budget = Math.floor(Math.random() * 50) + 5;
        await closer.close(budget);
        assert.deepStrictEqual(pool.queries[0].params, [budget], 'silence budget was not bound');
    });

    it('sets duration from the last known end boundary', async function() {
        const pool = fakePool();
        const closer = closeSilentOpen(pool);
        await closer.close(30);
        assert.ok(
            pool.queries[0].sql.includes('EXTRACT(EPOCH FROM') &&
                pool.queries[0].sql.includes('end_time'),
            'silence close must derive duration from last known end'
        );
    });

    it('throws when pool is missing', function() {
        assert.throws(
            () => { closeSilentOpen(null); },
            /Pool must have a query\(\) method/u,
            'missing pool was not rejected'
        );
    });
});
