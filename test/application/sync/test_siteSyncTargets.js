import assert from 'assert';
import { readFileSync } from 'node:fs';

describe('siteSyncTargets', function () {
    it('folds segments before the local postgres write', function () {
        const body = readFileSync(new URL('../../../src/application/sync/siteSyncTargets.js', import.meta.url), 'utf8');
        assert.match(body, /foldingSegments\(/u,
            'siteSync still wrote raw remote segments without folding');
    });
});
