import assert from 'assert';
import foldingSink from '../../../../src/infrastructure/ingest/telemetry/foldingSink.js';

describe('foldingSink', function() {
    it('writes records to the inner sink then folds located samples', async function() {
        const written = [];
        const folded = [];
        const key = `blow_${Math.random().toString(36).slice(2, 8)}`;
        const record = { topic: `OPCUA/tlc-line-8/GET/${key}/VALUE`, value: 1, ts: Date.now() };
        const sink = foldingSink(
            { write(rows) { written.push(...rows); return Promise.resolve(); } },
            { accept(sample) { folded.push(sample); return Promise.resolve(); } },
            (row) => {
                return { machine: 'line-8', kind: key, value: row.value, ts: row.ts };
            }
        );
        await sink.write([record]);
        assert.strictEqual(written.length, 1, 'inner sink did not receive the point');
        assert.strictEqual(folded[0].kind, key, 'fold did not receive the interval sample');
    });
});


describe('folding sink ownership', function () {
    it('forwards optional underlying sink cleanup', async function () {
        let closed = false;
        const sink = foldingSink({ async stop() { closed = true; } }, {}, () => { return null; });
        assert.strictEqual(typeof sink.stop, 'function');
        await sink.stop();
        assert.strictEqual(closed, true);
    });
});

describe('folding sink cancellation', function () {
    it('does not begin a fold after the initial write is cancelled', async function () {
        let release;
        let forwarded;
        let folds = 0;
        const pending = new Promise((resolve) => { release = resolve; });
        const controller = new AbortController();
        const sink = foldingSink({ write(records, context) { forwarded = context; return pending; } },
            { accept() { folds += 1; } }, (record) => { return record; });
        const result = sink.write([{ value: 42 }], { signal: controller.signal });
        controller.abort(new Error('revoked'));
        release();
        await assert.rejects(result, /revoked/u);
        assert.strictEqual(forwarded.signal, controller.signal);
        assert.strictEqual(folds, 0);
    });
});
