import assert from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import migrate, { migratePrivileged } from '../../../../src/infrastructure/ingest/db/migrate.js';

function fakePool() {
    const calls = [];
    return {
        calls,
        query(sql, params) {
            calls.push({ sql, params });
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
                return Promise.resolve({ rowCount: 0 });
            }
            if (sql.includes('schema_migrations')) {
                return Promise.resolve({ rowCount: 0 });
            }
            return Promise.resolve({ rowCount: 0 });
        }
    };
}

describe('migratePrivileged', function() {
    it('applies C0002 revoke migration when connected as admin', async function() {
        const pool = fakePool();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sink-mig-'));
        const file = 'C0002__central_revoke_delete.sql';
        const sql = `REVOKE DELETE ON segments_${Math.random()} FROM supervisor_sink`;
        await fs.writeFile(path.join(dir, file), sql);
        await migratePrivileged(pool, dir, 'central');
        const revoke = pool.calls.find((item) => {
            return item.sql.includes('REVOKE DELETE');
        });
        assert.ok(revoke, 'privileged migrate must execute revoke statements');
    });

    it('does not apply C0002 during supervisor_sink migrate', async function() {
        const pool = fakePool();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sink-mig-'));
        const file = 'C0002__central_revoke_delete.sql';
        await fs.writeFile(
            path.join(dir, file),
            'REVOKE DELETE ON segments FROM supervisor_sink'
        );
        await migrate(pool, dir, 'central');
        const revoke = pool.calls.find((item) => {
            return item.sql.includes('REVOKE DELETE');
        });
        assert.strictEqual(revoke, undefined, 'sink migrate must skip C0002');
    });

    it('does not apply E0003 during supervisor_sink migrate', async function() {
        const pool = fakePool();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sink-mig-'));
        const file = 'E0003__edge_operations_grants.sql';
        await fs.writeFile(
            path.join(dir, file),
            'GRANT SELECT ON operations TO supervisor_sink'
        );
        await migrate(pool, dir, 'edge');
        const grant = pool.calls.find((item) => {
            return item.sql.includes('GRANT SELECT ON operations');
        });
        assert.strictEqual(grant, undefined, 'sink migrate must skip E0003');
    });

    it('does not apply C0005 during supervisor_sink migrate', async function() {
        const pool = fakePool();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sink-mig-'));
        const file = 'C0005__central_operators_grants.sql';
        await fs.writeFile(
            path.join(dir, file),
            'GRANT SELECT ON operators TO supervisor_sink'
        );
        await migrate(pool, dir, 'central');
        const grant = pool.calls.find((item) => {
            return item.sql.includes('GRANT SELECT ON operators');
        });
        assert.strictEqual(grant, undefined, 'sink migrate must skip C0005');
    });
});
