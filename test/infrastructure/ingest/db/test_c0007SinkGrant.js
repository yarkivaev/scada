import assert from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import migrate, { migratePrivileged } from '../../../../src/infrastructure/ingest/db/migrate.js';

const grantFile = 'C0007__central_segment_replace_delete.sql';

function grantPath() {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'db', 'migrations', grantFile);
}

async function scratch() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c0007-'));
    await fs.copyFile(grantPath(), path.join(dir, grantFile));
    await fs.writeFile(path.join(dir, 'V0091__sentinel.sql'), "SELECT 'sentinel-v0091'");
    return dir;
}

function pool(sql) {
    return {
        query(text) {
            sql.push(String(text));
            return Promise.resolve({ rowCount: 0, rows: [] });
        }
    };
}

describe('C0007 segment delete grant', function() {
    it('does not run the GRANT DELETE migration as supervisor_sink on central', async function() {
        const dir = await scratch();
        const sql = [];
        await migrate(pool(sql), dir, 'central');
        assert.ok(!sql.some((text) => {
            return text.includes('GRANT DELETE');
        }), 'C0007 GRANT DELETE ran as supervisor_sink');
    });

    it('runs the GRANT DELETE migration only on the privileged path', async function() {
        const dir = await scratch();
        const sql = [];
        await migratePrivileged(pool(sql), dir, 'central');
        assert.ok(sql.some((text) => {
            return text.includes('GRANT DELETE ON segments TO supervisor_sink');
        }), 'privileged migrate skipped the segment delete grant');
    });
});
