import assert from 'assert';
import levelChanges from '../../../src/infrastructure/persistence/levelChanges.js';

describe('levelChanges', function() {
    it('keeps the first sample and each later level change', function() {
        const origin = 1_700_000_000_000 + Math.floor(Math.random() * 50_000);
        const rows = [
            { ts: new Date(origin), value: 0 },
            { ts: new Date(origin + 1000), value: 0 },
            { ts: new Date(origin + 2000), value: 1 },
            { ts: new Date(origin + 3000), value: 1 },
            { ts: new Date(origin + 4000), value: 0 }
        ];
        assert.deepStrictEqual(
            levelChanges(rows).map((row) => {
                return row.value;
            }),
            [0, 1, 0],
            'heartbeat repeats were kept as extra level changes'
        );
    });
});
