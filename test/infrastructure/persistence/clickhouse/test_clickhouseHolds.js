import assert from 'assert';
import clickhouseSensor from '../../../../src/infrastructure/persistence/clickhouse/sensor.js';

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
                    ts: '2026-10-03 13:32:37.000',
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
});
