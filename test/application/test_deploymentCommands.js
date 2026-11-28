import assert from 'node:assert/strict';
import deploymentCommands from '../../src/application/deploy/deploymentCommands.js';

describe('declarative deployment commands', () => {
    it('selects only the declared actions on a registered module', () => {
        const run = deploymentCommands({ edge: { plugin: 'fixture', plan: true } }, {
            fixture: {
                plan(options) { return options; },
                deploy() { assert.fail('undeclared mutation'); }
            }
        });
        assert.deepEqual(run('edge', 'plan', { node: 'demo' }), { node: 'demo' });
        assert.throws(() => { run('edge', 'deploy'); }, /Unsupported deployment command/u);
    });

    it('rejects an unregistered or incomplete module', () => {
        assert.throws(() => { deploymentCommands({ edge: { plugin: 'constructor', plan: true } }, {}); }, /Unknown deployment plugin/u);
        assert.throws(() => { deploymentCommands({ edge: { plugin: 'fixture', deploy: true } }, { fixture: {} }); }, /does not implement deploy/u);
    });
});
