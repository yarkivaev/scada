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
