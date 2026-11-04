import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { controlClient, controlStore } from '../../src/application/control/index.js';
function docker(...args) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
const network = `control-quorum-${process.pid}`;
const names = [0, 1, 2].map((index) => { return `${network}-${index}`; });
const cluster = names.map((name) => { return `${name}=http://${name}:2380`; }).join(',');
const started = [];
try {
    docker('network', 'create', network);
    for (const name of names) {
        docker('run', '-d', '--name', name, '--network', network, '-p', '127.0.0.1::2379', 'gcr.io/etcd-development/etcd:v3.5.17',
            '/usr/local/bin/etcd', '--name', name, '--listen-client-urls', 'http://0.0.0.0:2379', '--advertise-client-urls', `http://${name}:2379`,
            '--listen-peer-urls', 'http://0.0.0.0:2380', '--initial-advertise-peer-urls', `http://${name}:2380`, '--initial-cluster', cluster);
        started.push(name);
    }
    const endpoints = names.map((name) => { return `http://${docker('port', name, '2379/tcp')}`; });
    const store = controlStore(controlClient({ endpoints, timeoutMs: 1000 }), '/quorum-test');
    const catalog = { version: '1', nodes: [], tasks: [] };
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        try { await store.publish(catalog); ready = true; } catch {
            // eslint-disable-next-line no-await-in-loop
            await pause(300);
        }
    }
    assert.equal(ready, true, 'three-member quorum starts');
    docker('stop', '-t', '1', names[0]);
    await store.publish({ ...catalog, version: '2' });
    docker('stop', '-t', '1', names[1]);
    await assert.rejects(store.publish({ ...catalog, version: '3' }));
    docker('start', names[1]);
    let recovered = false;
    for (let attempt = 0; attempt < 30 && !recovered; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        try { await store.publish({ ...catalog, version: '4' }); recovered = true; } catch {
            // eslint-disable-next-line no-await-in-loop
            await pause(300);
        }
    }
    assert.equal(recovered, true, 'majority restored');
    assert.equal((await store.read()).catalog.version, '4');
    process.stdout.write('three-member etcd: one failure tolerable, majority loss rejects writes, recovery succeeds\n');
} finally {
    for (const name of started) { try { docker('rm', '-f', name); } catch {
        // Best-effort cleanup of local test containers.
    } }
    try { docker('network', 'rm', network); } catch {
        // Network may not have been created.
    }
}
