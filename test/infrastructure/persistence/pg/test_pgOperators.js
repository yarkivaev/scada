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
                        first_name: 'Olga',
                        last_name: 'Smirnov',
                        display_name: 'Olga Smirnov'
                    }]
                };
            }
        };
        const rows = await operatorsFromPg(pool).list();
        assert.strictEqual(rows[0].cardUid, uid, 'pg operators port did not map card uid');
    });

    it('inserts operator and returns created domain record', async function() {
        const uid = `crt-${Math.random().toString(36).slice(2)}`.toUpperCase();
        const pool = {
            async query(sql, params) {
                assert.ok(sql.includes('INSERT INTO operators'), 'create must insert into operators');
                return {
                    rows: [{
                        id: 17,
                        card_uid: params[0],
                        first_name: params[1],
                        last_name: params[2],
                        display_name: params[3]
                    }]
                };
            }
        };
        const row = await operatorsFromPg(pool).create({
            cardUid: uid,
            firstName: 'Natalia',
            lastName: 'Orlov',
            displayName: 'Natalia Orlov'
        });
        assert.strictEqual(row.cardUid, uid, 'pg operators create did not return card uid');
    });

    it('throws conflict when card uid unique constraint fails', async function() {
        const uid = `uq-${Math.random().toString(36).slice(2)}`.toUpperCase();
        const pool = {
            async query() {
                const err = new Error('duplicate key value violates unique constraint');
                err.code = '23505';
                throw err;
            }
        };
        let caught;
        try {
            await operatorsFromPg(pool, { error() {} }).create({
                cardUid: uid,
                firstName: 'Boris',
                lastName: 'Gromov',
                displayName: 'Boris Gromov'
            });
        } catch (err) {
            caught = err;
        }
        assert.deepStrictEqual(
            { code: caught.routeCode, status: caught.routeStatus },
            { code: 'CONFLICT', status: 409 },
            'pg operators create did not map unique violation to conflict'
        );
    });

    it('reads registration enabled flag from operators_registration', async function() {
        const pool = {
            async query(sql) {
                assert.ok(
                    sql.includes('operators_registration'),
                    'enabled must query operators_registration'
                );
                return { rows: [{ enabled: true }] };
            }
        };
        const flag = await operatorsFromPg(pool).enabled();
        assert.strictEqual(flag, true, 'pg operators enabled did not return flag');
    });

    it('writes registration enabled flag to operators_registration', async function() {
        const pool = {
            async query(sql, params) {
                assert.ok(
                    sql.includes('operators_registration'),
                    'permit must update operators_registration'
                );
                return { rows: [{ enabled: params[0] }] };
            }
        };
        const flag = await operatorsFromPg(pool).permit(true);
        assert.strictEqual(flag, true, 'pg operators permit did not return updated flag');
    });
});
