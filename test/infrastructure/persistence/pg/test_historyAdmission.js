import assert from 'node:assert/strict';
import historyAdmission from '../../../../src/infrastructure/persistence/pg/historyAdmission.js';

function pool(statements) {
    const client = {
        async query(sql, params = []) {
            statements.push({ sql, params });
            if (sql.includes('FROM history_topics')) {
                return { rowCount: 1, rows: [{
                    machine: 'см-α', topic: 'OPCUA/t/GET/x/VALUE', bucket_ms: 30000000,
                    retention_days: 30, retained_from: -9007199254740991
                }] };
            }
            if (sql.includes('FROM history_admissions') && sql.includes('event_id=ANY')) {
                const ids = params[0];
                return { rowCount: ids.length, rows: ids.map((id) => { return { event_id: id, admitted_at: 1700000000000000 }; }) };
            }
            return { rowCount: 0, rows: [] };
        },
        release() {}
    };
    return { connect: async () => { return client; }, query: client.query };
}

describe('history admission lease watermark', function() {
    it('advances the millisecond lead row from a microsecond ClickHouse admission', async function() {
        const statements = [];
        await historyAdmission(pool(statements), {
            timeScale: 1000, timestamp: (ts) => { return Number(ts); }
        }).complete([{ topic: 'OPCUA/t/GET/x/VALUE', ts: '1700000015000000', value: 1.25 }]);
        assert.deepEqual(statements.find((row) => { return /INSERT INTO history_observations/u.test(row.sql); })?.params,
            ['см-α', 'lead', 1700000015000, 'lead:см-α:1700000015000'],
            'admission did not stamp the lease lead in milliseconds');
    });
});
