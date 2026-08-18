import assert from 'assert';
import allowedSegmentTags from '../../../../src/infrastructure/http/plant/allowedSegmentTags.js';

describe('allowedSegmentTags', function () {
    it('allows any tag when published options are empty', function () {
        const tag = `load-${Math.floor(Math.random() * 900 + 100)}`;
        assert.strictEqual(allowedSegmentTags([], [], [tag]), true, 'empty options rejected a tag');
    });

    it('rejects a tag outside published options', function () {
        assert.strictEqual(
            allowedSegmentTags(['load'], [], ['pour']),
            false,
            'tag outside options was accepted'
        );
    });

    it('allows a standing tag that left the published list', function () {
        assert.strictEqual(
            allowedSegmentTags(['load'], ['pour'], ['pour']),
            true,
            'standing tag was rejected'
        );
    });

    it('reads options from a JSON string', function () {
        assert.strictEqual(
            allowedSegmentTags('["load"]', '[]', ['load']),
            true,
            'JSON options were not accepted'
        );
    });
});
