import assert from 'assert';
import coverageHolds from '../../../src/infrastructure/persistence/coverageHolds.js';

describe('coverageHolds', function() {
    it('opens a new span when the held value changes', function() {
        const origin = Date.parse('2026-10-03T13:00:00.000Z') + Math.floor(Math.random() * 4000);
        const first = 700 + Math.floor(Math.random() * 3) * 100;
        const second = first + 100;
        const rows = [
            { ts: new Date(origin), value: first },
            { ts: new Date(origin + 1000), value: first },
            { ts: new Date(origin + 2000), value: second }
        ];
        const spans = coverageHolds(rows, origin, origin + 10000, 3000);
        assert.strictEqual(spans.length, 2, 'a value change stayed inside one hold');
    });

    it('opens a new span after a heartbeat hole', function() {
        const origin = Date.parse('2026-10-03T14:00:00.000Z') + Math.floor(Math.random() * 3000);
        const size = 800 + Math.floor(Math.random() * 3) * 100;
        const rows = [
            { ts: new Date(origin), value: size },
            { ts: new Date(origin + 1000), value: size },
            { ts: new Date(origin + 9000), value: size }
        ];
        const spans = coverageHolds(rows, origin, origin + 20000, 3000);
        assert.strictEqual(spans.length, 2, 'a silent gap kept one hold');
    });

    it('does not invent a hold from a sample before the window', function() {
        const origin = Date.parse('2026-10-03T15:00:00.000Z') + Math.floor(Math.random() * 2000);
        const size = 350 + Math.floor(Math.random() * 4) * 50;
        const rows = [
            { ts: new Date(origin - 60000), value: size }
        ];
        const spans = coverageHolds(rows, origin, origin + 3600000, 3000);
        assert.strictEqual(spans.length, 0, 'a prior sample became an in-window hold');
    });

    it('folds a day of one-hertz samples into one hold', function() {
        const origin = Date.parse('2026-10-03T16:00:00.000Z') + Math.floor(Math.random() * 800);
        const size = 1000;
        const rows = [];
        const count = 80 + Math.floor(Math.random() * 20);
        for (let i = 0; i < count; i += 1) {
            rows.push({ ts: new Date(origin + i * 1000), value: size });
        }
        const spans = coverageHolds(rows, origin, origin + count * 1000 + 1, 3000);
        assert.strictEqual(spans.length === 1 && Number(spans[0].value) === size, true, 'steady heartbeats split into many holds');
    });
});
