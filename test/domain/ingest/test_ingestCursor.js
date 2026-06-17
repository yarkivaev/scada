import assert from 'assert';
import { ingestCursorAt, ingestCursorEmpty } from '../../../src/domain/ingest/ingestCursor.js';

describe('ingestCursorEmpty', function() {
    it('tags absent poll cursor with empty kind', function() {
        const cursor = ingestCursorEmpty();
        assert.strictEqual(cursor.kind, 'empty', 'absent cursor must use empty kind tag');
    });
});

describe('ingestCursorAt', function() {
    it('tags positioned poll cursor with cursor kind and instant', function() {
        const stamp = new Date(`2024-06-01T10:00:00.000Z`);
        const cursor = ingestCursorAt(stamp);
        assert.strictEqual(cursor.at.toISOString(), stamp.toISOString(), 'cursor tag must keep source instant');
    });
});
