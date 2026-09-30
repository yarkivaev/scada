import assert from 'assert';
import clickhouseSensor from '../../../../src/infrastructure/persistence/clickhouse/sensor.js';

describe('clickhouseSensor changes', function() {
    it('gives lagInFrame a typed null default for Float64 values', async function() {
        let sql = '';
        const connection = {
            url() {
                return 'http://changes-null';
            },
            async query(text) {
                sql = text;
                return [];
            }
        };
        await clickhouseSensor(connection, `OPCUA/dev-${Math.random()}/GET/flag/VALUE`, 'Flag', '').changes({
            start: new Date('2026-09-30T04:00:00.000Z'),
            end: new Date('2026-09-30T12:00:00.000Z')
        });
        assert.ok(
            sql.includes('CAST(NULL AS Nullable(Float64))'),
            'changes query used an untyped NULL lag default'
        );
    });
});
