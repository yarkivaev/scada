import { isDeepStrictEqual } from 'node:util';
import { deploymentKube, readKube, verifyKubeNode } from './deploymentKube.js';
import { renderRelease } from './executeRelease.js';

function requireSecretKeys(kube, secrets) {
    for (const { name, keys } of secrets) {
        if (keys) {
            const present = readKube(kube, `secret/${name}`, 'go-template={{range $k,$v := .data}}{{$k}} {{end}}').split(/\s+/u);
            const missing = keys.filter((key) => { return !present.includes(key); });
            if (missing.length) { throw new Error(`Missing Secret ${name} keys: ${missing.join(', ')}`); }
        } else {
            readKube(kube, `secret/${name}`, 'name');
        }
    }
}

function verifyStorageLayout(kube, { name, volume, mountPath, claim, env, environmentValue }) {
    const { spec } = JSON.parse(readKube(kube, `statefulset/${name}`)).spec.template;
    const container = spec.containers[0];
    if (container.env.find((row) => { return row.name === env; })?.value !== environmentValue
        || container.volumeMounts.find((row) => { return row.name === volume; })?.mountPath !== mountPath
        || spec.volumes.find((row) => { return row.name === volume; })?.persistentVolumeClaim?.claimName !== claim) {
        throw new Error(`Storage data layout differs: ${name}; refusing storage adoption`);
    }
}

function preserveStorageTemplates(kube, storage) {
    for (const { name, values } of storage) {
        const { template } = JSON.parse(readKube(kube, `statefulset/${name}`)).spec;
        if (template.spec.containers[0].image !== values.image) {
            throw new Error(`Storage image differs: ${name}; adoption must preserve it`);
        }
        Object.assign(values, { podTemplate: template });
    }
}

function verifyStorageTemplates(kube, execute, { stage, workloads }, action) {
    const manifests = renderRelease(stage, execute);
    const flags = action === 'adopt' ? ['--field-manager=kubectl-client-side-apply'] : ['--server-side', `--field-manager=${stage.fieldManager}`];
    const response = JSON.parse(kube(['apply', ...flags, '--dry-run=server', '-f', '-', '-o', 'json'], manifests, true));
    const objects = response.items ?? [response];
    for (const name of workloads) {
        const desired = objects.find((row) => { return row.kind === 'StatefulSet' && row.metadata.name === name; });
        const live = JSON.parse(readKube(kube, `statefulset/${name}`));
        if (!desired || !isDeepStrictEqual(desired.spec.template, live.spec.template)) {
            throw new Error(`Storage pod template differs: ${name}; adoption must not restart it`);
        }
    }
}

function verifyVolumeIdentity(kube, { name, claimUid, volumeName, volumeUid }) {
    const live = JSON.parse(readKube(kube, `persistentvolumeclaim/${name}`));
    if (!live.metadata.uid || live.status.phase !== 'Bound' || !live.spec.volumeName
        || (claimUid && claimUid !== live.metadata.uid) || (volumeName && volumeName !== live.spec.volumeName)) {
        throw new Error(`PVC identity mismatch: ${name}`);
    }
    const actualUid = readKube(kube, `persistentvolume/${live.spec.volumeName}`, 'jsonpath={.metadata.uid}');
    if (!actualUid || (volumeUid && volumeUid !== actualUid)) { throw new Error(`PV identity mismatch: ${name}`); }
}

/** Inspect a live single-node deployment before constructing its staged cutover. */
export default function preflightKubeStorage(plan, action, execute) {
    const kube = deploymentKube(plan, execute);
    requireSecretKeys(kube, plan.secrets ?? []);
    plan.beforeStorage?.(kube);
    verifyKubeNode(kube, plan.nodeAddress);
    for (const layout of plan.layouts ?? []) { verifyStorageLayout(kube, layout); }
    preserveStorageTemplates(kube, plan.preserveTemplates ?? []);
    plan.preserveAnnotations?.(kube);
    if (plan.verifyTemplates) { verifyStorageTemplates(kube, execute, plan.verifyTemplates, action); }
    for (const claim of plan.claims ?? []) { verifyVolumeIdentity(kube, claim); }
    for (const resource of plan.resources ?? []) {
        const prefix = resource.namespace ? ['--namespace', resource.namespace] : [];
        kube([...prefix, 'get', resource.name, '-o', 'name'], undefined, !resource.namespace);
    }
}
