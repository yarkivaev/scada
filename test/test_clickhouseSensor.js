import assert from 'assert';
import clickhouseSensor from '../src/clickhouseSensor.js';

function fakeConnection(rows) {
    return {
        async query() {
            return await Promise.resolve(rows);
        }
    };
}

describe('clickhouseSensor', function() {
    it('returns display name when name is called', function() {
        const name = `sensor${Math.random()}`;
        const sensor = clickhouseSensor(fakeConnection([]), `topic${Math.random()}`, name, 'V');
        assert(sensor.name() === name, 'name mismatch');
    });

    it('returns empty array when no measurements exist', async function() {
        const sensor = clickhouseSensor(fakeConnection([]), `topic${Math.random()}`, `name${Math.random()}`, 'V');
        const result = await sensor.measurements({ start: new Date(), end: new Date() }, 1000);
        assert(result.length === 0, 'should return empty array');
    });

    it('returns measurements with timestamp from query', async function() {
        const ts = new Date().toISOString();
        const rows = [{ ts, value: Math.random() }];
        const sensor = clickhouseSensor(fakeConnection(rows), `topic${Math.random()}`, `name${Math.random()}`, 'V');
        const result = await sensor.measurements({ start: new Date(), end: new Date() }, 1000);
        assert(result[0].timestamp.toISOString() === ts, 'timestamp mismatch');
    });

    it('returns measurements with value from query', async function() {
        const value = Math.random();
        const rows = [{ ts: new Date().toISOString(), value }];
        const sensor = clickhouseSensor(fakeConnection(rows), `topic${Math.random()}`, `name${Math.random()}`, 'V');
        const result = await sensor.measurements({ start: new Date(), end: new Date() }, 1000);
        assert(result[0].value === value, 'value mismatch');
    });

    it('returns measurements with correct unit', async function() {
        const unit = `unit${Math.random()}`;
        const rows = [{ ts: new Date().toISOString(), value: Math.random() }];
        const sensor = clickhouseSensor(fakeConnection(rows), `topic${Math.random()}`, `name${Math.random()}`, unit);
        const result = await sensor.measurements({ start: new Date(), end: new Date() }, 1000);
        assert(result[0].unit === unit, 'unit mismatch');
    });

    it('streams new measurements to callback', function(done) {
        const value = Math.random();
        const rows = [{ ts: new Date().toISOString(), value }];
        const sensor = clickhouseSensor(fakeConnection(rows), `topic${Math.random()}`, `name${Math.random()}`, 'V');
        const sub = sensor.stream(new Date(), 50, (measurement) => {
            sub.cancel();
            assert(measurement.value === value, 'value mismatch');
            done();
        });
    });

    it('cancels streaming when cancel is called', function(done) {
        let count = 0;
        const rows = [{ ts: new Date().toISOString(), value: Math.random() }];
        const sensor = clickhouseSensor(fakeConnection(rows), `topic${Math.random()}`, `name${Math.random()}`, 'V');
        const sub = sensor.stream(new Date(), 30, () => {
            count += 1;
            sub.cancel();
        });
        setTimeout(() => {
            assert(count === 1, 'callback called after cancel');
            done();
        }, 100);
    });
});
