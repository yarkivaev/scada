import assert from 'node:assert/strict';
import { classifierClaim, classifierPage } from '../../../../src/infrastructure/persistence/pg/historyCheckpoint.js';

describe('classifier history pages', function() {
    it('does not reject a first-page retry that omitted the stored envelope', async function() {
        const pool = {
            async query() {
                return { rowCount: 1, rows: [{
                    classifier_checkpoint: null, started: true,
                    from_ms: '1000', until_ms: '5000', cursor_ms: null, end_ms: '9000'
                }] };
            }
        };
        const row = await classifierClaim(pool, 'см-α', {
            workId: 'work-α', workToken: 'token-α', from: 1000, until: 5000, cursor: null, end: null
        });
        assert.equal(Number(row.end_ms), 9000, 'a stored envelope still conflicted a first-page retry');
    });
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
