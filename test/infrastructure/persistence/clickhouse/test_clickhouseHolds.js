import assert from 'assert';
import { GenericContainer } from 'testcontainers';
import ciContainerImage from '../../../helpers/ciContainerImage.js';
import clickhouseConnection from '../../../../src/infrastructure/persistence/clickhouse/connection.js';
import clickhouseSensor from '../../../../src/infrastructure/persistence/clickhouse/sensor.js';
import { HOLDS_SQL } from '../../../../src/infrastructure/persistence/clickhouse/holds.js';

function stamp(date) {
    return date.toISOString().replace('T', ' ').replace('Z', '');
}

async function seed(conn, topic, points) {
    await conn.insert('scada.metrics', points.map((point) => {
        return { topic, ts: stamp(point.ts), value: point.value };
    }));
}

describe('clickhouseSensor holds', function() {
    it('asks ClickHouse for heartbeat hold spans', async function() {
        const topic = `OPCUA/dev-${Math.random()}/GET/diameter/VALUE`;
        let sql = '';
        let gap;
        const connection = {
            url() {
                return 'http://holds-test';
            },
            async query(text, params) {
                sql = text;
                gap = params.gap;
                return [{
                    started: '2026-10-03 13:32:37.000',
                    until: '2026-10-04 08:14:12.000',
                    value: 1000
                }];
            }
        };
        const rows = await clickhouseSensor(connection, topic, 'Diam', 'mm').holds({
            start: new Date('2026-08-04T08:54:00.000Z'),
            end: new Date('2026-10-04T08:54:00.000Z')
        }, 3000);
        assert.ok(
            sql.includes('toUnixTimestamp64Milli')
                && gap === 3000
                && rows[0].until instanceof Date
                && rows[0].value === 1000,
            'holds query did not return a coverage span'
        );
    });

    it('does not seed a hold from a sample before the window', async function() {
        let sql = '';
        const connection = {
            url() {
                return 'http://holds-prior';
            },
            async query(text) {
                sql = text;
                return [];
            }
        };
        await clickhouseSensor(connection, `OPCUA/dev-${Math.random()}/GET/diameter/VALUE`, 'Diam', 'mm').holds({
            start: new Date('2026-10-03T00:00:00.000Z'),
            end: new Date('2026-10-04T00:00:00.000Z')
        }, 3000);
        assert.ok(
            sql.includes('ts >= {start:DateTime64(3)}') && sql.indexOf('UNION ALL') < 0,
            'holds query still unioned a prior sample'
        );
    });

    it('does not alias min(ts) as ts', function() {
        assert.ok(
            !/min\(\s*ts\s*\)\s+AS\s+ts/iu.test(HOLDS_SQL),
            'holds SQL still aliases min(ts) as ts'
        );
    });
});

describe('clickhouseSensor holds on ClickHouse', function() {
    let container;
    let host;
    let port;

    before(async function() {
        this.timeout(120000);
        container = await new GenericContainer(ciContainerImage('clickhouse-server', '24'))
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

    it('folds steady heartbeats into one coverage span', async function() {
        this.timeout(30000);
        const conn = await clickhouseConnection(host, { port });
        const origin = Date.parse('2026-10-03T13:32:37.000Z') + Math.floor(Math.random() * 4000);
        const topic = `OPCUA/dev-${Math.random()}/GET/diameter/VALUE`;
        const size = 700 + Math.floor(Math.random() * 4) * 100;
        await seed(conn, topic, [
            { ts: new Date(origin), value: size },
            { ts: new Date(origin + 1000), value: size },
            { ts: new Date(origin + 2000), value: size }
        ]);
        const rows = await clickhouseSensor(conn, topic, 'Diam', 'mm').holds({
            start: new Date(origin - 1000),
            end: new Date(origin + 10000)
        }, 3000);
        await conn.close();
        assert.strictEqual(rows.length, 1, 'steady heartbeats split into many holds');
    });

    it('opens a new span after a heartbeat hole', async function() {
        this.timeout(30000);
        const conn = await clickhouseConnection(host, { port });
        const origin = Date.parse('2026-10-03T14:00:00.000Z') + Math.floor(Math.random() * 3000);
        const topic = `OPCUA/dev-${Math.random()}/GET/diameter/VALUE`;
        const size = 800 + Math.floor(Math.random() * 3) * 100;
        await seed(conn, topic, [
            { ts: new Date(origin), value: size },
            { ts: new Date(origin + 1000), value: size },
            { ts: new Date(origin + 9000), value: size }
        ]);
        const rows = await clickhouseSensor(conn, topic, 'Diam', 'mm').holds({
            start: new Date(origin - 1000),
            end: new Date(origin + 20000)
        }, 3000);
        await conn.close();
        assert.strictEqual(rows.length, 2, 'a silent gap kept one hold');
    });

    it('opens a new span when the held value changes', async function() {
        this.timeout(30000);
        const conn = await clickhouseConnection(host, { port });
        const origin = Date.parse('2026-10-03T16:00:00.000Z') + Math.floor(Math.random() * 4000);
        const topic = `OPCUA/dev-${Math.random()}/GET/diameter/VALUE`;
        const first = 700 + Math.floor(Math.random() * 3) * 100;
        const second = first + 100;
        await seed(conn, topic, [
            { ts: new Date(origin), value: first },
            { ts: new Date(origin + 1000), value: first },
            { ts: new Date(origin + 2000), value: second }
        ]);
        const rows = await clickhouseSensor(conn, topic, 'Diam', 'mm').holds({
            start: new Date(origin - 1000),
            end: new Date(origin + 10000)
        }, 3000);
        await conn.close();
        assert.strictEqual(rows.length, 2, 'a value change stayed inside one hold');
    });

    it('does not invent a hold from a sample before the window', async function() {
        this.timeout(30000);
        const conn = await clickhouseConnection(host, { port });
        const origin = Date.parse('2026-10-03T15:00:00.000Z') + Math.floor(Math.random() * 2000);
        const topic = `OPCUA/dev-${Math.random()}/GET/diameter/VALUE`;
        const size = 350 + Math.floor(Math.random() * 4) * 50;
        await seed(conn, topic, [
            { ts: new Date(origin - 60000), value: size }
        ]);
        const rows = await clickhouseSensor(conn, topic, 'Diam', 'mm').holds({
            start: new Date(origin),
            end: new Date(origin + 3600000)
        }, 3000);
        await conn.close();
        assert.strictEqual(rows.length, 0, 'a prior sample became an in-window hold');
    });
});
