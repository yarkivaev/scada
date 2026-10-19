import assert from 'assert';
import silentOpenWatch from '../../../src/infrastructure/ingest/silentOpenWatch.js';

describe('silentOpenWatch', function() {
    it('closes open segments after silence without waiting for a new Started', async function() {
        const closed = [];
        const budget = Math.floor(Math.random() * 40) + 10;
        const closer = {
            close(seconds) {
                closed.push(seconds);
                return Promise.resolve();
            }
        };
        const watch = silentOpenWatch(closer, budget, { intervalMs: 15 });
        await watch.start();
        await new Promise((resolve) => { setTimeout(resolve, 45); });
        watch.stop();
        assert.ok(closed.length >= 1, 'open segment was not closed after wall-clock silence');
    });

    it('does not start another close while one close is still running', async function() {
        let calls = 0;
        const budget = Math.floor(Math.random() * 40) + 10;
        const closer = {
            close() {
                calls += 1;
                if (calls === 1) {
                    return Promise.resolve();
                }
                return new Promise(() => {});
            }
        };
        const watch = silentOpenWatch(closer, budget, { intervalMs: 20 });
        await watch.start();
        await new Promise((resolve) => { setTimeout(resolve, 100); });
        watch.stop();
        assert.strictEqual(calls, 2, 'silence watch started another close while one was running');
    });

    it('passes the silence budget into each close call', async function() {
        const closed = [];
        const budget = Math.floor(Math.random() * 40) + 10;
        const closer = {
            close(seconds) {
                closed.push(seconds);
                return Promise.resolve();
            }
        };
        const watch = silentOpenWatch(closer, budget, { intervalMs: 60000 });
        await watch.start();
        watch.stop();
        assert.strictEqual(closed[0], budget, 'silence watch did not pass budget to closer');
    });

    it('throws when closer is missing close', function() {
        assert.throws(
            () => { silentOpenWatch({}, 30, { intervalMs: 1000 }); },
            /Closer must have a close\(\) method/u,
            'invalid closer was not rejected'
        );
    });
});
