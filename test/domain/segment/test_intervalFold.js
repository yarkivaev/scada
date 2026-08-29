import assert from 'assert';
import intervalFold from '../../../src/domain/segment/intervalFold.js';

function memoryPort() {
    const rows = [];
    return {
        rows,
        async open(machine, kind) {
            return rows.find((row) => {
                return row.machine === machine && row.kind === kind && row.duration === 0;
            }) || null;
        },
        async begin(sample) {
            const start = new Date(sample.ts);
            rows.push({
                machine: sample.machine,
                kind: sample.kind,
                name: sample.name,
                start_time: start,
                end_time: start,
                duration: 0
            });
        },
        async extend(open, ts) {
            open.end_time = new Date(ts);
        },
        async finish(open, ts) {
            open.end_time = new Date(ts);
            open.duration = Math.max(1, Math.round((open.end_time - open.start_time) / 1000));
        }
    };
}

describe('intervalFold', function() {
    it('opens a new interval when none exists', async function() {
        const port = memoryPort();
        const fold = intervalFold(port);
        const machine = `cm${Math.floor(Math.random() * 90 + 10)}`;
        const kind = `ladle_${Math.random().toString(36).slice(2, 8)}`;
        await fold.accept({ machine, kind, value: 1, ts: Date.now() });
        assert.strictEqual(port.rows.length, 1, 'fold did not insert the first interval');
        assert.strictEqual(port.rows[0].name, '1', 'fold stored the wrong interval name');
    });

    it('extends the open interval when the value stays the same', async function() {
        const port = memoryPort();
        const fold = intervalFold(port);
        const machine = `cm${Math.floor(Math.random() * 90 + 10)}`;
        const kind = `body_${Math.random().toString(36).slice(2, 8)}`;
        const first = Date.UTC(2026, 0, 1, 10, 0, 0);
        const beat = first + 1000;
        await fold.accept({ machine, kind, value: 0, ts: first });
        await fold.accept({ machine, kind, value: 0, ts: beat });
        assert.strictEqual(port.rows.length, 1, 'same value opened a second interval');
        assert.strictEqual(port.rows[0].end_time.getTime(), beat, 'heartbeat did not move end_time');
    });

    it('closes the previous interval when the value changes', async function() {
        const port = memoryPort();
        const fold = intervalFold(port);
        const machine = `cm${Math.floor(Math.random() * 90 + 10)}`;
        const kind = `blow_${Math.random().toString(36).slice(2, 8)}`;
        const first = Date.UTC(2026, 0, 1, 10, 0, 0);
        const next = first + 5000;
        await fold.accept({ machine, kind, value: 0, ts: first });
        await fold.accept({ machine, kind, value: 1, ts: next });
        assert.strictEqual(port.rows.length, 2, 'value change did not open a new interval');
        assert.ok(port.rows[0].duration > 0, 'previous interval stayed open');
        assert.strictEqual(port.rows[1].name, '1', 'new interval did not store the new value');
    });

    it('keeps parallel kinds open on the same machine', async function() {
        const port = memoryPort();
        const fold = intervalFold(port);
        const machine = `cm${Math.floor(Math.random() * 90 + 10)}`;
        const first = `ladle_${Math.random().toString(36).slice(2, 8)}`;
        const second = `pipe_${Math.random().toString(36).slice(2, 8)}`;
        const ts = Date.now();
        await fold.accept({ machine, kind: first, value: 1, ts });
        await fold.accept({ machine, kind: second, value: 0, ts });
        assert.strictEqual(port.rows.filter((row) => {
            return row.duration === 0;
        }).length, 2, 'parallel kinds closed each other');
    });
});
