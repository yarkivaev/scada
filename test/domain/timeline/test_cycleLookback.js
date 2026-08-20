import assert from 'assert';
import cycleLookback from '../../../src/domain/timeline/cycleLookback.js';

describe('cycleLookback', function() {
    it('stops at the first reset tag walking newest first', function() {
        const reset = `якорь-${Math.floor(Math.random() * 9000 + 1000)}`;
        const older = `стар-${Math.floor(Math.random() * 9000 + 1000)}`;
        const newest = [`выдача-${Math.floor(Math.random() * 90)}`];
        const rows = [
            { name: 'off', tags: newest },
            { name: 'off', tags: [reset] },
            { name: 'off', tags: [older] }
        ];
        const prior = cycleLookback(rows, [reset]);
        assert.deepStrictEqual(
            prior.map((row) => {
                return row.tags;
            }),
            [[reset], newest],
            'lookback walked past the reset tag into an older row'
        );
    });

    it('reads reset tags from a JSON string', function() {
        const reset = `футеровка-${Math.floor(Math.random() * 9000 + 1000)}`;
        const prior = cycleLookback(
            [{ name: 'off', tags: JSON.stringify([reset]) }],
            [reset]
        );
        assert.strictEqual(prior.length, 1, 'JSON string reset tag did not stop lookback');
    });
});
