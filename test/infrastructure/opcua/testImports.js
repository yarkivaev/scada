import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

describe('OPC UA lazy runtime', function () {
    it('keeps root import and factory validation free of node-opcua loading', function () {
        // Give the child its configured 15-second import timeout.
        this.timeout(16000);
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
            import { createRequire } from 'node:module';
            import './index.js';
            import opcuaSource from './src/infrastructure/opcua/source.js';
            import { validateConnections } from './src/infrastructure/opcua/config.js';
            const require = createRequire(import.meta.url);
            opcuaSource([], { accept() {} });
            process.stdout.write(JSON.stringify({ loaded: Object.keys(require.cache).some(path => path.includes('node-opcua')), validated: validateConnections([]) }));
        `], { encoding: 'utf8', timeout: 15000 });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), { loaded: false, validated: [] });
    });
});
