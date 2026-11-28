import assert from 'node:assert/strict';
import * as scada from '@yarkivaev/scada';

const coordinated = { create_table_query: 'CREATE TABLE scada.metrics', comment: 'scada.local-history:stateful-correction-v1' };

function clickhouse(table, command = async () => {}) {
    return {
        async query({ query }) {
            const rows = query.includes('system.tables') ? [table] : [];
            return { async json() { return rows; } };
        },
        command
    };
}

describe('ClickHouse local history', function () {
    it('rejects autonomous raw-table TTL before registering history', async function () {
        const storage = clickhouse({ ...coordinated, create_table_query: 'CREATE TABLE scada.metrics TTL ts + INTERVAL 1 DAY' });
        const pool = { async query() { assert.fail('PostgreSQL must stay untouched when raw-table ownership is unsafe'); } };
        const history = scada.clickhouseLocalHistory(storage, pool);
        await assert.rejects(history.configure('machine-7', []), /coordinated retention/u);
    });

    it('commits its durable retention floor before requesting raw deletion', async function () {
        const mutations = [];
        function result(rows = [], rowCount = rows.length) { return { rows, rowCount }; }
        const pool = {
            async connect() {
                return {
                    async query(sql, values) {
                        if (sql.startsWith('SELECT least')) { return result([{ fence: '123456789' }]); }
                        if (sql.startsWith('INSERT INTO history_retention')) {
                            mutations.push(values[1]);
                            return result([{ retained_from: '123456790' }]);
                        }
                        if (sql === 'COMMIT') { mutations.push('committed'); }
                        if (sql.startsWith('WITH ranked')) { return result([], 2); }
                        return result();
                    },
                    release() {}
                };
            }
        };
        const storage = clickhouse(coordinated, async ({ query_params: params }) => {
            assert.deepEqual(mutations, [123456789, 'committed']);
            assert.equal(params.fence, 123456790);
            mutations.push('pruned');
        });
        const history = scada.clickhouseLocalHistory(storage, pool);
        assert.deepEqual(await history.purge(), { retainedFrom: 123456790, checkpointsRemoved: 2 });
        assert.deepEqual(mutations, [123456789, 'committed', 'pruned', 'committed']);
    });
});
