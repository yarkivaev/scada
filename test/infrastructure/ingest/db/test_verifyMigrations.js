import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyMigrations } from '../../../../src/infrastructure/ingest/db/migrate.js';

describe('verifyMigrations', function() {
    let dir;
    beforeEach(async function() {
        dir = await fs.mkdtemp(path.join(os.tmpdir(),'verify-migrations-'));
        await Promise.all(['V0001__shared.sql','E0004__edge_operations_delete.sql',
            'C0002__central_revoke_delete.sql','V0009__collector_task_state.sql','ignored.txt'].map((file) => {
            return fs.writeFile(path.join(dir,file),'MUST NEVER EXECUTE');
        }));
    });
    afterEach(async function() { await fs.rm(dir,{recursive:true,force:true}); });

    function checksProfile(profile) {
        it(`checks shared and privileged migrations for ${profile} using only SELECT`, async function() {
            const expected = ['V0001__shared.sql',profile === 'edge'
                ? 'E0004__edge_operations_delete.sql' : 'C0002__central_revoke_delete.sql'].sort();
            const pool = {async query(sql,parameters) {
                assert.match(sql,/^SELECT version FROM public\.schema_migrations/u);
                assert.deepEqual(parameters[0],expected);
                return {rows:expected.map((version) => { return {version}; })};
            }};
            await verifyMigrations(pool,dir,profile);
        });
    }
    checksProfile('edge');
    checksProfile('central');
    it('rejects missing privileged migrations', async function() {
        const pool = {async query() { return {rows:[{version:'V0001__shared.sql'}]}; }};
        await assert.rejects(verifyMigrations(pool,dir,'edge'),/Missing database migrations: E0004__edge_operations_delete.sql/u);
    });
    it('does not fall back to DDL when the registry is absent or inaccessible', async function() {
        let calls = 0;
        const error = new Error('schema_migrations missing or denied');
        const pool = {async query() { calls += 1; throw error; }};
        await assert.rejects(verifyMigrations(pool,dir,'edge'),error);
        assert.equal(calls,1);
    });
});
