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
        await sink.accept({ machine: 'm-ñ', startTime: '2024-01-01T00:00:00.000Z',
            username: 'op1', decidedAt: '2024-01-01T00:00:00.000Z', payload: '{}' });
        assert.strictEqual(pool.queries.length, 1, 'should execute one query');
    });

    it('uses INSERT INTO user_decisions statement', async function() {
        const pool = fakePool();
        const sink = userDecisionSink(pool);
        await sink.accept({ machine: 'm-ñ', startTime: '2024-01-01T00:00:00.000Z',
            username: 'op1', decidedAt: '2024-01-01T00:00:00.000Z', payload: '{}' });
        assert.ok(pool.queries[0].sql.includes('INSERT INTO user_decisions'), 'should use INSERT INTO user_decisions');
    });

    it('binds operator_id and decided_at in insert params', async function() {
        const pool = fakePool();
        const sink = userDecisionSink(pool);
        const operatorId = 4 + Math.floor(Math.random() * 100);
        const decidedAt = '2024-06-01T12:05:00.000Z';
        await sink.accept({
            machine: 'm-ñ',
            startTime: '2024-01-01T00:00:00.000Z',
            username: 'Elena Volkov',
            operatorId,
            decidedAt,
            payload: '{}'
        });
        assert.strictEqual(pool.queries[0].params[3], operatorId, 'operator_id was not bound in insert');
    });

    it('binds machine, startTime, username, payload as params in order', async function() {
        const pool = fakePool();
        const sink = userDecisionSink(pool);
        const machine = `ičt-${Math.random()}`;
        const startTime = `2024-0${Math.floor(Math.random() * 9) + 1}-01T00:00:00.000Z`;
        const username = `operator_${Math.random()}`;
        const payload = JSON.stringify({ tags: [`heating_${Math.random()}`] });
        await sink.accept({ machine, startTime, username, operatorId: 1, decidedAt: startTime, payload });
        const insert = pool.queries.find((query) => { return query.sql.includes('INSERT INTO user_decisions'); });
        assert.deepStrictEqual(
            insert.params,
            [machine, startTime, username, 1, startTime, payload],
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

describe('userDecisionSink segment state', function() {
    it('writes the decision tags onto the segment', async function() {
        const pool = fakePool();
        const tag = `ковш-${Math.random().toString(16).slice(2)}`;
        const sink = userDecisionSink(pool);
        await sink.accept({ machine: 'печь', startTime: '2026-10-21T12:23:59.167Z',
            username: 'оператор', decidedAt: '2026-10-21T12:24:00.000Z',
            payload: JSON.stringify({ tags: [tag], properties: { note: 'шлак' } }) });
        const update = pool.queries.find((query) => { return query.sql.includes('UPDATE segments'); });
        assert.equal(update.params[0], JSON.stringify([tag]), 'decision tags were not written onto the segment');
    });

    it('clears segment tags when the decision carries an empty tag list', async function() {
        const pool = fakePool();
        const sink = userDecisionSink(pool);
        await sink.accept({ machine: 'печь', startTime: '2026-10-19T06:52:04.487Z',
            username: 'оператор', decidedAt: '2026-10-19T06:53:00.000Z',
            payload: JSON.stringify({ tags: [], properties: {} }) });
        const update = pool.queries.find((query) => { return query.sql.includes('UPDATE segments'); });
        assert.equal(update.params[0], '[]', 'empty decision tags left the previous segment tag in place');
    });

    it('writes the split piece tag onto the segment', async function() {
        const tag = `приёмка-${Math.random().toString(16).slice(2)}`;
        const start = new Date(Date.UTC(2026, 10, 17, 7, 17, 9, 930));
        const end = new Date(start.getTime() + 60000);
        const queries = [];
        const client = {
            query(sql, params) { queries.push({ sql, params }); return Promise.resolve({ rows: [] }); },
            release() {}
        };
        const pool = {
            queries,
            query(sql, params) {
                queries.push({ sql, params });
                if (String(sql).includes('FROM segments')) {
                    return Promise.resolve({ rows: [{ name: 'off', start_time: start.toISOString(), end_time: end.toISOString(), duration: 60, properties: null }] });
                }
                return Promise.resolve({ rows: [] });
            },
            connect() { return Promise.resolve(client); }
        };
        const sink = userDecisionSink(pool);
        await sink.accept({ machine: 'печь', startTime: start.toISOString(), username: 'оператор',
            decidedAt: end.toISOString(),
            payload: JSON.stringify({ tags: [], splits: [{ start: start.getTime() / 1000, end: end.getTime() / 1000, tag }] }) });
        const painted = queries.some((query) => { return (query.params || []).includes(JSON.stringify([tag])); });
        assert.equal(painted, true, 'split decision left the piece tag off the segment');
    });
});

describe('userDecisionSink domain refusal', function() {
    it('keeps a closed off when a split tail stays open', async function() {
        const start = new Date(Date.UTC(2026, 10, 18, 13, 48, 46, 734));
        const closed = new Date(Date.UTC(2026, 10, 18, 15, 22, 0, 0));
        const tail = new Date(Date.UTC(2026, 10, 18, 16, 17, 12, 592));
        const queries = [];
        const pool = {
            queries,
            query(sql, params) {
                queries.push({ sql, params });
                if (String(sql).includes('FROM segments')) {
                    return Promise.resolve({
                        rows: [{
                            name: 'off',
                            start_time: start.toISOString(),
                            end_time: closed.toISOString(),
                            duration: (closed.getTime() - start.getTime()) / 1000,
                            properties: null
                        }]
                    });
                }
                return Promise.resolve({ rows: [] });
            }
        };
        const sink = userDecisionSink(pool);
        await sink.accept({
            machine: 'печь-1',
            startTime: start.toISOString(),
            username: 'Востриков Игорь',
            operatorId: 96,
            decidedAt: tail.toISOString(),
            payload: JSON.stringify({
                machine: 'печь-1',
                start: start.getTime() / 1000,
                user: 'Востриков Игорь',
                tags: [],
                splits: [
                    { start: start.getTime() / 1000, end: closed.getTime() / 1000, tag: 'analysis_wait' },
                    { start: closed.getTime() / 1000, end: tail.getTime() / 1000, tag: 'slag_skimming', open: true }
                ]
            })
        });
        const insert = queries.find((query) => { return String(query.sql).includes('INSERT INTO user_decisions'); });
        assert.ok(insert, 'a refused split still nacked the user_decisions message');
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
                    machine: `m${Math.random()}`,
                    startTime: new Date().toISOString(),
                    username: `operator_${Math.random()}`,
                    decidedAt: new Date().toISOString(),
                    payload: '{}'
                });
            },
            /decision insert failed/u,
            'Should propagate insert failure'
        );
    });
});
