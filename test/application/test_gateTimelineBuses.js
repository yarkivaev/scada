import assert from 'assert';
import { readFileSync } from 'node:fs';
import gateTimelineBuses from '../../src/application/gateTimelineBuses.js';

function wait() {
    return new Promise(function (resolve) {
        setImmediate(resolve);
    });
}

function busState() {
    const emitted = [];
    return {
        emitted,
        bus: {
            emit(event) {
                emitted.push(event);
            }
        }
    };
}

describe('gateTimelineBuses', function() {
    it('does not emit a covering open that starts before a later stored phase', async function() {
        const machine = `cm${Math.floor(Math.random() * 90 + 10)}`;
        const cover = new Date('2026-11-22T20:22:41.228Z');
        const later = new Date('2026-11-22T20:30:00.000Z');
        const state = busState();
        const pool = {
            query() {
                return Promise.resolve({
                    rows: [{
                        name: 'off',
                        start_time: later,
                        end_time: new Date('2026-11-22T20:31:00.000Z'),
                        duration: 60,
                        tags: '[]'
                    }]
                });
            }
        };
        gateTimelineBuses({ [machine]: state.bus }, pool)[machine].emit({
            type: 'created',
            segment: { name: 'off', start_time: cover, end_time: cover, duration: 0 }
        });
        await wait();
        assert.strictEqual(state.emitted.length, 0, 'stale covering off still reached the HMI bus');
    });
    it('emits a live open that is the latest stored start', async function() {
        const machine = `cm${Math.floor(Math.random() * 90 + 10)}`;
        const start = new Date('2026-11-23T11:47:36.994Z');
        const state = busState();
        const pool = {
            query() {
                return Promise.resolve({ rows: [] });
            }
        };
        gateTimelineBuses({ [machine]: state.bus }, pool)[machine].emit({
            type: 'created',
            segment: { name: 'off', start_time: start, end_time: start, duration: 0 }
        });
        await wait();
        assert.strictEqual(state.emitted.length, 1, 'latest live off was dropped from the HMI bus');
    });
    it('does not emit a nested heating that fold would drop', async function() {
        const machine = `drive${Math.floor(Math.random() * 9 + 1)}`;
        const origin = new Date('2026-11-23T16:27:00.000Z');
        const nested = new Date('2026-11-23T16:27:30.000Z');
        const state = busState();
        const pool = {
            query() {
                return Promise.resolve({
                    rows: [{
                        name: 'on',
                        start_time: origin,
                        end_time: new Date('2026-11-23T16:27:46.000Z'),
                        duration: 46,
                        tags: '["heating"]'
                    }]
                });
            }
        };
        gateTimelineBuses({ [machine]: state.bus }, pool)[machine].emit({
            type: 'created',
            segment: {
                name: 'on',
                start_time: nested,
                end_time: new Date('2026-11-23T16:27:46.000Z'),
                duration: 16,
                tags: '["heating"]'
            }
        });
        await wait();
        assert.strictEqual(state.emitted.length, 0, 'a covered nested heating still reached the HMI bus');
    });
    it('does not emit when overlapping SELECT fails', async function() {
        const machine = `cm${Math.floor(Math.random() * 90 + 10)}`;
        const start = new Date('2026-11-23T11:47:36.994Z');
        const state = busState();
        const pool = {
            query() {
                return Promise.reject(new Error('SELECT overlapping phases failed'));
            }
        };
        gateTimelineBuses({ [machine]: state.bus }, pool)[machine].emit({
            type: 'created',
            segment: { name: 'off', start_time: start, end_time: start, duration: 0 }
        });
        await wait();
        assert.strictEqual(state.emitted.length, 0, 'a SELECT error still forwarded a phase to the HMI bus');
    });
    it('folds overlapping stored rows before deciding to emit', function() {
        const body = readFileSync(new URL('../../src/application/gateTimelineBuses.js', import.meta.url), 'utf8');
        assert.match(body, /historyFold\(/u,
            'timeline SSE still used a SQL skip_covered gate instead of historyFold');
    });
});
