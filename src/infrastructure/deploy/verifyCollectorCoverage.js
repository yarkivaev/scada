import { taskSpecHash } from '../../application/runtime/assignment.js';

function nodeIdentity(node, namespace, execute) {
    const response = execute('kubectl', ['--context', node, '--namespace', namespace, '--request-timeout=10s', 'get', 'nodes', '-o', 'json'],
        { encoding: 'utf8', timeout: 15000 });
    const nodes = JSON.parse(response).items;
    if (nodes?.length !== 1 || !nodes[0].metadata?.uid) { throw new Error('Single physical node identity required'); }
    return nodes[0];
}
function distinct(local, remote) {
    const ips = local.status?.addresses?.filter((row) => { return row.type === 'InternalIP'; }).map((row) => { return row.address; }) ?? [];
    if (local.metadata.uid === remote.metadata.uid || remote.status?.addresses?.some((row) => { return row.type === 'InternalIP' && ips.includes(row.address); })) {
        throw new Error('Surviving reader must run on another physical node');
    }
}
function liveReader(proof, task, { namespace, execute, now, freshnessMs, clockSkewMs, container, statusUrl }) {
    const program = `const r=await fetch(${JSON.stringify(statusUrl)},{signal:AbortSignal.timeout(2000)});if(!r.ok)throw new Error('Reader unavailable');process.stdout.write(await r.text());`;
    const response = execute('kubectl', ['--context', proof.nodeId, '--namespace', namespace, '--request-timeout=10s',
        'exec', proof.workload, '-c', container, '--', 'node', '--input-type=module', '-e', program], { encoding: 'utf8', timeout: 15000 });
    const status = JSON.parse(response);
    const row = status.tasks?.find((item) => { return item.taskId === task.taskId; });
    const at = now();
    if (status.initialized !== true || status.stopping || status.fatal || row?.state !== 'running'
        || ['failed', 'degraded'].includes(row.health) || row.specHash !== taskSpecHash(task.spec)
        || !Number.isFinite(row.lastRead) || row.lastRead > at + clockSkewMs || at - row.lastRead > freshnessMs) {
        throw new Error(`Fresh surviving reader required: ${task.taskId}`);
    }
}
/** Probe a matching controlled collector or temporary static bridge immediately before retirement. */
export default function verifyCollectorCoverage({ cluster, namespace, tasks, evidence, execute, now = Date.now,
    freshnessMs = 15000, clockSkewMs = 5000, workloads, container = 'collector', statusUrl = 'http://127.0.0.1:9091/status' }) {
    if (!tasks.length) { return; }
    const local = nodeIdentity(cluster, namespace, execute);
    for (const task of tasks) {
        const proof = evidence?.coverage?.find((item) => { return item.taskId === task.taskId; });
        if (!proof || proof.nodeId === cluster || !task.eligibleNodes.includes(proof.nodeId)
            || !workloads?.includes(proof.workload)) {
            throw new Error(`Live surviving reader coverage required: ${task.taskId}`);
        }
        distinct(local, nodeIdentity(proof.nodeId, namespace, execute));
        liveReader(proof, task, { namespace, execute, now, freshnessMs, clockSkewMs, container, statusUrl });
    }
}
