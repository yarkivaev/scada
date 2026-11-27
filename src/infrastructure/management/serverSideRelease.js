// Run the synchronous deployment executor outside the HTTP process.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import executeRelease from '../deploy/executeRelease.js';

const [, , action, planPath, context, namespace, release] = process.argv;
const { values, fieldManager, prerequisites, workloads, retirements, podsAbsentBeforeApply } =
    JSON.parse(readFileSync(planPath, 'utf8'));
const chart = fileURLToPath(new URL('../../../charts/scada', import.meta.url));

function execute(binary, args, options) {
    const stdout = !options.stdio || options.stdio[1] === 'pipe' ? 'pipe' : 'ignore';
    return execFileSync(binary, args, {
        ...options, stdio: ['pipe', stdout, 'ignore'], maxBuffer: 4 * 1024 * 1024,
        timeout: action === 'check' ? 30000 : 310000, killSignal: 'SIGKILL'
    });
}

try {
    executeRelease({ chart, release, context, namespace, values, fieldManager, prerequisites,
        workloads, retirements, podsAbsentBeforeApply }, action, execute);
} catch {
    process.exitCode = 1;
}
