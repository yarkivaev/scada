import { execFileSync } from 'node:child_process';
import { deploymentKube } from './deploymentKube.js';
import executeRelease from './executeRelease.js';

/** Apply only the named kinds in a rendered chart under an independent field manager. */
export default function applyHelmResources(plan, { kinds, decode, encode }, execute = execFileSync) {
    if (!Array.isArray(kinds) || !kinds.length || kinds.some((kind) => { return typeof kind !== 'string' || !kind; })) {
        throw new TypeError('An explicit nonempty list of resource kinds is required');
    }
    if (typeof plan.fieldManager !== 'string' || !plan.fieldManager.trim()) { throw new TypeError('Resource apply requires a field manager'); }
    const kube = deploymentKube(plan, execute, { stdio: ['pipe', 'pipe', 'inherit'] });
    const selected = new Set(kinds);
    const rendered = decode(String(executeRelease(plan, 'render', execute)));
    const resources = rendered.filter((resource) => { return resource && selected.has(resource.kind); });
    if (!resources.length) { throw new Error('No resources matched the selected kinds'); }
    return kube(['apply', '--server-side', `--field-manager=${plan.fieldManager}`, '-f', '-'], resources.map((resource) => { return encode(resource); }).join('---\n'));
}
