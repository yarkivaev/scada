import assert from 'assert';
import userDecisionsFromPg from '../../../../src/infrastructure/persistence/pg/userDecisions.js';

describe('userDecisionsFromPg', function() {
    it('queries user_decisions by machine and start_time ordered by decided_at', async function() {
        const machine = `icht-${Math.random()}`;
        const start = new Date(`2024-0${Math.floor(Math.random() * 9) + 1}-15T10:00:00.000Z`);
        const captured = [];
        const pool = {
            async query(sql, params) {
                captured.push({ sql, params });
                return { rows: [] };
            }
        };
        await userDecisionsFromPg(pool).list(machine, start);
        assert.ok(
            captured[0].sql.includes('FROM user_decisions')
                && captured[0].sql.includes('ORDER BY decided_at')
                && captured[0].params[0] === machine
                && captured[0].params[1] === start,
            'list query did not filter machine and start_time with decided_at order'
        );
    });

    it('maps username operator_id decided_at and payload from rows', async function() {
        const username = `оператор_${Math.random()}`;
        const operatorId = 3 + Math.floor(Math.random() * 80);
        const decidedAt = new Date('2024-07-01T08:15:00.000Z');
        const payload = JSON.stringify({ tags: [`нагрев_${Math.random()}`], user: username });
        const pool = {
            async query() {
                return {
                    rows: [{
                        username,
                        operator_id: operatorId,
                        decided_at: decidedAt,
                        payload
                    }]
                };
            }
        };
        const rows = await userDecisionsFromPg(pool).list('icht1', new Date('2024-07-01T08:00:00.000Z'));
        assert.deepStrictEqual(
            rows[0],
            { username, operatorId, decidedAt, payload },
            'pg user decisions port did not map audit columns'
        );
    });
});
