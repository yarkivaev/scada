import assert from 'node:assert';
import { describe, it } from 'mocha';
import ingestCheckpointMemory from '../../../src/infrastructure/ingest/ingestCheckpoint.js';

describe('ingestCheckpointMemory', () => {
    it('returns null cursor when checkpoint was never written', async () => {
        const store = { checkpoints: [] };
        const port = ingestCheckpointMemory(store);
        const cursor = await port.read(`src-${Math.random()}`, 'icht1');
        assert.strictEqual(cursor, null, 'missing checkpoint must read as null');
    });

    it('persists cursor for source and machine pair', async () => {
        const store = { checkpoints: [] };
        const port = ingestCheckpointMemory(store);
        const source = `czl-${Math.random().toString(36).slice(2)}`;
        const stamp = new Date('2024-06-01T10:00:00.000Z');
        await port.write(source, 'icht2', stamp);
        const cursor = await port.read(source, 'icht2');
        assert.strictEqual(cursor.toISOString(), stamp.toISOString(), 'written cursor must survive read');
    });

    it('overwrites prior cursor on repeated write', async () => {
        const store = { checkpoints: [] };
        const port = ingestCheckpointMemory(store);
        const source = `czl-${Math.random().toString(36).slice(2)}`;
        await port.write(source, 'icht4', new Date('2024-06-01T09:00:00.000Z'));
        const next = new Date('2024-06-01T12:00:00.000Z');
        await port.write(source, 'icht4', next);
        const cursor = await port.read(source, 'icht4');
        assert.strictEqual(cursor.toISOString(), next.toISOString(), 'second write must replace cursor');
    });
});
