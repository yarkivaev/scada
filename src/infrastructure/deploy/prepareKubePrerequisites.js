import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { verifyKubeNode } from './deploymentKube.js';

function encoded({ data, stringData }) {
    return { ...data, ...Object.fromEntries(Object.entries(stringData ?? {}).map(([key, value]) => {
        return [key, Buffer.from(value).toString('base64')];
    })) };
}

function objectName({ kind, metadata }) {
    return `${kind}/${metadata.name}`;
}

function objectKey({ name, namespace }) {
    return `${namespace}/${name}`;
}

function clientFor(plan, execute) {
    if (typeof plan.context !== 'string' || !plan.context.trim()) { throw new TypeError('Exact Kubernetes context required'); }
    function kube(namespace, args, input) {
        return String(execute('kubectl', ['--context', plan.context, ...(namespace ? ['--namespace', namespace] : []), ...args],
            { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }));
    }
    const node = verifyKubeNode((args) => { return kube('', args); }, plan.nodeAddress);
    const podCidrs = node.spec?.podCIDRs ?? [node.spec?.podCIDR].filter(Boolean);
    if (plan.requirePodCidrs && !podCidrs.length) { throw new Error('Verified node pod CIDR required'); }
    function optional(namespace, kind, name) {
        return JSON.parse(kube(namespace, ['get', `${kind}/${name}`, '--ignore-not-found', '-o', 'json']) || 'null');
    }
    const namespaces = new Map(plan.namespaces.map((name) => { return [name, Boolean(optional('', 'namespace', name))]; }));
    return {
        podCidrs,
        get(namespace, kind, name) {
            return namespace && !namespaces.get(namespace) ? null : optional(namespace, kind, name);
        },
        create(object) {
            kube(object.metadata.namespace ?? '', ['create', '-f', '-'], JSON.stringify(object));
        }
    };
}

function credential(request, supplied, found, action) {
    const { name, namespace, keys, type: expectedType } = request;
    if (found && supplied && !isDeepStrictEqual(found.data, encoded(supplied))) { throw new Error(`Existing Secret differs: ${name}`); }
    if (supplied && keys.some((key) => { return !encoded(supplied)[key]; })) { throw new Error(`Missing supplied Secret keys: ${name}`); }
    if (found && keys.some((key) => { return !found.data?.[key]; })) { throw new Error(`Missing existing Secret keys: ${name}`); }
    if (action === 'apply' && !found && !supplied) {
        throw new Error(`Missing prerequisites: provide ${name} through a protected Secret file`);
    }
    const source = supplied ?? found ?? {};
    return { apiVersion: 'v1', kind: 'Secret', metadata: { name, namespace }, type: source.type ?? expectedType ?? 'Opaque', data: encoded(source) };
}

function credentialInputs(requests, secrets, client, action) {
    const targets = new Set(requests.map(objectKey));
    if (secrets.some((item) => { return item.kind !== 'Secret' || !item.metadata || !targets.has(objectKey(item.metadata)); })) {
        throw new Error('Unexpected prerequisite Secret target');
    }
    const resolved = new Map();
    return requests.map((request) => {
        const key = objectKey(request);
        const found = client.get(request.namespace, 'secret', request.name);
        const mirrored = !found && request.copyFrom && resolved.get(objectKey(request.copyFrom));
        const supplied = secrets.find(({ metadata }) => { return objectKey(metadata) === key; })
            ?? (mirrored && request.keys.every((name) => { return mirrored.data[name]; }) ? { data: mirrored.data } : null);
        const object = credential(request, supplied, found, action);
        resolved.set(key, object);
        return object;
    });
}

function verifyExisting(object, client, preserved) {
    const found = client.get(object.metadata.namespace ?? '', object.kind.toLowerCase(), object.metadata.name);
    if (found && object.kind === 'Secret' && !isDeepStrictEqual(found.data, object.data)) {
        throw new Error(`Existing Secret differs: ${object.metadata.name}`);
    }
    if (found) { preserved.push(objectName(object)); }
    return !found;
}

/** Create missing prerequisites without replacing any live resource or credential. */
export default function prepareKubePrerequisites(plan, action = 'check', { execute = execFileSync, secrets = [] } = {}) {
    if (!['render', 'check', 'apply'].includes(action)) { throw new TypeError('prepare action must be render, check or apply'); }
    if (action === 'render') { return plan.objects([]); }
    const target = plan.context;
    if (action === 'apply' && !plan.enabled) { throw new Error(`${target} deployment disabled: target is offline`); }
    const client = clientFor(plan, execute);
    const objects = [...plan.objects(client.podCidrs), ...credentialInputs(plan.credentials ?? [], secrets, client, action)];
    const preserved = [];
    const pending = objects.filter((object) => { return verifyExisting(object, client, preserved); });
    if (action === 'apply') { pending.forEach(client.create); }
    const names = pending.map(objectName);
    return { target, created: action === 'apply' ? names : [], missing: action === 'check' ? names : [], preserved };
}
