import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { controlClient, controlStore } from '../../src/application/control/index.js';
function docker(...args) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function encoded(value) { return Buffer.from(value).toString('base64'); }
const container = `control-auth-${process.pid}`;
async function provision(call) {
    await call('/v3/auth/user/add', { name: 'root', password: 'test-root' });
    await call('/v3/auth/user/grant', { user: 'root', role: 'root' });
    for (const name of ['agent', 'controller', 'publisher']) {
        // eslint-disable-next-line no-await-in-loop
        await call('/v3/auth/role/add', { name });
        // eslint-disable-next-line no-await-in-loop
        await call('/v3/auth/user/add', { name, password: `test-${name}` });
        // eslint-disable-next-line no-await-in-loop
        await call('/v3/auth/user/grant', { user: name, role: name });
    }
    for (const [name, permType, key, end] of [
        ['agent', 'READ', '/control/assignments/a'], ['agent', 'WRITE', '/control/reports/a'],
        ['controller', 'READWRITE', '/control/', '/control0'], ['publisher', 'READWRITE', '/control/catalog']
    ]) {
        // eslint-disable-next-line no-await-in-loop
        await call('/v3/auth/role/grant', { name, perm: { permType, key: encoded(key), ...(end && { range_end: encoded(end) }) } });
    }
    await call('/v3/auth/enable', {});
}
try {
    docker('run', '-d', '--name', container, '-p', '127.0.0.1::2379', 'gcr.io/etcd-development/etcd:v3.5.17', '/usr/local/bin/etcd',
        '--listen-client-urls', 'http://0.0.0.0:2379', '--advertise-client-urls', 'http://127.0.0.1:2379');
    const endpoints = [`http://${docker('port', container, '2379/tcp')}`];
    const anonymous = controlClient({ endpoints, timeoutMs: 1000 });
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        try { await anonymous('/v3/kv/range', { key: encoded('/ready') }); ready = true; } catch {
            // eslint-disable-next-line no-await-in-loop
            await pause(200);
        }
    }
    assert.equal(ready, true);
    await provision(anonymous);
    const user = (name) => { return controlClient({ endpoints, username: name, password: `test-${name}` }); };
    const root = user('root');
    const agent = user('agent');
    const publisher = controlStore(user('publisher'), '/control');
    const controller = controlStore(user('controller'), '/control');
    await publisher.publish({ version: '1', nodes: [], tasks: [] });
    const token = await controller.acquire();
    assert.ok(token);
    await controller.commit(token, await controller.read(), { a: { generation: 1, assignments: [] } });
    assert.equal((await controlStore(agent, '/control').assignment('a')).generation, 1);
    await controlStore(agent, '/control').report('a', { nodeId: 'a', receivedAt: Date.now() });
    await assert.rejects(controlStore(agent, '/control').assignment('b'));
    await assert.rejects(agent('/v3/kv/put', { key: encoded('/control/assignments/a'), value: encoded('{}') }));
    await assert.rejects(anonymous('/v3/kv/range', { key: encoded('/control/catalog') }));
    await assert.rejects(user('publisher')('/v3/kv/put', { key: encoded('/control/assignments/a'), value: encoded('{}') }));
    // Changing the auth revision invalidates cached simple tokens; same credentials can reauthenticate.
    await root('/v3/auth/user/changepw', { name: 'agent', password: 'test-agent' });
    assert.equal((await controlStore(agent, '/control').assignment('a')).generation, 1);
    process.stdout.write('authenticated gateway: controller/publisher/agent roles enforced and cached tokens refreshed\n');
} finally {
    try { docker('rm', '-f', container); } catch {
        // Preserve the original test failure if container creation failed.
    }
}
