import assert from 'assert';
import retagSink from '../../../../src/infrastructure/ingest/sinks/retagSink.js';

function fakePool() {
    const queries = [];
    return {
        queries,
        query: (sql, params) => {
            queries.push({ sql, params });
            return Promise.resolve();
        }
    };
}

describe('retagSink', function() {
    it('executes exactly one query per accept call', async function() {
        const pool = fakePool();
        const sink = retagSink(pool);
        await sink.accept({ machine: 'm-ü', start_time: '2024-01-01T00:00:00.000Z',
            tags: '[]', properties: '{}', options: null, resolved: true });
        assert.strictEqual(pool.queries.length, 1, 'should execute one query');
    });

    it('uses UPDATE segments statement', async function() {
        const pool = fakePool();
        const sink = retagSink(pool);
        await sink.accept({ machine: 'm-ü', start_time: '2024-01-01T00:00:00.000Z',
            tags: '[]', properties: '{}', options: null, resolved: true });
        assert.ok(pool.queries[0].sql.includes('UPDATE segments'), 'should use UPDATE segments');
    });

    it('binds resolved as a query parameter', async function() {
        const pool = fakePool();
        const sink = retagSink(pool);
        await sink.accept({ machine: 'm-ü', start_time: '2024-01-01T00:00:00.000Z',
            tags: '[]', properties: '{}', options: null, resolved: true });
        assert.ok(pool.queries[0].sql.includes('resolved = $4'), 'should bind resolved column');
    });

    it('binds options as a query parameter', async function() {
        const pool = fakePool();
        const sink = retagSink(pool);
        await sink.accept({ machine: 'm-ü', start_time: '2024-01-01T00:00:00.000Z',
            tags: '[]', properties: '{}', options: null, resolved: true });
        assert.ok(pool.queries[0].sql.includes('options = $3'), 'should bind options column');
    });

    it('binds tags, properties, options, resolved, machine, start_time as params', async function() {
        const pool = fakePool();
        const sink = retagSink(pool);
        const tags = JSON.stringify([`heating_${Math.random()}`]);
        const properties = JSON.stringify({ batch: Math.floor(Math.random() * 1000) });
        await sink.accept({ machine: 'm-ñ', start_time: '2024-03-01T12:00:00.000Z', tags, properties,
            options: null, resolved: true });
        assert.deepStrictEqual(
            pool.queries[0].params,
            [tags, properties, null, true, 'm-ñ', '2024-03-01T12:00:00.000Z'],
            'should bind tags, properties, options, resolved, machine, start_time in order'
        );
    });

    it('defaults resolved to true when resolved is omitted', async function() {
        const pool = fakePool();
        const sink = retagSink(pool);
        await sink.accept({ machine: 'm1', start_time: '2024-01-01T00:00:00.000Z',
            tags: '[]', properties: '{}' });
        assert.strictEqual(pool.queries[0].params[3], true, 'should default resolved flag to true');
    });

    it('throws when pool is missing', function() {
        assert.throws(
            () => { retagSink(null); },
            /Pool must have a query\(\) method/u,
            'should reject missing pool'
        );
    });
});

describe('retagSink propagates pool failure', function() {
    it('rejects when pool query fails', async function() {
        const pool = {
            query() { return Promise.reject(new Error('retag query failed')); }
        };
        const sink = retagSink(pool);
        await assert.rejects(
            () => {
                return sink.accept({
                    machine: `m${Math.random()}`,
                    start_time: new Date().toISOString(),
                    tags: '["heating"]',
                    properties: '{}'
                });
            },
            /retag query failed/u,
            'Should propagate pool query failure'
        );
    });

    it('resolves when pool query succeeds', async function() {
        const queries = [];
        const pool = {
            query(sql, params) { queries.push({ sql, params }); return Promise.resolve(); }
        };
        const sink = retagSink(pool);
        await sink.accept({
            machine: `m${Math.random()}`,
            start_time: new Date().toISOString(),
            tags: '["heating"]',
            properties: '{}'
        });
        assert.strictEqual(queries.length, 1, 'Should execute one query on success');
    });
});
