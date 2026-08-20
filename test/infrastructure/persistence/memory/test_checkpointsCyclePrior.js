import assert from 'assert';
import checkpointStateMemory from '../../../../src/infrastructure/persistence/memory/checkpoints.js';

describe('checkpointStateMemory cyclePrior', function() {
    it('returns rows until a reset tag and not older ones', async function() {
        const machine = `ičt-${Math.random().toString(36).slice(2)}`;
        const reset = `якорь-${Math.floor(Math.random() * 9000 + 1000)}`;
        const store = {
            segments: [
                {
                    machine,
                    name: 'off',
                    start_time: '2026-08-20T10:00:00.000Z',
                    end_time: '2026-08-20T10:10:00.000Z',
                    duration: 600,
                    tags: JSON.stringify(['to_ladle']),
                    options: null,
                    properties: null
                },
                {
                    machine,
                    name: 'off',
                    start_time: '2026-08-20T04:16:06.589Z',
                    end_time: '2026-08-20T04:33:22.543Z',
                    duration: 1035,
                    tags: JSON.stringify([reset]),
                    options: null,
                    properties: null
                },
                {
                    machine,
                    name: 'off',
                    start_time: '2026-08-19T12:00:00.000Z',
                    end_time: '2026-08-19T13:00:00.000Z',
                    duration: 3600,
                    tags: JSON.stringify(['repair_planned']),
                    options: null,
                    properties: null
                }
            ],
            metrics: []
        };
        const before = Date.parse('2026-08-20T12:29:24.318Z') / 1000;
        const items = await checkpointStateMemory(store).cyclePrior(machine, before, [reset]);
        assert.deepStrictEqual(
            items.map((item) => {
                return item.tags;
            }),
            [[reset], ['to_ladle']],
            'cyclePrior walked past the reset tag'
        );
    });
});
