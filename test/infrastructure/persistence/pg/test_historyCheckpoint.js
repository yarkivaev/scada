import assert from 'node:assert/strict';
import { classifierPage } from '../../../../src/infrastructure/persistence/pg/historyCheckpoint.js';

describe('classifier history pages', function() {
    it('does not split a page on an invalidated checkpoint', async function() {
        const statements = [];
        const pool = {
            async query(sql) {
                statements.push(sql);
                return { rowCount: 0, rows: [] };
            }
        };
        await classifierPage(pool, 'см-α', { from: 1000, until: 5000, next: null, end: 5000 }, 'key-α');
        assert.match(statements.join('\n'), /AND valid AND time_ms BETWEEN/u,
            'classifierPage still split on invalidated checkpoints');
    });
});
