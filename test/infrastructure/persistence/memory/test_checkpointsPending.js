import assert from 'assert';
import checkpointStateMemory from '../../../../src/infrastructure/persistence/memory/checkpoints.js';

describe('checkpointStateMemory pending segments', function() {
    it('lists heartbeated open rows where end is past start', function() {
        const machine = `ičt-${Math.random().toString(36).slice(2)}`;
        const start = '2024-06-01T10:00:00.000Z';
        const end = '2024-06-01T10:00:45.000Z';
        const store = {
            segments: [{
                machine,
                name: 'on',
                start_time: start,
                end_time: end,
                duration: 0,
                tags: null,
                options: null,
                properties: null
            }],
            metrics: []
        };
        const items = checkpointStateMemory(store).pendingSegments();
        assert.deepStrictEqual(
            items,
            [{
                machine,
                name: 'on',
                start: Date.parse(start) / 1000,
                end: Date.parse(end) / 1000
            }],
            'heartbeated pending row was not returned by checkpoint'
        );
    });

    it('excludes silence-closed rows from pending list', function() {
        const machine = `ičt-${Math.random().toString(36).slice(2)}`;
        const store = {
            segments: [{
                machine,
                name: 'on',
                start_time: '2024-06-01T11:00:00.000Z',
                end_time: '2024-06-01T11:00:30.000Z',
                duration: 30,
                tags: null,
                options: null,
                properties: null
            }],
            metrics: []
        };
        const items = checkpointStateMemory(store).pendingSegments();
        assert.strictEqual(items.length, 0, 'closed segment was still listed as pending');
    });
});
