import assert from 'assert';
import clickhouseSensor from '../../../../src/infrastructure/persistence/clickhouse/sensor.js';

describe('clickhouseSensor rises', function() {
    it('asks ClickHouse for a lagged 0 to 1 prefix', async function() {
        const topic = `OPCUA/dev-${Math.random()}/GET/flag/VALUE`;
        let sql = '';
        const connection = {
            url() {
                return 'http://rises-test';
            },
            async query(text) {
                sql = text;
                return [{ ts: '2026-09-30 00:00:01.000', value: 1 }];
            }
        };
        const rows = await clickhouseSensor(connection, topic, 'Flag', '').rises({
            start: new Date('2026-09-30T00:00:00.000Z'),
            end: new Date('2026-09-30T01:00:00.000Z')
        });
        assert.ok(
            sql.includes('lagInFrame') && rows[0].value === 1,
            'rises query did not use a ClickHouse lag prefix'
        );
    });

    it('gives lagInFrame a typed null default for Float64 values', async function() {
        let sql = '';
        const connection = {
            url() {
                return 'http://rises-null';
            },
            async query(text) {
                sql = text;
                return [];
            }
        };
        await clickhouseSensor(connection, `OPCUA/dev-${Math.random()}/GET/flag/VALUE`, 'Flag', '').rises({
            start: new Date('2026-09-30T04:00:00.000Z'),
            end: new Date('2026-09-30T12:00:00.000Z')
        });
        assert.ok(
            sql.includes('lagInFrame(toNullable(value), 1)'),
            'rises query lagged a non-nullable Float64 value'
        );
    });
});
