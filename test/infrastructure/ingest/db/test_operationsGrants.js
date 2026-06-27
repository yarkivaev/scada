import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { GenericContainer } from 'testcontainers';
import ciContainerImage from '../../../helpers/ciContainerImage.js';
import migrate, { migratePrivileged } from '../../../../src/infrastructure/ingest/db/migrate.js';
import operationStatePg from '../../../../src/infrastructure/persistence/pg/operations.js';

const migrationsDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    'db',
    'migrations'
);

/**
 * Creates supervisor_sink role and scada admin user on a fresh database.
 *
 * @param {object} adminPool - pool connected as bootstrap superuser
 * @returns {Promise<void>}
 */
async function bootstrapRoles(adminPool) {
    await adminPool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'scada') THEN
                CREATE ROLE scada LOGIN PASSWORD 'scada' SUPERUSER;
            END IF;
            IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supervisor_sink') THEN
                CREATE ROLE supervisor_sink LOGIN PASSWORD 'supervisor_sink';
            END IF;
        END
        $$;
    `);
}

describe('operations table grants for supervisor_sink', function() {
    let container;
    let adminPool;
    let sinkPool;

    before(async function() {
        this.timeout(180000);
        container = await new GenericContainer(ciContainerImage('postgres', '16-alpine'))
            .withExposedPorts(5432)
            .withEnvironment({
                POSTGRES_USER: 'bootstrap',
                POSTGRES_PASSWORD: 'bootstrap',
                POSTGRES_DB: 'scada'
            })
            .withStartupTimeout(90000)
            .start();
        const host = container.getHost();
        const port = container.getMappedPort(5432);
        const bootstrapUrl = `postgresql://bootstrap:bootstrap@${host}:${port}/scada`;
        const bootstrapPool = new pg.Pool({ connectionString: bootstrapUrl });
        await bootstrapRoles(bootstrapPool);
        await bootstrapPool.end();
        const adminUrl = `postgresql://scada:scada@${host}:${port}/scada`;
        adminPool = new pg.Pool({ connectionString: adminUrl });
        await migrate(adminPool, migrationsDir, 'central');
        await migratePrivileged(adminPool, migrationsDir, 'central');
        const sinkUrl = `postgresql://supervisor_sink:supervisor_sink@${host}:${port}/scada`;
        sinkPool = new pg.Pool({ connectionString: sinkUrl });
    });

    after(async function() {
        this.timeout(60000);
        if (sinkPool) {
            await sinkPool.end();
        }
        if (adminPool) {
            await adminPool.end();
        }
        if (container) {
            await container.stop();
        }
    });

    it('allows supervisor_sink to upsert chem operations after privileged grants', async function() {
        const store = operationStatePg(sinkPool);
        const key = `grant-${Math.random().toString(36).slice(2)}`;
        await store.upsert({
            machine: 'icht1',
            occurred_at: new Date('2024-06-01T10:00:00.000Z'),
            kind: 'chem',
            key,
            payload: { status: 'ok', elements: { Fe: 0.1 } }
        });
        const rows = await store.listForMachine('icht1', 'chem', {});
        assert.strictEqual(rows.length, 1, 'supervisor_sink must read and write operations after grant migration');
    });
});
