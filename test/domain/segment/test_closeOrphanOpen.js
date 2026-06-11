import assert from 'assert';
import closeOrphanOpen from '../../../src/infrastructure/ingest/sinks/closeOrphanOpen.js';

function fakePool() {
    const queries = [];
    return {
        queries,
        query(sql, params) {
            queries.push({ sql, params });
            return Promise.resolve();
        }
    };
}

describe('closeOrphanOpen', function() {
    it('executes exactly one query per close call', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        await closer.close(`ičt-${Math.random()}`, '2024-01-01T00:00:00.000Z');
        assert.strictEqual(pool.queries.length, 1, 'close call must execute one query');
    });

    it('updates only open rows for the target machine', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        await closer.close(`ičt-${Math.random()}`, '2024-01-01T00:00:00.000Z');
        assert.ok(pool.queries[0].sql.includes('duration = 0'), 'close query must target open rows only');
    });

    it('keeps the current open segment start_time untouched', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        const start = '2024-03-01T12:00:00.000Z';
        await closer.close(`ičt-${Math.random()}`, start);
        assert.ok(pool.queries[0].sql.includes('start_time <> $2'), 'close query must exclude current start_time');
    });

    it('binds machine and start_time as query parameters', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        const machine = `ičt-${Math.random()}`;
        const start = '2024-03-01T12:00:00.000Z';
        await closer.close(machine, start);
        assert.deepStrictEqual(pool.queries[0].params, [machine, start], 'close query must bind machine and start_time');
    });

    it('throws when pool is missing', function() {
        assert.throws(
            () => { closeOrphanOpen(null); },
            /Pool must have a query\(\) method/u,
            'missing pool was not rejected'
        );
    });
});
