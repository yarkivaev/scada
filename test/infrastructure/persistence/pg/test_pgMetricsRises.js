import assert from 'assert';
import metricsStatePg from '../../../../src/infrastructure/persistence/pg/metrics.js';

describe('metricsStatePg risesForTopic', function() {
    it('queries a lag prefix of 0 to 1 edges', async function() {
        const topic = `OPCUA/tlc-${Math.random()}/GET/pipe_cast/VALUE`;
        const start = new Date('2026-09-30T00:00:00.000Z').toISOString();
        const end = new Date('2026-09-30T08:00:00.000Z').toISOString();
        let sql = '';
        const pool = {
            async query(text, params) {
                sql = text;
                void params;
                return { rows: [{ ts: new Date(start), value: 1 }] };
            }
        };
        await metricsStatePg(pool).risesForTopic(topic, start, end);
        assert.ok(
            sql.includes('LAG(value)') && sql.includes('prev = 0'),
            'rises query did not compute a lagged 0 to 1 prefix'
        );
    });
});
