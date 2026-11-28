import { execFileSync } from 'node:child_process';
import { deploymentKube } from './deploymentKube.js';
import executeRelease from './executeRelease.js';

function assertBootstrapTarget({ context, namespace, stage, storage }, action) {
    if (!['check', 'apply'].includes(action)) { throw new TypeError('Storage bootstrap action must be check or apply'); }
    if (!Array.isArray(storage) || !storage.length) { throw new TypeError('Storage bootstrap requires explicit workload references'); }
    if (stage?.context !== context || stage?.namespace !== namespace) { throw new Error('Storage stage must match the bootstrap target'); }
}

/** Provision absent storage alone, preserving an existing complete storage set. */
export default function bootstrapKubeStorage(profile, action, execute = execFileSync) {
    const { context, stage, storage, blockers = ['deployments', 'pods'] } = profile;
    assertBootstrapTarget(profile, action);
    const kube = deploymentKube(profile, execute, { stdio: ['pipe', 'pipe', 'pipe'] });
    function get(resource) {
        const output = kube(['get', resource, '--ignore-not-found', '-o', 'json'], undefined, true);
        return JSON.parse(String(output ?? '').trim() || 'null');
    }
    const live = storage.map(get);
    if (live.every(Boolean)) { return { target: context, created: false, preserved: true }; }
    if (live.some(Boolean)) { throw new Error('Partial storage exists; refusing implicit replacement'); }
    if (blockers.some((kind) => { return get(kind)?.items?.length; })) {
        throw new Error('Existing workloads prevent fresh storage bootstrap');
    }
    executeRelease(stage, action, execute);
    return { target: context, created: action === 'apply', preserved: false };
}
