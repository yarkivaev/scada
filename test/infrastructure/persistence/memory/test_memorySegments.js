import assert from 'assert';
import segmentStateMemory from '../../../../src/infrastructure/persistence/memory/segments.js';

function storeWith(rows) {
    return { segments: rows };
}

describe('segmentStateMemory kinds', function() {
    it('lists only phase rows by default', function() {
        const machine = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = new Date();
        const port = segmentStateMemory(storeWith([
            { machine, kind: 'phase', name: 'on', start_time: start, end_time: start, duration: 1 },
            { machine, kind: 'ladle_moving', name: '1', start_time: start, end_time: start, duration: 0 }
        ]));
        const rows = port.listForMachine(machine, {});
        assert.strictEqual(rows.length, 1, 'default list leaked non-phase rows');
        assert.strictEqual(rows[0].name, 'on', 'default list did not keep the phase row');
    });

    it('lists requested kinds together', function() {
        const machine = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = new Date();
        const kind = `blow_${Math.random().toString(36).slice(2, 8)}`;
        const port = segmentStateMemory(storeWith([
            { machine, kind: 'phase', name: 'off', start_time: start, end_time: start, duration: 1 },
            { machine, kind, name: '1', start_time: start, end_time: start, duration: 0 }
        ]));
        const rows = port.listForMachine(machine, { kinds: [kind] });
        assert.strictEqual(rows.length, 1, 'kinds filter returned extra rows');
        assert.strictEqual(rows[0].kind, kind, 'kinds filter missed the requested track');
    });

    it('returns the latest row per requested kind', function() {
        const machine = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const kind = `pipe_${Math.random().toString(36).slice(2, 8)}`;
        const older = new Date('2026-01-01T00:00:00.000Z');
        const newer = new Date('2026-01-01T00:10:00.000Z');
        const port = segmentStateMemory(storeWith([
            { machine, kind, name: '0', start_time: older, end_time: older, duration: 60 },
            { machine, kind, name: '1', start_time: newer, end_time: newer, duration: 0 }
        ]));
        const rows = port.latestForKinds(machine, [kind]);
        assert.strictEqual(rows[0].name, '1', 'latestForKinds did not pick the newest interval');
    });
});
