import assert from 'assert';
import clickhouseSensor from '../../../../src/infrastructure/persistence/clickhouse/sensor.js';
import { createClickhouseStreamHub } from '../../../../src/infrastructure/persistence/clickhouse/streamHub.js';

describe('clickhouseSensor', function() {
    it('streams share one ClickHouse query across sensors on the same connection', async function() {
        let queries = 0;
        const connection = {
            url() {
                return `http://batch-${Math.random()}`;
            },
            async query() {
                queries += 1;
                return [];
            }
        };
        const pulses = [];
        const schedule = (step, fn) => {
            pulses.push(fn);
            return () => {
                return undefined;
            };
        };
        createClickhouseStreamHub(connection, schedule);
        const since = new Date('2024-06-01T10:00:00.000Z');
        const clock = () => {
            return new Date('2024-06-01T10:00:01.000Z');
        };
        const sensors = Array.from({ length: 30 }, (unused, i) => {
            return clickhouseSensor(connection, `shared/${i}/${Math.random()}`, `S${i}`, 'V');
        });
        const subs = sensors.map((sensor) => {
            return sensor.stream(since, 1000, () => {
                return undefined;
            }, clock);
        });
        assert.ok(pulses.length >= 1, 'stream hub did not schedule a pulse');
        await pulses[0]();
        subs.forEach((sub) => {
            sub.cancel();
        });
        assert.strictEqual(queries, 1, 'sensor streams did not coalesce ClickHouse CPU load');
    });

    it('current still uses a single-topic latest query', async function() {
        const topic = `latest/${Math.random()}`;
        let sql = '';
        const connection = {
            url() {
                return 'http://current-test';
            },
            async query(query) {
                sql = query;
                return [{ ts: '2024-06-01 10:00:00.000', value: 11 }];
            }
        };
        const reading = await clickhouseSensor(connection, topic, 'U', 'V').current();
        assert.ok(sql.includes('LIMIT 1'), 'current query was not a latest-point lookup');
        assert.strictEqual(reading.value, 11, 'current value did not match row');
    });
});
