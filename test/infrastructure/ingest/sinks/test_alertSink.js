import assert from 'assert';
import alertSink from '../../../../src/infrastructure/ingest/sinks/alertSink.js';

function fakePool() {
    const queries = [];
    return {
        queries,
        query(sql, params) {
            queries.push({ sql, params });
            return Promise.resolve({ rows: [] });
        },
        end() {
            return Promise.resolve();
        }
    };
}

describe('alertSink', function() {
    it('inserts on pending status', async function() {
        const pool = fakePool();
        const sink = alertSink(pool);
        const name = `rule_${Math.random()}`;
        const machine = `ичт${Math.random()}`;
        const message = `сообщение_${Math.random()}`;
        const severity = `severity_${Math.random()}`;
        const timestamp = new Date(1700000000 * 1000 + Math.floor(Math.random() * 100000000)).toISOString();
        await sink.accept({ name, message, machine, severity, status: 'pending', timestamp });
        assert.deepStrictEqual(pool.queries[0].params, [name, message, machine, severity, timestamp], 'pending alert was not inserted with correct params');
    });

    it('updates on completed status', async function() {
        const pool = fakePool();
        const sink = alertSink(pool);
        const name = `rule_${Math.random()}`;
        const machine = `ичт${Math.random()}`;
        await sink.accept({ name, message: 'тест', machine, severity: 'warning', status: 'completed', timestamp: new Date().toISOString() });
        assert.deepStrictEqual(pool.queries[0].params, [name, machine], 'completed alert was not updated with correct params');
    });

    it('does not query on unknown status', async function() {
        const pool = fakePool();
        const sink = alertSink(pool);
        await sink.accept({ name: 'test', message: 'тест', machine: 'icht2', severity: 'warning', status: `unknown_${Math.random()}`, timestamp: new Date().toISOString() });
        assert.strictEqual(pool.queries.length, 0, 'unexpected query on unknown status');
    });
});

describe('alertSink propagates query failure', function() {
    it('rejects when pending insert fails', async function() {
        const pool = {
            query() { return Promise.reject(new Error('alert insert failed')); }
        };
        const sink = alertSink(pool);
        await assert.rejects(
            () => {
                return sink.accept({
                    name: `rule_${Math.random()}`,
                    message: 'тест',
                    machine: `icht${Math.random()}`,
                    severity: 'warning',
                    status: 'pending',
                    timestamp: new Date().toISOString()
                });
            },
            /alert insert failed/u,
            'Should propagate insert failure'
        );
    });

    it('rejects when acknowledge update fails', async function() {
        const pool = {
            query() { return Promise.reject(new Error('alert update failed')); }
        };
        const sink = alertSink(pool);
        await assert.rejects(
            () => {
                return sink.accept({
                    name: 'low_cosphi',
                    machine: `icht${Math.random()}`,
                    status: 'completed'
                });
            },
            /alert update failed/u,
            'Should propagate update failure'
        );
    });
});
