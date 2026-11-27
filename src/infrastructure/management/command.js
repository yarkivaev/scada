import { execFile } from 'node:child_process';

/**
 * Invoke a trusted binary without a shell. Keep subprocess diagnostics out of
 * API responses because tools may include runtime credentials or rendered values.
 */
export default function command(binary, args, timeout = 30000, env = process.env) {
    return new Promise((resolve, reject) => {
        execFile(binary, args, { timeout, env, maxBuffer: 4 * 1024 * 1024 },
            (error, stdout) => {
                if (error) {
                    reject(new Error(`${binary} ${args[0]} failed (${error.code ?? error.signal ?? 'runtime error'})`));
                } else {
                    resolve(stdout);
                }
            });
    });
}
