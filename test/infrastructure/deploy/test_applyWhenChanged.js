import assert from 'node:assert/strict';
import applyWhenChanged from '../../../src/infrastructure/deploy/applyWhenChanged.js';

function record(log, status) {
    return (program, args) => {
        log.push({ program, args: [...args] });
        if (args.includes('diff') && status !== 0) {
            const error = new Error('objects differ');
            error.status = status;
            throw error;
        }
        return '';
    };
}

describe('applyWhenChanged', () => {
    it('skips kubectl apply when live objects already match', () => {
        const log = [];
        applyWhenChanged(record(log, 0))('kubectl', ['apply', '--server-side', '-f', '-'], { input: 'kind: List' });
        assert.equal(log.some((row) => { return row.args.includes('apply'); }), false, 'matching apply still wrote');
    });
    it('applies when server-side diff reports a change', () => {
        const log = [];
        applyWhenChanged(record(log, 1))('kubectl', ['apply', '--server-side', '-f', '-']);
        assert.equal(log.some((row) => { return row.args.includes('apply'); }), true, 'changed objects were not applied');
    });
    it('leaves server-side dry-run apply untouched', () => {
        const log = [];
        applyWhenChanged(record(log, 0))('kubectl', ['apply', '--server-side', '--dry-run=server', '-f', '-']);
        assert.deepEqual(log[0].args, ['apply', '--server-side', '--dry-run=server', '-f', '-']);
    });
});
