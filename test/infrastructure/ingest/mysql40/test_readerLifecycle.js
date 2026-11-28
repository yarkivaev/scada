import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { reader } from '../../../../src/infrastructure/ingest/mysql40/packets.js';

describe('MySQL 4.0 reader lifecycle', () => {
    for (const event of ['end', 'close']) {
        it(`rejects pending and future reads after ${event}`, async () => {
            const socket = new EventEmitter();
            const take = reader(socket);
            const pending = take(4);
            socket.emit(event);
            await assert.rejects(pending, /closed/u);
            await assert.rejects(take(4), /closed/u);
        });
    }
    it('rejects oversized buffered input and fails the reader', async () => {
        const socket = new EventEmitter();
        const take = reader(socket, { maxBytes: 8, timeoutMs: 10 });
        const pending = take(4);
        socket.emit('data', Buffer.alloc(9));
        await assert.rejects(pending, /capacity/u);
    });
    it('times out a partial packet', async () => {
        const take = reader(new EventEmitter(), { timeoutMs: 5 });
        await assert.rejects(take(4), /timed out/u);
    });
});
