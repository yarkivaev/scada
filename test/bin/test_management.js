import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
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

async function serve(directory, contexts, extraEnv = {}, flags = [], { system, observations } = {}) {
    const config = join(directory, 'config.json');
    await writeFile(config, JSON.stringify({ contexts, system, observations }));
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

    it('shows the production document before runtime details and preserves declared flows', async () => {
        await writeFile(join(directory, 'objects.yaml'), `namespace:
  - id: mill
    nodes:
      - id: hall
        nodes:
          - id: unit
            nodes:
              - id: speed
profiles:
  cell:
    variables:
      cluster: sample
`);
        await writeFile(join(directory, 'plant.yaml'), `include:
  - objects.yaml
servers:
  - id: cell
    profile:
      id: cell
    objects:
      - mill/hall/unit
    fan_in:
      - from: modbus://example.invalid:502
        name: mill/hall/unit/speed
    fan_out:
      - to: archive
        name: mill/hall/unit/speed
  - id: archive
    profile:
      id: cell
`);
        await tool(directory, 'systemctl', "process.stdout.write('LoadState=loaded\\nActiveState=active\\n');");
        await tool(directory, 'kubectl', 'process.exit(1);');
        const target = { runtime: 'systemd', units: { 'reader.service': 'running' } };
        const context = { runtime: 'kubernetes', kubeContext: 'lab', namespace: 'plant', release: 'archive' };
        const api = await serve(directory, { reader: target, archive: context }, {}, [], {
            system: { file: 'plant.yaml', sites: { cell: ['reader'] } }
        });
        servers.push(api);
        const result = await api.run(['status'], readToken).catch(({ stdout, code }) => {
            assert.equal(code, 1);
            return JSON.parse(stdout);
        });
        assert.deepEqual(result.topology.namespace, ['mill', 'mill/hall', 'mill/hall/unit', 'mill/hall/unit/speed']);
        assert.deepEqual(result.topology.sites.map(({ name, state }) => { return [name, state]; }),
            [['cell', 'ready'], ['archive', 'unknown']]);
        assert.deepEqual(result.topology.flows, [{
            from: 'cell', to: 'archive', streams: ['mill/hall/unit/speed'], traffic: 'unknown', evidence: []
        }]);
        assert.equal(result.topology.state, 'unknown');
        const scoped = await api.run(['status', '--context', 'cell'], readToken);
        assert.deepEqual(scoped.topology.sites.map(({ name }) => { return name; }), ['cell']);
        const { stdout } = await exec(process.execPath, [cli, 'status', '--server', api.server], {
            env: { ...process.env, SCADA_TOKEN: readToken }
        }).catch((error) => { return error; });
        assert.match(stdout, /^Production.*unknown/mu);
        assert.match(stdout, /cell -> archive/u);
        assert.doesNotMatch(stdout, /reader\.service/u);
        assert.deepEqual(await api.run(['get', 'components', '--context', 'reader']), {
            contexts: [{ name: 'reader', components: [{ id: 'reader.service', state: 'ready' }] }]
        });
        await tool(directory, 'systemctl', "process.stdout.write('LoadState=loaded\\nActiveState=inactive\\n');");
        await assert.rejects(api.run(['status', '--context', 'reader']), (error) => {
            return error.code === 1 && JSON.parse(error.stdout).topology.state === 'degraded';
        });
    });

    it('shows observed flow acknowledgements separately from broker queue backlog', async () => {
        const unsafeQueue = 'scada.zz\u001b\u202e';
        const broker = createServer((req, res) => {
            const url = new URL(req.url, 'http://localhost');
            assert.equal(req.method, 'GET');
            assert.equal(url.pathname, '/api/queues/%2F');
            assert.equal(req.headers.authorization, 'Basic b3A6cmVhZA==');
            assert.equal(url.searchParams.get('name'), '^scada\\.');
            const page = Number(url.searchParams.get('page'));
            res.end(JSON.stringify({ page_count: 2, items: page === 1 ? [{
                name: 'scada.speed.outbox', messages_ready: 6, messages_unacknowledged: 3, consumers: 1,
                message_stats: { ack_details: { rate: 2.2 }, publish_details: { rate: 3.4 } }
            }] : [{
                name: 'scada.quiet.outbox', messages_ready: 1, messages_unacknowledged: 0, consumers: 1,
                message_stats: { ack_details: { rate: 0 } }
            }, {
                name: 'scada.shared.outbox', messages_ready: 0, messages_unacknowledged: 0, consumers: 2,
                message_stats: { ack_details: { rate: 99 } }
            }, { name: unsafeQueue, messages_ready: 0, messages_unacknowledged: 0 },
            { name: 'unmanaged', messages_ready: 100 }] }));
        });
        broker.listen(0, '127.0.0.1');
        await once(broker, 'listening');
        try {
            await writeFile(join(directory, 'plant.yaml'), `namespace:
  - id: mill
profiles:
  cell:
    variables:
      cluster: sample
servers:
  - id: cell
    profile:
      id: cell
  - id: archive
    profile:
      id: cell
`);
            const observations = { rabbitmq: { source: {
                site: 'cell', url: `http://127.0.0.1:${broker.address().port}`,
                prefix: 'scada.', username: 'op', passwordEnv: 'BROKER_PASSWORD'
            } }, links: [
                { from: 'cell', to: 'archive', broker: 'source', queue: 'scada.speed.outbox' },
                { from: 'cell', to: 'archive', broker: 'source', queue: 'scada.quiet.outbox' },
                { from: 'cell', to: 'archive', broker: 'source', queue: 'scada.shared.outbox' }
            ] };
            const api = await serve(directory, {}, { BROKER_PASSWORD: 'read' }, [], { system: { file: 'plant.yaml' }, observations });
            servers.push(api);
            const status = await api.run(['status']).catch(({ stdout, code }) => {
                assert.equal(code, 1);
                return JSON.parse(stdout);
            });
            const [link] = status.topology.flows;
            assert.equal(link.traffic, 'flowing');
            assert.deepEqual(link.evidence.map(({ traffic }) => { return traffic; }), ['flowing', 'idle', 'unknown']);
            const { load: snapshot } = await api.run(['load', '--context', 'cell'], readToken);
            assert.deepEqual(snapshot.brokers[0].queues.map(({ name, ready, unacked }) => { return [name, ready, unacked]; }),
                [['scada.speed.outbox', 6, 3], ['scada.quiet.outbox', 1, 0], ['scada.shared.outbox', 0, 0], [unsafeQueue, 0, 0]]);
            const { stdout } = await exec(process.execPath, [cli, 'load', '--server', api.server], {
                env: { ...process.env, SCADA_TOKEN: readToken }, timeout: 5000
            });
            assert.equal(stdout.includes(unsafeQueue), false);
            assert.ok(stdout.includes(String.raw`scada.zz\u{1b}\u{202e}`));
        } finally {
            broker.close();
        }
    });

    it('uses the existing component status contract with an older gateway', async () => {
        const commands = [];
        const gateway = createServer(async (req, res) => {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const command = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            commands.push(command);
            if (command.action === 'status') {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'invalid management command' }));
                return;
            }
            res.end(JSON.stringify({ contexts: [{
                name: 'edge', components: [{ id: 'reader.service', state: 'ready' }]
            }] }));
        });
        gateway.listen(0, '127.0.0.1');
        await once(gateway, 'listening');
        try {
            const { stdout } = await exec(process.execPath, [cli, 'status', '--context', 'edge',
                '--server', `http://127.0.0.1:${gateway.address().port}`], {
                env: { ...process.env, SCADA_TOKEN: readToken }, timeout: 5000
            });
            assert.match(stdout, /edge\treader\.service\tready/u);
            assert.deepEqual(commands, [{ action: 'status', context: 'edge' }, { action: 'components', context: 'edge' }]);
        } finally {
            gateway.close();
        }
    });

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
