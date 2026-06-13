import assert from 'assert';
import operationStatePg from '../../../../src/infrastructure/persistence/pg/operations.js';

describe('pgOperations upsert', function() {
    it('uses key conflict target for idempotent write', async function() {
        const queries = [];
        const pool = {
            async query(sql, params) {
                queries.push({ sql, params });
                return { rows: [] };
            }
        };
        const store = operationStatePg(pool);
        const key = `id-${Math.random()}`;
        const occurred = new Date('2024-06-01T10:00:00.000Z');
        await store.upsert({
            machine: 'icht1',
            occurred_at: occurred,
            kind: 'chem',
            key,
            payload: { carbon: 0.1 }
        });
        const insert = queries.find((entry) => {
            return entry.sql.includes('INSERT INTO operations');
        });
        assert(insert.sql.includes('ON CONFLICT (key)'), 'upsert must target key');
    });
});

describe('pgOperations listForMachine', function() {
    it('filters by machine kind and occurred_at range', async function() {
        const queries = [];
        const pool = {
            async query(sql, params) {
                queries.push({ sql, params });
                return { rows: [] };
            }
        };
        const store = operationStatePg(pool);
        const from = new Date('2024-06-01T00:00:00.000Z');
        const to = new Date('2024-06-02T00:00:00.000Z');
        await store.listForMachine('icht1', 'chem', { from, to });
        assert(queries[0].sql.includes('machine = $1'), 'list must filter by machine');
        assert(queries[0].sql.includes('kind = $2'), 'list must filter by kind');
        assert(queries[0].sql.includes('occurred_at >='), 'list must filter by range start');
        assert(queries[0].sql.includes('occurred_at <='), 'list must filter by range end');
    });
});
