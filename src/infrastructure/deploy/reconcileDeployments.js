import kubeServiceAccount from '../management/kubeServiceAccount.js';

const patchJson = 'application/json-patch+json';
const dnsName = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u;

function validName(name) {
    if (typeof name !== 'string' || !dnsName.test(name)) { throw new TypeError('Invalid Kubernetes deployment target'); }
    return name;
}

function guards(body) {
    const version = body.metadata?.resourceVersion;
    if (typeof version !== 'string' || !version) { throw new Error('Missing Kubernetes resource version'); }
    return [{ op: 'test', path: '/metadata/resourceVersion', value: version }];
}

function concurrentEdit({ status, body }) {
    return status === 409 || (status === 422 && /test failed/u.test(body));
}

/** Recompute a bounded JSON patch from the live Deployment before each mutation. */
export default function reconcileDeployments({
    namespace, exchange = kubeServiceAccount('https://kubernetes.default.svc'), maxChanges = 5, onPatch
}) {
    const prefix = `/apis/apps/v1/namespaces/${validName(namespace)}/deployments`;
    function resource(name) { return `${prefix}/${validName(name)}`; }
    async function get(name) {
        const result = await exchange('GET', resource(name));
        if (result.status === 404) { return null; }
        if (result.status !== 200) { throw new Error(`Kubernetes read failed for ${name} with HTTP ${result.status}`); }
        return JSON.parse(result.body);
    }
    async function apply(step, operation) {
        for (let i = 0; i < maxChanges; i += 1) {
            // Read after each attempted patch to incorporate concurrent changes.
            // eslint-disable-next-line no-await-in-loop
            const body = await get(step.name);
            const patch = body && operation(body, step);
            if (!patch) { return; }
            // eslint-disable-next-line no-await-in-loop
            const result = await exchange('PATCH', resource(step.name), [...guards(body), patch], patchJson);
            if (result.status >= 200 && result.status < 300) { onPatch?.(step, patch); }
            else if (!concurrentEdit(result)) { throw new Error(`Kubernetes patch failed for ${step.name} with HTTP ${result.status}`); }
        }
    }
    return { get, apply };
}
