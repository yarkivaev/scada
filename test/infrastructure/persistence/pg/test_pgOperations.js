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

describe('pgOperations get', function() {
    it('selects by machine and key', async function() {
        const queries = [];
        const machineId = `icht${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `ключ-${Math.random().toString(36).slice(2)}`;
        const pool = {
            async query(sql, params) {
                queries.push({ sql, params });
                return {
                    rows: [{
                        machine: machineId,
                        occurred_at: new Date('2024-06-01T10:00:00.000Z'),
                        kind: 'chem',
                        key,
                        payload: { lot: 'β' }
                    }]
                };
            }
        };
        const store = operationStatePg(pool);
        await store.get(machineId, key);
        assert(
            queries[0].sql.includes('machine = $1')
            && queries[0].sql.includes('key = $2')
            && queries[0].params[0] === machineId
            && queries[0].params[1] === key,
            'get cannot skip machine-scoped key filter'
        );
    });

    it('rejects when select returns no rows', async function() {
        const pool = {
            async query() {
                return { rows: [] };
            }
        };
        const store = operationStatePg(pool);
        await assert.rejects(
            () => {
                return store.get(`icht${Math.random()}`, `missing-${Math.random()}`);
            },
            (err) => {
                return err instanceof Error;
            },
            'get cannot succeed for missing key'
        );
    });
});

describe('pgOperations remove', function() {
    it('deletes by machine and key with returning', async function() {
        const queries = [];
        const machineId = `icht${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `удал-${Math.random().toString(36).slice(2)}`;
        const pool = {
            async query(sql, params) {
                queries.push({ sql, params });
                return {
                    rows: [{
                        machine: machineId,
                        occurred_at: new Date('2024-06-01T10:00:00.000Z'),
                        kind: 'bath',
                        key,
                        payload: { action: 'load' }
                    }]
                };
            }
        };
        const store = operationStatePg(pool);
        await store.remove(machineId, key);
        assert(
            queries[0].sql.includes('DELETE FROM operations')
            && queries[0].sql.includes('RETURNING')
            && queries[0].params[0] === machineId
            && queries[0].params[1] === key,
            'remove cannot omit machine-scoped DELETE'
        );
    });

    it('rejects when delete returns no rows', async function() {
        const pool = {
            async query() {
                return { rows: [] };
            }
        };
        const store = operationStatePg(pool);
        await assert.rejects(
            () => {
                return store.remove(`icht${Math.random()}`, `missing-${Math.random()}`);
            },
            (err) => {
                return err instanceof Error;
            },
            'remove cannot succeed for missing key'
        );
    });
});
