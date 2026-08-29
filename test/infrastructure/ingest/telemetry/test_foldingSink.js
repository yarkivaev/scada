import assert from 'assert';
import foldingSink from '../../../../src/infrastructure/ingest/telemetry/foldingSink.js';

describe('foldingSink', function() {
    it('writes records to the inner sink then folds located samples', async function() {
        const written = [];
        const folded = [];
        const key = `blow_${Math.random().toString(36).slice(2, 8)}`;
        const record = { topic: `OPCUA/tlc-cm8/GET/${key}/VALUE`, value: 1, ts: Date.now() };
        const sink = foldingSink(
            { write(rows) { written.push(...rows); return Promise.resolve(); } },
            { accept(sample) { folded.push(sample); return Promise.resolve(); } },
            (row) => {
                return { machine: 'cm8', kind: key, value: row.value, ts: row.ts };
            }
        );
        await sink.write([record]);
        assert.strictEqual(written.length, 1, 'inner sink did not receive the point');
        assert.strictEqual(folded[0].kind, key, 'fold did not receive the interval sample');
    });
});
