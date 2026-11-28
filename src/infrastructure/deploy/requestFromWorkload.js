const requestProgram = `
import { readFileSync } from 'node:fs';
const { url, method, tokenEnv, configuration, body, requireApplied } = JSON.parse(readFileSync(0, 'utf8'));
if (configuration) {
    const file = process.env[configuration.pathEnv] || configuration.defaultPath;
    const deployed = JSON.parse(readFileSync(file, 'utf8'));
    if (JSON.stringify(deployed) !== JSON.stringify(configuration.expected)) {
        throw new Error(configuration.mismatch);
    }
}
const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + process.env[tokenEnv] };
const response = await fetch(url, { method, headers, redirect: 'error', ...(body !== undefined && { body: JSON.stringify(body) }) });
const result = await response.text();
if (!response.ok || (requireApplied && JSON.parse(result).applied !== true)) {
    process.stderr.write(result + '\\n');
    process.exitCode = 1;
} else {
    process.stdout.write(result + '\\n');
}
`;

/** Send a protected loopback request inside a running workload with optional config fencing. */
export default function requestFromWorkload(kube, { workload, url, method, tokenEnv, configuration, body, requireApplied }) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password) {
        throw new TypeError('Workload request requires an HTTP loopback endpoint');
    }
    const input = JSON.stringify({ url, method, tokenEnv, configuration, body, requireApplied });
    return kube(['exec', '-i', workload, '--', 'node', '--input-type=module', '-e', requestProgram], input);
}
