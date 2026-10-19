import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { GenericContainer, Wait } from 'testcontainers';
import ciContainerImage from '../../../helpers/ciContainerImage.js';
import migrate, { migratePrivileged } from '../../../../src/infrastructure/ingest/db/migrate.js';
import { replaceSplit, splitRows, checkSplit } from '../../../../src/domain/segment/splitFamily.js';

const migrationsDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..', '..', 'db', 'migrations'
);

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

describe('split family replace on postgres', function() {
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
        const bootstrap = new pg.Pool({
            connectionString: `postgresql://bootstrap:bootstrap@${host}:${port}/scada`
        });
        await bootstrapRoles(bootstrap);
        await bootstrap.end();
        adminPool = new pg.Pool({
            connectionString: `postgresql://scada:scada@${host}:${port}/scada`
        });
        await migrate(adminPool, migrationsDir, 'central');
        await migratePrivileged(adminPool, migrationsDir, 'central');
        sinkPool = new pg.Pool({
            connectionString: `postgresql://supervisor_sink:supervisor_sink@${host}:${port}/scada`
        });
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

    it('drops a stale middle piece and leaves the neighboring on segment', async function() {
        this.timeout(30000);
        const machine = `ичт-${Date.now()}`;
        const start = new Date('2026-10-19T06:02:18.000Z');
        const stale = new Date('2026-10-19T06:20:00.000Z');
        const cut = new Date('2026-10-19T06:25:00.000Z');
        const end = new Date('2026-10-19T06:47:06.000Z');
        const onStart = end;
        await adminPool.query(
            `INSERT INTO segments (machine, kind, name, start_time, end_time, duration, tags, properties, resolved)
             VALUES
               ($1, 'phase', 'off', $2, $3, 2690, '["шлак"]', $4, true),
               ($1, 'phase', 'off', $5, $3, 1600, null, $4, true),
               ($1, 'phase', 'on', $6, $7, 600, '["heating"]', '{}', true)`,
            [machine, start, end, JSON.stringify({ split_of: String(start.getTime()) }), stale, onStart, new Date(onStart.getTime() + 600000)]
        );
        const pieces = splitRows(machine, checkSplit({
            name: 'off', start_time: start, end_time: end, duration: 2690
        }, [
            { start, end: cut, tag: 'шлак' },
            { start: cut, end, tag: '' }
        ]));
        await replaceSplit(sinkPool, { machine, origin: start.getTime(), pieces });
        const rows = await adminPool.query(
            `SELECT name, start_time, tags FROM segments WHERE machine = $1 ORDER BY start_time`,
            [machine]
        );
        const starts = rows.rows.map(function (row) { return new Date(row.start_time).toISOString(); });
        assert.deepStrictEqual(starts, [start.toISOString(), cut.toISOString(), onStart.toISOString()], 'stale piece remained or the neighbor was deleted');
        assert.strictEqual(rows.rows[1].tags, null, 'untagged piece stored a tag');
        assert.strictEqual(rows.rows[2].name, 'on', 'neighbor heating was rewritten');
    });
});
