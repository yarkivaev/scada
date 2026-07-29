import assert from 'assert';
import exportStream from '../../../src/application/export/exportStream.js';

function fakeConn(label) {
    return {
        label,
        on() {
            return this;
        },
        close() {}
    };
}

describe('exportStream', function() {
    it('opens a measurement stream for a machine', function() {
        const machineId = `furnace-${Math.random().toString(36).slice(2)}`;
        const step = 1 + Math.floor(Math.random() * 90);
        let seen;
        const stream = exportStream({
            machine(id) {
                return {
                    measurementStream(options) {
                        seen = { id, options };
                        return fakeConn('measurements');
                    }
                };
            }
        });
        const conn = stream.measurements(machineId, { since: 'now', step });
        assert.deepStrictEqual(
            { id: seen.id, options: seen.options, label: conn.label },
            { id: machineId, options: { since: 'now', step }, label: 'measurements' },
            'exportStream did not open the measurement subscription'
        );
    });

    it('opens a segment stream for a machine', function() {
        const machineId = `line-${Math.random().toString(36).slice(2)}`;
        let seen;
        const stream = exportStream({
            machine(id) {
                seen = id;
                return {
                    segmentStream() {
                        return fakeConn('segments');
                    }
                };
            }
        });
        const conn = stream.segments(machineId);
        assert.deepStrictEqual(
            { machine: seen, label: conn.label },
            { machine: machineId, label: 'segments' },
            'exportStream did not open the segment subscription'
        );
    });

    it('opens an alert stream for a machine', function() {
        const machineId = `cell-${Math.random().toString(36).slice(2)}`;
        const stream = exportStream({
            machine() {
                return {
                    alertStream() {
                        return fakeConn('alerts');
                    }
                };
            }
        });
        assert.strictEqual(
            stream.alerts(machineId).label,
            'alerts',
            'exportStream did not open the alert subscription'
        );
    });

    it('opens an operations stream for a machine', function() {
        const machineId = `bay-${Math.random().toString(36).slice(2)}`;
        let notified = false;
        const stream = exportStream({
            machine() {
                return {
                    operationsStream(notify) {
                        notify({ ok: true });
                        return fakeConn('operations');
                    }
                };
            }
        });
        stream.operations(machineId, () => {
            notified = true;
        });
        assert.strictEqual(notified, true, 'exportStream did not forward the operations notify');
    });
});
