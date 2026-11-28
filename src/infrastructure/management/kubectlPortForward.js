import { spawn } from 'node:child_process';

function forwardedPort(child, timeout) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('Port forward timeout')); }, timeout);
        let output = '';
        function failed() { clearTimeout(timer); reject(new Error('Port forward stopped')); }
        child.once('error', failed);
        child.once('exit', failed);
        child.stdout.on('data', (chunk) => {
            output = (output + chunk.toString()).slice(-4096);
            const match = /Forwarding from 127[.]0[.]0[.]1:(?<port>\d+)/u.exec(output);
            if (match) { clearTimeout(timer); resolve(Number(match.groups.port)); }
        });
    });
}

/** Invoke an operation over a temporary, loopback-only port owned by this process. */
export async function kubectlPortForward({ context, namespace, target, port, timeout = 15000 }, use) {
    const child = spawn('kubectl', ['--context', context, '--namespace', namespace, 'port-forward',
        target, `:${port}`, '--address=127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.resume();
    try {
        const forwarded = await forwardedPort(child, timeout);
        return await use(`http://127.0.0.1:${forwarded}`);
    } finally { child.kill('SIGTERM'); }
}
