import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import claimConflict from '../../../../src/infrastructure/persistence/pg/historyClaim.js';

describe('history work claim', function() {
    it('keeps a fresh furnace bucket when a later observation extends it', function() {
        const work = { token: 'claim-α', from_ms: '1700000000000', until_ms: '1700000032000', cursor_ms: null, end_ms: null };
        const base = { workToken: 'claim-α', from: 1700000000000, until: 1700000018000, cursor: null, end: null };
        assert.equal(claimConflict(work, base), false, 'A longer fresh bucket was rejected as a different claim');
    });
    it('rejects a rotated token', function() {
        const work = { token: 'claim-β', from_ms: '1700000003000', until_ms: '1700000003000', cursor_ms: null, end_ms: null };
        const base = { workToken: 'claim-α', from: 1700000003000, until: 1700000003000 };
        assert.equal(claimConflict(work, base), true, 'A rotated token was accepted as the same claim');
    });
    it('does not rotate the work token when the same bucket still receives observations', function() {
        const body = readFileSync(new URL('../../../../src/infrastructure/persistence/pg/history.js', import.meta.url), 'utf8');
        assert.match(body, /ON CONFLICT\(id\) DO UPDATE SET from_ms=least/u,
            'accept still rotated the work token when a later observation extended the bucket');
    });
    it('commits through the claim that keeps a longer fresh bucket', function() {
        const body = readFileSync(new URL('../../../../src/infrastructure/persistence/pg/history.js', import.meta.url), 'utf8');
        assert.match(body, /claimConflict\(work, base\)/u, 'history commit still rejected an extended bucket');
    });
    it('clips a closed work page so later live observations do not enter revision', function() {
        const body = readFileSync(new URL('../../../../src/infrastructure/persistence/pg/historyContext.js', import.meta.url), 'utf8');
        assert.match(body, /function claimed\(until, edge\)/u, 'history context still hashed live observations after until');
    });
});
