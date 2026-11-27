import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import contiguousPhases, { phaseAnchors, validatePhaseAnchors } from '../../../../src/infrastructure/ingest/sinks/contiguousPhases.js';
import ciContainerImage from '../../../helpers/ciContainerImage.js';

const origin = Date.parse('2026-11-26T14:10:12.840Z');
const iso = millis => { return new Date(millis).toISOString(); };
const track = 'phase-probe';
const anchors = phaseAnchors(JSON.stringify({ [track]: iso(origin) }));

function phase(name, from, until) {
    return {
        type: 'segment', kind: 'phase', machine: track, name,
        start_time: iso(origin + from), end_time: iso(origin + until), duration: (until - from) / 1000
    };
}

describe('contiguous PostgreSQL phase storage', function () {
    this?.timeout?.(120000);
    const schema = `contiguous_spec_${randomBytes(8).toString('hex')}`;
    let container;
    let admin;
    let pool;
    let connectionString;

    function openPool() {
        return new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 2 });
    }

    async function startPostgres() {
        const { GenericContainer, Wait } = await import('testcontainers');
        container = await new GenericContainer(ciContainerImage('postgres', '16-alpine'))
            .withEnvironment({ POSTGRES_PASSWORD: 'phase-test' })
            .withExposedPorts(5432)
            .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2)).start();
        return `postgres://postgres:phase-test@${container.getHost()}:${container.getMappedPort(5432)}/postgres`;
    }

    before(async () => {
        connectionString = process.env.CONTIGUOUS_TEST_PG_URL ?? await startPostgres();
        admin = new pg.Pool({connectionString, max: 1});
        await admin.query(`CREATE SCHEMA ${schema}`);
        pool = openPool();
        await pool.query(`
            CREATE TABLE segments (
                machine text, kind text, name text, start_time timestamptz, end_time timestamptz,
                duration double precision, options text, tags text, properties text, resolved boolean, updated_at timestamptz,
                PRIMARY KEY(machine,kind,start_time)
            );
            CREATE TABLE contiguous_phase_inbox (
                machine text, start_time timestamptz, phase jsonb, PRIMARY KEY(machine,start_time)
            );`);
    });

    after(async () => {
        try {
            await pool?.end();
            if (admin) {
                try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
                finally { await admin.end(); }
            }
        } finally {
            await container?.stop();
        }
    });

    function dispatch() {
        return contiguousPhases(pool, anchors, { accept() { throw Error('Unexpected route'); } });
    }
    async function visible() {
        const { rows } = await pool.query('SELECT name,start_time,end_time FROM segments ORDER BY start_time');
        return rows.map(row => { return [row.name, row.start_time.toISOString(), row.end_time.toISOString()]; });
    }
    function expected(rows) {
        return rows.map(row => { return [row.name, row.start_time, row.end_time]; });
    }

    it('publishes a contiguous prefix after delayed delivery, a connection restart, and retries', async () => {
        const first = phase('on', 0, 12001);
        const delayed = phase('off', 12001, 132027);
        const later = phase('on', 132027, 144028);
        await dispatch().accept(later);
        assert.deepEqual(await visible(), []);
        await dispatch().accept(first);
        assert.deepEqual(await visible(), expected([first]));
        const previousPool = pool;
        pool = openPool();
        await previousPool.end();
        await validatePhaseAnchors(pool, anchors);
        assert.deepEqual(await visible(), expected([first]));
        await dispatch().accept(delayed);
        const complete = expected([first, delayed, later]);
        assert.deepEqual(await visible(), complete);
        await dispatch().accept(later);
        await dispatch().accept(phase('on', 1, 132029));
        assert.deepEqual(await visible(), complete);
        assert.equal((await pool.query('SELECT count(*) FROM contiguous_phase_inbox')).rows[0].count, '0');

        const next = phase('off', 144028, 154031);
        const afterNext = phase('on', 154031, 164043);
        await dispatch().accept(afterNext);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await dispatch().acceptMany([next], client);
            assert.deepEqual(await visible(), complete);
        } finally {
            try {
                await client.query('ROLLBACK');
            } finally {
                client.release();
            }
        }
        assert.deepEqual(await visible(), complete);
        await dispatch().accept(next);
        assert.deepEqual(await visible(), expected([first, delayed, later, next, afterNext]));
        assert.equal((await pool.query('SELECT count(*) FROM contiguous_phase_inbox')).rows[0].count, '0');

        const previous = phase('off', 164043, 164043);
        const closed = phase('off', 164043, 176045);
        const open = phase('on', 176045, 176045);
        await dispatch().accept(previous);
        await dispatch().accept({ type: 'phase-transition', machine: track, pieces: [closed, open] });
        assert.deepEqual((await visible()).slice(-2), expected([closed, open]));
        await dispatch().accept({ type: 'phase-transition', machine: track, pieces: [closed, open] });
        assert.deepEqual((await visible()).slice(-2), expected([closed, open]));
    });

    it('keeps the newest pending revision before and after its anchor becomes visible', async () => {
        await pool.query('TRUNCATE segments, contiguous_phase_inbox');
        const next = origin + 5000;
        const pending = { ...phase('off', next - origin, next - origin),
            properties: JSON.stringify({ phase_revision: '12' }) };
        const stale = { ...pending, properties: JSON.stringify({ phase_revision: '11' }) };
        const heartbeat = { ...stale, end_time: iso(next + 2000) };
        await dispatch().accept(heartbeat);
        await dispatch().accept(pending);
        await dispatch().accept(heartbeat);
        await dispatch().accept(phase('on', 0, next - origin));
        const read = async () => {
            const { rows } = await pool.query('SELECT properties FROM segments WHERE start_time=$1', [iso(next)]);
            return JSON.parse(rows[0].properties);
        };
        assert.deepEqual(await read(), { phase_revision: '12' });
        await dispatch().accept(stale);
        await dispatch().accept({ ...pending, properties: 'legacy text' });
        assert.deepEqual(await read(), { phase_revision: '12' });
    });
});
