import assert from 'assert';
import ingestCheckpointMemory from '../../../src/infrastructure/ingest/ingestCheckpoint.js';

describe('ingestCheckpointMemory read', function() {
    it('returns empty cursor when checkpoint was never written', async function() {
        const store = { checkpoints: [] };
        const port = ingestCheckpointMemory(store);
        const cursor = await port.read(`src-${Math.random()}`, 'm1');
        assert.strictEqual(cursor.kind, 'empty', 'missing checkpoint must read as empty cursor');
    });
});

describe('ingestCheckpointMemory write', function() {
    it('persists cursor for source and machine pair', async function() {
        const store = { checkpoints: [] };
        const port = ingestCheckpointMemory(store);
        const source = `czl-${Math.random().toString(36).slice(2)}`;
        const stamp = new Date('2024-06-01T10:00:00.000Z');
        await port.write(source, 'm2', stamp);
        const cursor = await port.read(source, 'm2');
        assert.strictEqual(cursor.at.toISOString(), stamp.toISOString(), 'written cursor must survive read');
    });

    it('overwrites prior cursor on repeated write', async function() {
        const store = { checkpoints: [] };
        const port = ingestCheckpointMemory(store);
        const source = `czl-${Math.random().toString(36).slice(2)}`;
        await port.write(source, 'm4', new Date('2024-06-01T09:00:00.000Z'));
        const next = new Date('2024-06-01T12:00:00.000Z');
        await port.write(source, 'm4', next);
        const cursor = await port.read(source, 'm4');
        assert.strictEqual(cursor.at.toISOString(), next.toISOString(), 'second write must replace cursor');
    });
});
