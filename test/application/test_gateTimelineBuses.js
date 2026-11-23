import assert from 'assert';
import gateTimelineBuses from '../../src/application/gateTimelineBuses.js';

describe('gateTimelineBuses', function() {
    it('does not emit a covering open that starts before a later stored phase', async function() {
        const machine = `cm${Math.floor(Math.random() * 90 + 10)}`;
        const cover = new Date('2026-11-22T20:22:41.228Z');
        const emitted = [];
        const bus = {
            emit(event) {
                emitted.push(event);
            }
        };
        const pool = {
            query() {
                return Promise.resolve({ rowCount: 1 });
            }
        };
        gateTimelineBuses({ [machine]: bus }, pool)[machine].emit({
            type: 'created',
            segment: { name: 'off', start_time: cover, duration: 0 }
        });
        await new Promise(function (resolve) {
            setImmediate(resolve);
        });
        assert.strictEqual(emitted.length, 0, 'stale covering off still reached the HMI bus');
    });
    it('emits a live open that is the latest stored start', async function() {
        const machine = `cm${Math.floor(Math.random() * 90 + 10)}`;
        const start = new Date('2026-11-23T11:47:36.994Z');
        const emitted = [];
        const bus = {
            emit(event) {
                emitted.push(event);
            }
        };
        const pool = {
            query() {
                return Promise.resolve({ rowCount: 0 });
            }
        };
        gateTimelineBuses({ [machine]: bus }, pool)[machine].emit({
            type: 'created',
            segment: { name: 'off', start_time: start, duration: 0 }
        });
        await new Promise(function (resolve) {
            setImmediate(resolve);
        });
        assert.strictEqual(emitted.length, 1, 'latest live off was dropped from the HMI bus');
    });
    it('does not emit a nested heating that skip_covered would drop', async function() {
        const machine = `icht${Math.floor(Math.random() * 9 + 1)}`;
        const nested = new Date('2026-11-23T16:27:30.000Z');
        const emitted = [];
        const bus = {
            emit(event) {
                emitted.push(event);
            }
        };
        const pool = {
            query() {
                return Promise.resolve({ rowCount: 1 });
            }
        };
        gateTimelineBuses({ [machine]: bus }, pool)[machine].emit({
            type: 'created',
            segment: {
                name: 'on',
                start_time: nested,
                end_time: new Date('2026-11-23T16:27:46.000Z'),
                duration: 16,
                tags: '["heating"]'
            }
        });
        await new Promise(function (resolve) {
            setImmediate(resolve);
        });
        assert.strictEqual(emitted.length, 0, 'a covered nested heating still reached the HMI bus');
    });
});
