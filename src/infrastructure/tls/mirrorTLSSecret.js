import kubeServiceAccount from '../management/kubeServiceAccount.js';
import { tlsMaterialLimit, validateTLSMaterial } from './tlsMaterial.js';

function targetPath({namespace,name}) {
    if (![namespace,name].every(value => { return typeof value === 'string' && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(value); })) {
        throw new Error('TLS Secret target is invalid');
    }
    return `/api/v1/namespaces/${namespace}/secrets/${name}`;
}

export function kubernetesTLSAPI(environment) {
    const host = environment.KUBERNETES_SERVICE_HOST;
    const port = environment.KUBERNETES_SERVICE_PORT_HTTPS || '443';
    if (!host) { throw new Error('TLS Secret API address is missing'); }
    const address = `https://${host.includes(':') ? `[${host}]` : host}:${port}`;
    const request = kubeServiceAccount(address, { limit: tlsMaterialLimit, timeoutMs: 10000 });
    async function exchange(path, method, body) {
        try {
            const result = await request(method, path, body);
            if (result.status !== 200) { throw new Error('Refused'); }
            return JSON.parse(result.body);
        } catch { throw new Error('TLS Secret API request failed'); }
    }
    return {get:target => { return exchange(targetPath(target),'GET'); },update:(target,body) => { return exchange(targetPath(target),'PUT',body); }};
}

/** Update an already-existing named Secret only; RBAC grants no create or namespace discovery. */
export async function mirrorTLSSecret(payload, { target, hosts, api, roots, format }) {
    const data = validateTLSMaterial(payload, { hosts, roots, format });
    targetPath(target);
    const secret = await api.get(target);
    if (secret.metadata?.name !== target.name || secret.metadata?.namespace !== target.namespace
        || !secret.metadata?.resourceVersion || secret.type !== 'kubernetes.io/tls') { throw new Error('TLS Secret target does not match'); }
    if (secret.data?.['tls.crt'] === data['tls.crt'] && secret.data?.['tls.key'] === data['tls.key']) { return false; }
    await api.update(target,{...secret,data:{...secret.data,...data}});
    return true;
}
