import assert from 'node:assert/strict';
import { classifierClaim, classifierPage } from '../../../../src/infrastructure/persistence/pg/historyCheckpoint.js';

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
    it('keeps a longer fresh bucket as the same classifier claim', async function() {
        const pool = {
            async query() {
                return { rowCount: 1, rows: [{
                    classifier_checkpoint: null, started: false, token: 'claim-α',
                    from_ms: '1700000000000', until_ms: '1700000032000', cursor_ms: null, end_ms: null
                }] };
            }
        };
        const row = await classifierClaim(pool, 'см-α', {
            workId: 'work-α', workToken: 'claim-α', from: 1700000000000, until: 1700000018000, cursor: null, end: null
        });
        assert.equal(row.until_ms, '1700000032000', 'A longer fresh bucket was rejected as a different claim');
    });
});
