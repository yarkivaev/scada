import assert from 'assert';
import runRetention from '../../../../src/infrastructure/ingest/db/runRetention.js';

function fakePool() {
    const calls = [];
    return {
        calls,
        query(sql, params) {
            calls.push({ sql, params });
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
                return Promise.resolve({ rowCount: 0 });
            }
            if (sql.startsWith('VACUUM')) {
                return Promise.resolve({ rowCount: 0 });
            }
            return Promise.resolve({ rowCount: Math.floor(Math.random() * 9) + 1 });
        }
    };
}

describe('runRetention', function() {
    it('deletes closed segments only and vacuums tables after commit', async function() {
        const pool = fakePool();
        const days = Math.floor(Math.random() * 20) + 10;
        await runRetention(pool, days);
        const segmentDelete = pool.calls.find((item) => {
            return item.sql.includes('DELETE FROM segments');
        });
        assert.ok(
            segmentDelete.sql.includes('end_time > start_time'),
            'segments delete must skip open segments'
        );
        const vacuumCalls = pool.calls.filter((item) => {
            return item.sql.startsWith('VACUUM ANALYZE');
        });
        assert.strictEqual(vacuumCalls.length, 4, 'should vacuum all four tables');
    });
});
