import { execFileSync } from 'node:child_process';

function capabilities({ image, role, entrypoint, args = [] }, subject, execute) {
    let result;
    try {
        const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 };
        const output = execute('docker', ['run', '--rm', '--read-only', '--network=none', '--tmpfs', '/tmp', '--entrypoint', entrypoint, image, ...args], options);
        result = JSON.parse(String(output));
    } catch {
        throw new Error(`Unable to verify ${subject} ${role} candidate`);
    }
    return result;
}

/** Probe isolated runtime images and require common capabilities declared by the profile. */
export default function verifyRuntimeCapabilities({ candidates, required, match, subject = 'runtime',
    mismatch = 'Runtime candidates must support the same protocol' }, execute = execFileSync) {
    const results = new Map();
    for (const candidate of candidates) {
        const result = capabilities(candidate, subject, execute);
        if (result?.role !== candidate.role || !Array.isArray(result.historyProtocols)
            || required.some((protocol) => { return !result.historyProtocols.includes(protocol); })) {
            throw new Error(`Incompatible ${subject} ${candidate.role} candidate`);
        }
        results.set(candidate.role, result.historyProtocols);
    }
    if (match) {
        const preferred = match.roles.map((role) => {
            if (!results.has(role)) { throw new Error(`Missing runtime candidate role ${role}`); }
            return match.preference.find((protocol) => { return results.get(role).includes(protocol); });
        });
        if (new Set(preferred).size !== 1) { throw new Error(mismatch); }
    }
}
