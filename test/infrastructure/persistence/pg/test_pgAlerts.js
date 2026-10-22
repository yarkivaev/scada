import assert from 'assert';
import pgAlerts from '../../../../src/infrastructure/persistence/pg/alerts.js';

describe('pgAlerts list', function() {
    it('reads persisted rows for a machine and time window', async function() {
        const machine = `ихт-γ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const from = new Date('2024-11-02T03:04:05.137Z');
        const to = new Date('2024-11-03T03:04:05.137Z');
        const name = `низкий-cosφ-${Math.floor(Math.random() * 90)}`;
        const seen = [];
        const pool = {
            async query(sql, params) {
                seen.push({ params, sql: String(sql) });
                return {
                    rows: [{
                        acknowledged: true,
                        machine,
                        message: 'низкий cos φ',
                        name,
                        timestamp: from
                    }]
                };
            }
        };
        const rows = await pgAlerts(pool).list({ from, machine, to });
        assert.deepStrictEqual({
            machine: seen[0].params.includes(machine),
            name: rows[0].name,
            range: seen[0].sql.includes('timestamp')
        }, { machine: true, name, range: true }, 'pgAlerts missed persisted rows in the window');
    });
});
