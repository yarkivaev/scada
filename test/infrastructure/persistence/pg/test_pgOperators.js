import assert from 'assert';
import operatorsFromPg from '../../../../src/infrastructure/persistence/pg/operators.js';

describe('operatorsFromPg', function() {
    it('maps database rows to operator objects', async function() {
        const uid = `pg-${Math.random()}`;
        const pool = {
            async query() {
                return {
                    rows: [{
                        id: 5,
                        card_uid: uid,
                        first_name: 'Ольга',
                        last_name: 'Смирнова',
                        display_name: 'Ольга Смирнова'
                    }]
                };
            }
        };
        const rows = await operatorsFromPg(pool).list();
        assert.strictEqual(rows[0].cardUid, uid, 'pg operators port did not map card uid');
    });
});
