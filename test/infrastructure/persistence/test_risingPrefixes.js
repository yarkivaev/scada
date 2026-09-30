import assert from 'assert';
import risingPrefixes from '../../../src/infrastructure/persistence/risingPrefixes.js';

describe('risingPrefixes', function() {
    it('accumulates one prefix per 0 to 1 edge and skips heartbeats', function() {
        const origin = 1_700_000_000_000 + Math.floor(Math.random() * 80_000);
        const rows = [
            { ts: new Date(origin), value: 0 },
            { ts: new Date(origin + 400), value: 1 },
            { ts: new Date(origin + 800), value: 1 },
            { ts: new Date(origin + 5000), value: 0 },
            { ts: new Date(origin + 5400), value: 1 }
        ];
        assert.deepStrictEqual(
            risingPrefixes(rows).map((row) => {
                return { value: row.value, at: row.ts.getTime() };
            }),
            [
                { value: 1, at: origin + 400 },
                { value: 2, at: origin + 5400 }
            ],
            'heartbeat ones produced extra prefix points'
        );
    });
});
