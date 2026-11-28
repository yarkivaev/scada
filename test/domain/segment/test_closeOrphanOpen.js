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
        await closer.close(`mást-${Math.random()}`, '2024-01-01T00:00:00.000Z');
        assert.strictEqual(pool.queries.length, 1, 'close call must execute one query');
    });

    it('updates only open rows for the target machine', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        await closer.close(`mást-${Math.random()}`, '2024-01-01T00:00:00.000Z');
        assert.ok(pool.queries[0].sql.includes('duration = 0'), 'close query must target open rows only');
    });

    it('keeps the current open segment start_time untouched', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        const start = '2024-03-01T12:00:00.000Z';
        await closer.close(`mást-${Math.random()}`, start);
        const sql = pool.queries[0].sql;
        assert.ok(
            sql.includes('start_time > $2') && sql.includes('start_time < $2'),
            'close query must exclude the incoming start_time'
        );
    });

    it('binds machine start_time phase kind and null name by default', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        const machine = `mást-${Math.random()}`;
        const start = '2024-03-01T12:00:00.000Z';
        await closer.close(machine, start);
        assert.deepStrictEqual(
            pool.queries[0].params,
            [machine, start, 'phase', null],
            'close query must bind machine start_time default phase kind and null name'
        );
    });

    it('scopes orphan close to the supplied kind', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        const machine = `cm${Math.floor(Math.random() * 90 + 10)}`;
        const start = '2024-03-01T12:00:00.000Z';
        const kind = `axis_${Math.random().toString(36).slice(2, 8)}`;
        await closer.close(machine, start, kind);
        assert.ok(pool.queries[0].sql.includes('kind = $3'), 'close query must filter by kind');
        assert.deepStrictEqual(
            pool.queries[0].params,
            [machine, start, kind, null],
            'close query must bind the supplied kind'
        );
    });

    it('does not collapse competing opens to a one-second ghost', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        await closer.close(`mást-${Math.random()}`, '2024-03-01T12:00:00.000Z', 'phase', null, 'off');
        assert.equal(
            pool.queries[0].sql.includes('interval \'1 second\'') || /duration\s*=\s*1\b/u.test(pool.queries[0].sql),
            false,
            'orphan close still stamps competing opens as one-second segments'
        );
    });

    it('drops nested later opens instead of leaving point segments', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        await closer.close(`mást-${Math.random()}`, '2024-03-01T12:00:00.000Z', 'phase', null, 'off');
        assert.ok(
            pool.queries[0].sql.includes('DELETE FROM segments') && pool.queries[0].sql.includes('start_time > $2'),
            'orphan close did not delete nested later opens'
        );
    });

    it('leaves a same-name covering open untouched', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        await closer.close(`mást-${Math.random()}`, '2024-03-01T12:00:00.000Z', 'phase', null, 'off');
        assert.ok(
            pool.queries[0].sql.includes('name IS DISTINCT FROM $4'),
            'orphan close still closes a same-name covering open'
        );
    });

    it('closes an earlier different-name open at the incoming start', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        await closer.close(`mást-${Math.random()}`, '2024-03-01T12:00:00.000Z', 'phase', null, 'on');
        assert.ok(
            pool.queries[0].sql.includes('end_time = $2::timestamptz') && pool.queries[0].sql.includes('start_time < $2'),
            'orphan close did not end the previous phase at the incoming start'
        );
    });

    it('binds the incoming segment name', async function() {
        const pool = fakePool();
        const closer = closeOrphanOpen(pool);
        const machine = `mást-${Math.random()}`;
        const start = '2024-03-01T12:00:00.000Z';
        const label = `off-${Math.random().toString(36).slice(2, 8)}`;
        await closer.close(machine, start, 'phase', null, label);
        assert.deepStrictEqual(
            pool.queries[0].params,
            [machine, start, 'phase', label],
            'close query did not bind the incoming name'
        );
    });

    it('throws when pool is missing', function() {
        assert.throws(
            () => { closeOrphanOpen(null); },
            /Pool must have a query\(\) method/u,
            'missing pool was not rejected'
        );
    });
});
