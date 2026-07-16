import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { GenericContainer, Wait } from 'testcontainers';
import ciContainerImage from '../../../helpers/ciContainerImage.js';
import migrate, { migratePrivileged } from '../../../../src/infrastructure/ingest/db/migrate.js';
import operatorsFromPg from '../../../../src/infrastructure/persistence/pg/operators.js';

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

/**
 * Retries role bootstrap until Postgres accepts connections after container start.
 *
 * @param {object} adminPool - pool connected as bootstrap superuser
 * @returns {Promise<void>}
 */
async function awaitBootstrap(adminPool) {
    let attempts = 60;
    while (attempts > 0) {
        try {
            await bootstrapRoles(adminPool);
            return;
        } catch (error) {
            attempts -= 1;
            if (attempts === 0 || !String(error.message).includes('starting up')) {
                throw error;
            }
            await new Promise((resolve) => {
                setTimeout(resolve, 500);
            });
        }
    }
}

describe('operators table grants for supervisor_sink', function() {
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
            .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
            .withStartupTimeout(90000)
            .start();
        const host = container.getHost();
        const port = container.getMappedPort(5432);
        const bootstrapUrl = `postgresql://bootstrap:bootstrap@${host}:${port}/scada`;
        const bootstrapPool = new pg.Pool({ connectionString: bootstrapUrl });
        await awaitBootstrap(bootstrapPool);
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

    it('allows supervisor_sink to list operators after privileged grants', async function() {
        const uid = `grant-op-${Math.random().toString(36).slice(2)}`;
        await adminPool.query(
            'INSERT INTO operators (card_uid, first_name, last_name, display_name) VALUES ($1, $2, $3, $4)',
            [uid, 'Ирина', 'Ковалёва', 'Ирина Ковалёва']
        );
        const rows = await operatorsFromPg(sinkPool).list();
        assert.strictEqual(
            rows.some((row) => {
                return row.cardUid === uid;
            }),
            true,
            'supervisor_sink cannot select operators after central revoke without operators grant'
        );
    });
});
