/** Kubernetes inspection and reconciliation for one configured target. */
import { fileURLToPath } from 'node:url';
import command from './command.js';

const chart = fileURLToPath(new URL('../../../charts/scada', import.meta.url));
const worker = fileURLToPath(new URL('./serverSideRelease.js', import.meta.url));
const workloadKinds = 'deployments,statefulsets,daemonsets,jobs';

function jobState(status) {
    function active(type) {
        return status.conditions?.some((item) => {
            return item.type === type && item.status === 'True';
        });
    }
    if (active('Failed')) {
        return 'failed';
    }
    return active('Complete') ? 'ready' : 'pending';
}

function workloadState({ kind, metadata, spec = {}, status = {} }) {
    if (kind === 'Job') {
        return jobState(status);
    }
    if ((status.observedGeneration ?? 0) < metadata.generation) {
        return 'pending';
    }
    const daemon = kind === 'DaemonSet';
    const desired = daemon ? status.desiredNumberScheduled : spec.replicas ?? 1;
    const available = daemon ? status.numberAvailable : status.availableReplicas ?? status.readyReplicas;
    if (desired === 0) {
        return 'stopped';
    }
    const updated = daemon ? status.updatedNumberScheduled : status.updatedReplicas;
    if (kind === 'Deployment' && (status.replicas ?? 0) > (updated ?? 0)) {
        return 'pending';
    }
    const complete = (available ?? 0) >= desired && (updated ?? 0) >= desired;
    return complete ? 'ready' : 'pending';
}

function workloadId(item) {
    return `${item.kind.toLowerCase()}/${item.metadata.name}`;
}

function workloadInspection(kubectl, release, expected) {
    async function observed() {
        if (expected) {
            const output = await kubectl('get', [...expected, '--ignore-not-found', '-o', 'json']);
            if (!output.trim()) {
                return [];
            }
            const response = JSON.parse(output);
            return response.kind === 'List' ? response.items : [response];
        }
        const selector = `app.kubernetes.io/name=scada,app.kubernetes.io/instance=${release}`;
        const { items } = JSON.parse(await kubectl('get', [workloadKinds, '--selector', selector, '-o', 'json']));
        return items;
    }

    async function components() {
        const states = new Map((await observed()).map((item) => {
            return [workloadId(item), workloadState(item)];
        }));
        return (expected ?? Array.from(states.keys())).map((id) => {
            return { id, state: states.get(id) ?? 'failed' };
        });
    }

    async function logs(component, tail) {
        if ((expected && !expected.includes(component)) ||
            !(await observed()).some((item) => { return workloadId(item) === component; })) {
            throw new Error('unknown component');
        }
        return kubectl('logs', [component, `--tail=${tail}`, '--all-containers=true']);
    }

    return { components, logs };
}

export default function kubernetes({ kubeContext, namespace, release, values, releasePlan, workloads }) {
    function kubectl(action, args) {
        return command('kubectl', [action, `--context=${kubeContext}`, `--namespace=${namespace}`, ...args]);
    }

    async function helm(options, timeout) {
        if (!values) {
            throw new Error('this context has no desired release values');
        }
        // Even with --kube-context, Helm honors environment overrides for its API server and TLS settings.
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => {
            return !key.startsWith('HELM_KUBE');
        }));
        await command('helm', ['upgrade', '--install', release, chart, `--kube-context=${kubeContext}`,
            `--namespace=${namespace}`, `--values=${values}`, '--timeout=5m', ...options], timeout, env);
    }

    async function reconcile(action, options, timeout) {
        if (releasePlan) {
            // The executor bounds each subprocess. Wait for the worker to settle before releasing the write lock.
            await command(process.execPath, [worker, action, releasePlan, kubeContext, namespace, release], 0)
                .catch(() => { throw new Error('Kubernetes server-side release failed'); });
        } else {
            await helm(options, timeout);
        }
        return { changes: [{ id: release, action: 'reconcile' }] };
    }

    return {
        ...workloadInspection(kubectl, release, workloads),
        plan() { return reconcile('check', ['--dry-run=server', '--hide-secret'], 30000); },
        apply() { return reconcile('apply', ['--atomic'], 660000); }
    };
}
