import { deploymentKube, readKube, verifyKubeNode } from './deploymentKube.js';
import postgresRestoreObjects from './postgresRestoreObjects.js';

function jobState(job) {
    if (!job) { throw new Error('Restore verification job disappeared'); }
    if (job.status?.succeeded > 0) { return 'complete'; }
    if (job.status?.conditions?.some((condition) => { return condition.type === 'Failed' && condition.status === 'True'; })
        || (job.status?.failed > 0 && !job.status?.active)) {
        throw new Error('Restore attempt failed; use a new attempt number and fresh scratch storage');
    }
    return 'running';
}

function waitVerification(plan, kube, initial) {
    const deadline = Date.now() + 1800000;
    let job = initial;
    while (Date.now() < deadline) {
        if (jobState(job) === 'complete') { return; }
        try {
            kube(['wait', '--for=condition=complete', `job/${plan.verificationName}`, '--timeout=10s']);
        } catch {
            // Check for a terminal Failed state after each short wait.
        }
        job = JSON.parse(readKube(kube, `job/${plan.verificationName}`));
    }
    throw new Error('Restore attempt did not finish in 30 minutes');
}

function optionalResource(kube, resource) {
    return JSON.parse(kube(['get', resource, '--ignore-not-found', '-o', 'json']) || 'null');
}

function createVerification(plan, pod, kube) {
    if (optionalResource(kube, `persistentvolumeclaim/${plan.verificationName}`)) {
        throw new Error('Restore scratch already exists; use a new attempt number');
    }
    const image = pod.status?.containerStatuses?.[0]?.imageID?.replace(/^docker-pullable:\/\//u, '');
    if (!image?.includes('@sha256:')) { throw new Error('Exact PostgreSQL image digest required'); }
    const items = postgresRestoreObjects(plan, pod.spec.nodeName, image);
    kube(['apply', '--server-side', `--field-manager=${plan.fieldManager}`, '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'List', items }));
    return JSON.parse(readKube(kube, `job/${plan.verificationName}`));
}

function verification(plan, pod, kube) {
    const existing = optionalResource(kube, `job/${plan.verificationName}`);
    if (existing && !Object.entries(plan.labels).every(([key, value]) => { return existing.metadata.labels?.[key] === value; })) {
        throw new Error('Restore job ownership differs');
    }
    waitVerification(plan, kube, existing ?? createVerification(plan, pod, kube));
    const log = kube(['logs', `job/${plan.verificationName}`]);
    if (!log.includes('RESTORE_VERIFIED')) { throw new Error('Restore did not report success'); }
    const counts = JSON.parse(log.split('\n').find((line) => { return line.startsWith('{'); }));
    return { target: plan.context, backupId: plan.backupId, verified: true, counts };
}

function targetPod(plan, kube) {
    const pod = JSON.parse(readKube(kube, `pod/${plan.pod}`));
    if (!pod.spec?.nodeName) { throw new Error('Database pod node identity is missing'); }
    verifyKubeNode(kube, plan.nodeAddress, pod.spec.nodeName);
    if (!pod.spec.volumes?.some((volume) => { return volume.persistentVolumeClaim?.claimName === plan.claim; })) {
        throw new Error('Database claim identity differs from the selected deployment target');
    }
    return pod;
}

function status(plan, pod) {
    const ready = pod.status.containerStatuses.every((row) => { return row.ready; });
    const claims = pod.spec.volumes.flatMap((row) => { return row.persistentVolumeClaim ? [row.persistentVolumeClaim.claimName] : []; });
    return { target: plan.context, backupId: plan.backupId, ready, claims };
}

/** Backup or verify a backup using the selected cluster, workload and claim. */
export default function operatePostgresMaintenance(plan, action, execute) {
    if (!['plan', 'backup', 'verify-restore', 'status'].includes(action)) { throw new TypeError('Unknown edge data action'); }
    if (action === 'plan') { return plan; }
    if (!plan.enabled) { throw new Error(`${plan.context} deployment disabled: target is offline`); }
    const kube = deploymentKube(plan, execute, { timeout: 1900000, stdio: ['pipe', 'pipe', 'pipe'] });
    const pod = targetPod(plan, kube);
    if (action === 'backup') {
        kube(['exec', plan.pod, '--', ...plan.backupCommand]);
        return { target: plan.context, backupId: plan.backupId, complete: true };
    }
    if (action === 'verify-restore') { return verification(plan, pod, kube); }
    return status(plan, pod);
}
