import assert from 'assert';
import { GenericContainer } from 'testcontainers';
import clickhouseConnection from '../../../../src/infrastructure/persistence/clickhouse/connection.js';

/**
 * Tests for ClickHouse connection factory.
 *
 * Verifies connection creation, query execution, and cleanup.
 */
describe('clickhouseConnection', function() {
    let container;
    let host;
    let port;

    before(async function() {
        this.timeout(120000);
        container = await new GenericContainer('clickhouse/clickhouse-server:24')
            .withExposedPorts(8123)
            .withStartupTimeout(90000)
            .start();
        host = container.getHost();
        port = container.getMappedPort(8123);
    });

    after(async function() {
        this.timeout(30000);
        if (container) {
            await container.stop();
        }
    });

    it('connects to ClickHouse and returns connection object', async function() {
        const conn = await clickhouseConnection(host, { port });
        await conn.close();
        assert(conn !== null, 'connection is null');
    });

    it('inserts data and returns without error', async function() {
        const conn = await clickhouseConnection(host, { port });
        const topic = `topic${Math.random()}`;
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const value = Math.random() * 100;
        await conn.insert('scada.metrics', [{ topic, ts: now, value }]);
        await conn.close();
        assert(true, 'insert completed');
    });

    it('executes query and returns rows', async function() {
        const conn = await clickhouseConnection(host, { port });
        const topic = `topic${Math.random()}`;
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const value = Math.random() * 100;
        await conn.insert('scada.metrics', [{ topic, ts: now, value }]);
        const rows = await conn.query(
            'SELECT ts, value FROM scada.metrics WHERE topic = {topic:String}',
            { topic }
        );
        await conn.close();
        assert(rows.length === 1, 'expected one row');
    });

    it('closes connection without error', async function() {
        const conn = await clickhouseConnection(host, { port });
        let closed = false;
        await conn.close();
        closed = true;
        assert(closed === true, 'close did not complete');
    });
});
