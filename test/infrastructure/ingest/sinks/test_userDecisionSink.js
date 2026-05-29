import assert from 'assert';
import userDecisionSink from '../../../../src/infrastructure/ingest/sinks/userDecisionSink.js';

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

describe('userDecisionSink', function() {
    it('executes exactly one INSERT per accept call', async function() {
        const pool = fakePool();
        const sink = userDecisionSink(pool);
        await sink.accept({ machine: 'ičt-ñ', startTime: '2024-01-01T00:00:00.000Z',
            username: 'оп1', payload: '{}' });
        assert.strictEqual(pool.queries.length, 1, 'should execute one query');
    });

    it('uses INSERT INTO user_decisions statement', async function() {
        const pool = fakePool();
        const sink = userDecisionSink(pool);
        await sink.accept({ machine: 'ičt-ñ', startTime: '2024-01-01T00:00:00.000Z',
            username: 'оп1', payload: '{}' });
        assert.ok(pool.queries[0].sql.includes('INSERT INTO user_decisions'), 'should use INSERT INTO user_decisions');
    });

    it('binds machine, startTime, username, payload as params in order', async function() {
        const pool = fakePool();
        const sink = userDecisionSink(pool);
        const machine = `ičt-${Math.random()}`;
        const startTime = `2024-0${Math.floor(Math.random() * 9) + 1}-01T00:00:00.000Z`;
        const username = `оператор_${Math.random()}`;
        const payload = JSON.stringify({ tags: [`нагрев_${Math.random()}`] });
        await sink.accept({ machine, startTime, username, payload });
        assert.deepStrictEqual(
            pool.queries[0].params,
            [machine, startTime, username, payload],
            'should bind params in correct order'
        );
    });

    it('throws when pool is missing', function() {
        assert.throws(
            () => { userDecisionSink(null); },
            /Pool must have a query\(\) method/u,
            'should reject missing pool'
        );
    });
});

describe('userDecisionSink propagates query failure', function() {
    it('rejects when insert fails', async function() {
        const pool = {
            query() { return Promise.reject(new Error('decision insert failed')); }
        };
        const sink = userDecisionSink(pool);
        await assert.rejects(
            () => {
                return sink.accept({
                    machine: `icht${Math.random()}`,
                    startTime: new Date().toISOString(),
                    username: `оператор_${Math.random()}`,
                    payload: '{}'
                });
            },
            /decision insert failed/u,
            'Should propagate insert failure'
        );
    });
});
