import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
describe('idle assignment host lifetime', () => {
    it('keeps waiting for its first assignment without an HTTP server or source connection', async function () {
        this.timeout(5000);
        const source = `import agent from './src/application/control/agent.js';
            const host = agent({nodeId:'a',
                runtime:{status(){return {tasks:[]};}},validate(){},store:{assignment(){return null;},report(){}}});
            await host.start(); process.stdout.write('started');`;
        const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
        try {
            await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', () => { reject(new Error('Agent exited before startup')); }); });
            await pause(100);
            assert.equal(child.exitCode, null);
        } finally { child.kill(); }
    });
});
