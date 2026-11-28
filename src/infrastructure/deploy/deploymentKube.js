import { execFileSync } from 'node:child_process';

/** Bind every command to an explicit Kubernetes context and namespace. */
export function deploymentKube({ context, namespace }, execute = execFileSync, options = {}) {
    if (![context, namespace].every((value) => { return typeof value === 'string' && value.trim(); })) {
        throw new TypeError('Kubernetes context and namespace are required');
    }
    return (args, input, capture = false) => {
        return execute('kubectl', ['--context', context, '--namespace', namespace, ...args],
            { input, encoding: 'utf8', stdio: ['pipe', capture ? 'pipe' : 'inherit', 'inherit'], ...options });
    };
}

export function readKube(kube, resource, output = 'json') {
    return String(kube(['get', resource, '-o', output], undefined, true)).trim();
}

/** Verify an operation is aimed at the only node in a single-node installation. */
export function verifyKubeNode(kube, address, name) {
    const { items } = JSON.parse(readKube(kube, 'nodes'));
    const node = items?.[0];
    if (items?.length !== 1 || (name !== undefined && node.metadata?.name !== name)
        || !node.status?.addresses?.some((row) => { return row.type === 'InternalIP' && row.address === address; })) {
        throw new Error('Kubernetes node identity differs from the selected deployment target');
    }
    return node;
}

export function preserveKubeRestart(kube, workload, annotations, namespace) {
    const prefix = namespace ? ['--namespace', namespace] : [];
    const raw = String(kube([...prefix, 'get', workload, '--ignore-not-found', '-o', 'json'], undefined, true) ?? '').trim();
    const key = 'kubectl.kubernetes.io/restartedAt';
    const restart = raw.startsWith('{') && JSON.parse(raw).spec?.template?.metadata?.annotations?.[key];
    return restart ? { ...annotations, [key]: restart } : annotations;
}
