import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const cli = fileURLToPath(new URL('../../src/bin/scada.js', import.meta.url));
const exec = promisify(execFile);
const token = 'management-test-token';
const readToken = 'management-read-token';

async function tool(directory, name, body) {
    await writeFile(join(directory, name), `#!/usr/bin/env node\n${body}`, { mode: 0o755 });
}

async function serve(directory, contexts, extraEnv = {}, flags = []) {
    const config = join(directory, 'config.json');
    await writeFile(config, JSON.stringify({ contexts }));
    const child = spawn(process.execPath, [cli, 'serve', '--config', config, '--port', '0', ...flags], {
        env: { ...process.env, SCADA_TOKEN: token, SCADA_READ_TOKEN: readToken,
            PATH: `${directory}:${process.env.PATH}`, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let errors = '';
    child.stderr.on('data', (chunk) => { errors += chunk; });
    const server = await new Promise((resolve, reject) => {
        child.stdout.once('data', (chunk) => { resolve(String(chunk).trim()); });
        child.once('close', (code) => { reject(new Error(`management server exited ${code}: ${errors}`)); });
        child.once('error', reject);
    });
    return {
        server,
        close() {
            child.kill();
        },
        run(args, auth = token) {
            return exec(process.execPath, [cli, ...args, '--server', server, '--output', 'json'], {
                env: { ...process.env, ...extraEnv, SCADA_TOKEN: auth },
                timeout: 5000
            }).then(({ stdout }) => { return JSON.parse(stdout); });
        }
    };
}

async function awaitFile(path) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        // The runtime fake signals after the first mutation starts.
        // eslint-disable-next-line no-await-in-loop
        const value = await readFile(path, 'utf8').catch(() => { return ''; });
        if (value) {
            return value;
        }
        // eslint-disable-next-line no-await-in-loop
        await delay(20);
    }
    throw new Error('expected file was not written');
}

describe('SCADA management over HTTP', function () {
    this.timeout(10000);
    let directory;
    let servers;

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'scada-management-'));
        servers = [];
    });

    afterEach(async () => {
        servers.forEach((server) => { server.close(); });
        await rm(directory, { recursive: true, force: true });
    });

    async function launch(contexts, env, flags) {
        const server = await serve(directory, contexts, env, flags);
        servers.push(server);
        return server;
    }

    it('lists SCADA workloads in one Kubernetes context and reports a failing target separately', async () => {
        await tool(directory, 'kubectl', `
            const args = process.argv.slice(2);
            if (args.includes('--context=offline')) process.exit(1);
            if (!args.includes('--namespace=plant') ||
                !args.includes('app.kubernetes.io/name=scada,app.kubernetes.io/instance=mill')) process.exit(2);
            process.stdout.write(JSON.stringify({ items: [{
                kind: 'Deployment', metadata: { name: 'mill-agent', generation: 1 },
                spec: { replicas: 1 }, status: { observedGeneration: 1, availableReplicas: 1, updatedReplicas: 1 }
            }] }));
        `);
        const target = { runtime: 'kubernetes', kubeContext: 'k3s', namespace: 'plant', release: 'mill' };
        const api = await launch({ mill: target, lost: { ...target, kubeContext: 'offline' } });
        const result = await api.run(['get', 'components'], readToken);
        assert.deepEqual(result.contexts[0], {
            name: 'mill', components: [{ id: 'deployment/mill-agent', state: 'ready' }]
        });
        assert.equal(result.contexts[1].name, 'lost');
        assert.match(result.contexts[1].error, /kubectl/u);
        await assert.rejects(api.run(['status']), { code: 1 });
    });

    it('keeps a rolling Deployment pending while an old replica still serves traffic', async () => {
        await tool(directory, 'kubectl', `
            process.stdout.write(JSON.stringify({ items: [{
                kind: 'Deployment', metadata: { name: 'mill-agent', generation: 2 },
                spec: { replicas: 1 }, status: { observedGeneration: 2, availableReplicas: 1,
                    updatedReplicas: 1, replicas: 2 }
            }] }));
        `);
        const api = await launch({ mill: { runtime: 'kubernetes', kubeContext: 'k3s',
            namespace: 'plant', release: 'mill' } });
        const result = await api.run(['get', 'components'], readToken);
        assert.equal(result.contexts[0].components[0].state, 'pending');
    });

    it('plans and applies a local systemd target over the network with separate read credentials', async () => {
        const state = join(directory, 'state');
        await tool(directory, 'systemctl', `
            const fs = require('node:fs');
            const args = process.argv.slice(2);
            if (args.at(-1) !== 'collector.service') process.exit(2);
            if (args[0] === 'show') process.stdout.write('LoadState=loaded\\nActiveState=' +
                (fs.existsSync(${JSON.stringify(state)}) ? 'active' : 'inactive') + '\\n');
            else if (args[0] === 'start') fs.writeFileSync(${JSON.stringify(state)}, 'active');
            else process.exit(2);
        `);
        await tool(directory, 'journalctl', "process.stdout.write('collector log');");
        const api = await launch({ edge: { runtime: 'systemd', units: { 'collector.service': 'running' } } });
        assert.deepEqual(await api.run(['plan', '--context', 'edge'], readToken),
            { changes: [{ id: 'collector.service', action: 'start' }] });
        await assert.rejects(api.run(['apply', '--context', 'edge'], readToken), /forbidden/u);
        await assert.rejects(api.run(['contexts'], 'wrong'), /unauthorized/u);
        await api.run(['apply', '--context', 'edge']);
        assert.deepEqual(await api.run(['status']), { contexts: [{
            name: 'edge', components: [{ id: 'collector.service', state: 'ready' }]
        }] });
        assert.deepEqual(await api.run(['logs', 'collector.service', '--context', 'edge']),
            { logs: 'collector log' });
        await assert.rejects(api.run(['logs', 'unmanaged.service', '--context', 'edge']), /unknown component/u);
    });

    it('rejects concurrent applies to an overlapping unit through context aliases and allows a clean retry', async () => {
        const started = join(directory, 'started');
        const released = join(directory, 'released');
        await tool(directory, 'systemctl', `
            const fs = require('node:fs');
            const started = ${JSON.stringify(started)};
            const released = ${JSON.stringify(released)};
            if (process.argv[2] === 'show') {
                const state = fs.existsSync(released) ? 'active' : 'inactive';
                process.stdout.write('LoadState=loaded\\nActiveState=' + state + '\\n');
            } else {
                const repeat = fs.existsSync(started);
                fs.appendFileSync(started, 'start\\n');
                if (repeat) process.exit(0);
                const guard = setTimeout(() => process.exit(1), 4500);
                const wait = setInterval(() => {
                    if (fs.existsSync(released)) {
                        clearTimeout(guard);
                        clearInterval(wait);
                    }
                }, 20);
            }
        `);
        const target = { runtime: 'systemd', units: { 'collector.service': 'running' } };
        const api = await launch({ edge: target, alias: target });
        const args = ['apply', '--context', 'edge'];
        const first = api.run(args);
        try {
            await awaitFile(started);
            await assert.rejects(api.run(['apply', '--context', 'alias']), /already in progress/u);
        } finally {
            await writeFile(released, 'ready');
            await first;
        }
        assert.deepEqual(await api.run(args), { changes: [] });
        assert.equal(await readFile(started, 'utf8'), 'start\n');
    });

    it('rejects malformed and oversized commands at the API boundary', async () => {
        const api = await launch({});
        const url = `${api.server}/api/management/v1/command`;
        const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
        const responses = await Promise.all(['{', JSON.stringify({ action: 'contexts', extra: true }),
            ' '.repeat(8193)].map((body) => { return fetch(url, { method: 'POST', headers, body }); }));
        assert.deepEqual(responses.map(({ status }) => { return status; }), [400, 400, 400]);
        assert.deepEqual(await api.run(['contexts']), { contexts: [] });
    });

    it('queries a remote management node through a named context', async () => {
        await tool(directory, 'systemctl', "process.stdout.write('LoadState=loaded\\nActiveState=active\\n');");
        const edge = await launch({ local: { runtime: 'systemd', units: { 'collector.service': 'running' } } });
        const hub = await launch({ edge: { runtime: 'remote', server: edge.server, context: 'local',
            tokenEnv: 'EDGE_TOKEN' } }, { EDGE_TOKEN: readToken });
        assert.deepEqual(await hub.run(['status']), { contexts: [{
            name: 'edge', components: [{ id: 'collector.service', state: 'ready' }]
        }] });
        await assert.rejects(hub.run(['apply', '--context', 'edge']), /forbidden/u);
    });

    it('plans and applies through Helm with explicit scope and server-owned release values', async () => {
        const values = join(directory, 'release.yaml');
        await writeFile(values, 'image: registry.example/plant:1');
        await tool(directory, 'helm', `
            const args = process.argv.slice(2);
            const options = ['upgrade', '--install', 'mill', '--kube-context=k3s', '--namespace=plant',
                '--values=' + ${JSON.stringify(values)}];
            if (!options.every((option) => args.includes(option))) process.exit(2);
            if (process.env.HELM_KUBEAPISERVER) process.exit(4);
            const writes = args.includes('--atomic');
            const previews = args.includes('--dry-run=server') && args.includes('--hide-secret');
            if (writes === previews) process.exit(3);
            process.stdout.write('private-rendered-values');
        `);
        const api = await launch({ mill: { runtime: 'kubernetes', kubeContext: 'k3s',
            namespace: 'plant', release: 'mill', values: 'release.yaml' } }, { HELM_KUBEAPISERVER: 'https://127.0.0.1:1' });
        const expected = { changes: [{ id: 'mill', action: 'reconcile' }] };
        assert.deepEqual(await api.run(['plan', '--context', 'mill'], readToken), expected);
        assert.deepEqual(await api.run(['apply', '--context', 'mill']), expected);
    });

    it('reconciles an existing server-side release through the existing release executor', async () => {
        const calls = join(directory, 'calls');
        await writeFile(join(directory, 'release.json'), JSON.stringify({
            fieldManager: 'plant-release', values: { image: 'registry.example/plant:1' },
            workloads: ['deployment/mill-site-server']
        }));
        await tool(directory, 'helm', "process.stdout.write('kind: Deployment');");
        await tool(directory, 'kubectl', `
            const fs = require('node:fs');
            const args = process.argv.slice(2);
            if (args.slice(0, 4).join(' ') !== '--context k3s --namespace plant') process.exit(2);
            if (args[4] === 'apply' && fs.readFileSync(0, 'utf8') !== 'kind: Deployment') process.exit(3);
            fs.appendFileSync(${JSON.stringify(calls)}, args.slice(4).join(' ') + '\\n');
        `);
        const api = await launch({ mill: { runtime: 'kubernetes', kubeContext: 'k3s',
            namespace: 'plant', release: 'mill', releasePlan: 'release.json' } });
        await api.run(['plan', '--context', 'mill'], readToken);
        await api.run(['apply', '--context', 'mill']);
        const dryRun = 'apply --server-side --field-manager=plant-release -f - --dry-run=server';
        assert.deepEqual((await readFile(calls, 'utf8')).trim().split('\n'), [
            dryRun, dryRun, 'apply --server-side --field-manager=plant-release -f -',
            'rollout status deployment/mill-site-server --timeout=300s'
        ]);
    });

    it('uses verified TLS when connecting from the CLI over the network', async () => {
        const cert = join(directory, 'cert.pem');
        const key = join(directory, 'key.pem');
        await exec('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-x509',
            '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-days', '1',
            '-keyout', key, '-out', cert]);
        const target = { runtime: 'systemd', units: { 'collector.service': 'running' } };
        const api = await launch({ edge: target }, { NODE_EXTRA_CA_CERTS: cert }, ['--cert', cert, '--key', key]);
        const args = ['contexts', '--server', api.server];
        assert.match(api.server, /^https:/u);
        await assert.rejects(exec(process.execPath, [cli, ...args], {
            env: { ...process.env, NODE_EXTRA_CA_CERTS: '', SCADA_TOKEN: token }
        }), /fetch failed/u);
        await assert.rejects(exec(process.execPath, [cli, ...args], {
            env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0', SCADA_TOKEN: token }
        }), /requires TLS certificate verification/u);
        assert.deepEqual(await api.run(['contexts']), { contexts: [{ name: 'edge', runtime: 'systemd' }] });
    });

    it('rejects configuring an identical read token and write token', async () => {
        await assert.rejects(launch({}, { SCADA_READ_TOKEN: token }), /credentials must differ/u);
    });

    it('rejects exposing a plaintext listener to the network', async () => {
        await assert.rejects(launch({}, {}, ['--host', '0.0.0.0']), /non-loopback listener requires/u);
    });
});
