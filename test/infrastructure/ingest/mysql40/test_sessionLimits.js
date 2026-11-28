import assert from 'node:assert/strict';
import mysql40 from '../../../../src/infrastructure/ingest/mysql40/mysql40.js';

describe('MySQL 4.0 session limits', () => {
    it('rejects aborted query before connecting', async () => {
        const controller = new AbortController();
        controller.abort(new Error('revoked'));
        const reader = mysql40({ host: '127.0.0.1', port: 1, signal: controller.signal });
        await assert.rejects(reader.query('SELECT 1'), /revoked/u);
    });
    it('validates packet limits before connecting', () => {
        assert.throws(() => {return mysql40({ maxPackets: 0 })}, /limits/u);
    });
});
