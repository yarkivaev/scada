import assert from 'assert';
import segmentCoalesce from '../../../src/domain/segment/segmentCoalesce.js';

/**
 * Builds a settle tracker for coalesce tests.
 *
 * @returns {object} settle with ack/nack counters
 */
function settle() {
    const state = { acks: 0, nacks: 0 };
    return {
        state,
        ack() {
            state.acks += 1;
        },
        nack() {
            state.nacks += 1;
        }
    };
}

/**
 * Builds a pending heartbeat payload.
 *
 * @param {string} machine - machine id
 * @param {number} start - start millis
 * @param {number} end - end millis
 * @returns {string} JSON payload
 */
function heartbeat(machine, start, end) {
    return JSON.stringify({
        type: 'segment',
        machine,
        name: 'off',
        start,
        end,
        duration: 0,
        tags: ['to_ladle']
    });
}

describe('segmentCoalesce', function() {
    it('writes only the latest heartbeat for one open segment key', async function() {
        const accepted = [];
        const codec = {
            accept(raw) {
                accepted.push(JSON.parse(raw.payload));
                return Promise.resolve();
            }
        };
        const coalesce = segmentCoalesce(codec, { size: 2, interval: 60 });
        const machine = `ičt-${Math.random().toString(16).slice(2)}`;
        const start = 1700000000000 + Math.floor(Math.random() * 1000);
        await coalesce.accept({
            destination: '/queue/scada.segments.ingest',
            payload: heartbeat(machine, start, start + 1000),
            settle: settle()
        });
        await coalesce.accept({
            destination: '/queue/scada.segments.ingest',
            payload: heartbeat(machine, start, start + 5000),
            settle: settle()
        });
        assert.strictEqual(accepted.length, 1, 'coalesce did not collapse pending heartbeats to one write');
        assert.strictEqual(accepted[0].end, start + 5000, 'coalesce kept a stale heartbeat end');
    });

    it('acks every coalesced heartbeat after one successful write', async function() {
        const codec = { accept() { return Promise.resolve(); } };
        const coalesce = segmentCoalesce(codec, { size: 3, interval: 60 });
        const machine = `ičt-${Math.random().toString(16).slice(2)}`;
        const start = 1700001000000;
        const settles = [settle(), settle(), settle()];
        await settles.reduce((chain, item, index) => {
            return chain.then(() => {
                return coalesce.accept({
                    destination: '/q',
                    payload: heartbeat(machine, start, start + (index + 1) * 1000),
                    settle: item
                });
            });
        }, Promise.resolve());
        const acks = settles.reduce((sum, item) => { return sum + item.state.acks; }, 0);
        assert.strictEqual(acks, 3, 'coalesced heartbeats were not all acknowledged');
    });

    it('does not coalesce a retag into a pending heartbeat batch', async function() {
        const types = [];
        const codec = {
            accept(raw) {
                types.push(JSON.parse(raw.payload).type);
                return Promise.resolve();
            }
        };
        const coalesce = segmentCoalesce(codec, { size: 50, interval: 60 });
        const machine = `ičt-${Math.random().toString(16).slice(2)}`;
        const start = 1700002000000;
        await coalesce.accept({
            destination: '/q',
            payload: heartbeat(machine, start, start + 1000),
            settle: settle()
        });
        await coalesce.accept({
            destination: '/q',
            payload: JSON.stringify({
                type: 'retag',
                machine,
                name: 'off',
                start,
                end: start + 1000,
                duration: 1,
                tags: ['metal_ready']
            }),
            settle: settle()
        });
        assert.deepStrictEqual(types, ['segment', 'retag'], 'retag was swallowed by heartbeat coalesce');
    });

    it('keeps independent machines on separate lanes', async function() {
        const machines = [];
        const codec = {
            accept(raw) {
                machines.push(JSON.parse(raw.payload).machine);
                return Promise.resolve();
            }
        };
        const coalesce = segmentCoalesce(codec, { size: 1, interval: 60 });
        const left = `ä-${Math.random().toString(16).slice(2)}`;
        const right = `ö-${Math.random().toString(16).slice(2)}`;
        await Promise.all([
            coalesce.accept({
                destination: '/q',
                payload: heartbeat(left, 1, 2),
                settle: settle()
            }),
            coalesce.accept({
                destination: '/q',
                payload: heartbeat(right, 3, 4),
                settle: settle()
            })
        ]);
        assert.strictEqual(new Set(machines).size, 2, 'per-machine lanes did not both flush');
    });
});
