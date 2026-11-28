import { isIP } from 'node:net';
import expand from './expand.js';
import { releaseFor } from './releases.js';
import { serverFor } from './releaseNodes.js';

/** Resolve deployment inputs once for a plant module that builds chart values. */
export function deploymentContext(document, cluster) {
    const expanded = expand(document);
    const server = serverFor(expanded, cluster);
    const profile = expanded.profiles[server.profile.id];
    return { expanded, server, profile, ...releaseFor(expanded, server) };
}

/** Merge device mounts and assignments into one collector process for a node. */
export function collectorDeployment(processes, options) {
    const { assignments, command, image, resources, environment, hostSecurity, healthPort = 9091 } = options;
    if (!image) { throw new TypeError('Universal collector image required in DSL'); }
    if (!processes.length) { return []; }
    const hostDevices = [...new Set(processes.flatMap((process) => { return process.hostDevices ?? []; }))].sort();
    return [{
        name: 'collector',
        adapter: 'collector',
        health: { port: healthPort },
        command,
        image,
        resources,
        hostDevices,
        ...(hostDevices.length && hostSecurity && { podSecurityContext: hostSecurity }),
        env: {
            ...environment,
            COLLECTOR_HEALTH_PORT: String(healthPort),
            COLLECTOR_HEALTH_HOST: '0.0.0.0',
            COLLECTOR_LIVE_STALE_MS: '2147483647',
            COLLECTOR_MANIFEST: JSON.stringify({ assignments })
        }
    }];
}

/** Convert predecessor names into exact workload and label bindings. */
export function retiredDeployments({ prefix, groups, desired = [], extra = [] }) {
    const retired = new Set();
    const replacements = groups.flatMap((names) => {
        if (!Array.isArray(names)) { throw new TypeError('invalid replacement list'); }
        return names.map((name) => {
            if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)
                || retired.has(name) || desired.some((item) => { return item.name === name; })) {
                throw new TypeError('invalid replacement deployment');
            }
            retired.add(name);
            return { workload: `deployment/${prefix}-${name}`, selector: `app=${name}` };
        });
    });
    return [...replacements, ...extra.map(({ name, label }) => {
        return { workload: `deployment/${prefix}-${name}`, selector: `app=${label}` };
    })];
}

/** Bind a release target and default chart values across a sequence of stages. */
export function stageFor(common, values) {
    return (id, fragment, workloads) => {
        return { ...common, id, values: { ...values, ...fragment }, workloads };
    };
}

/** Generate a node-port service and its peer-scoped ingress policy. */
export function peerNodePort({ name, namespace, selector, peerAddresses, portName, port, nodePort, additionalPorts = [], namespacePeers = [] }) {
    if (!selector || !Object.keys(selector).length) { throw new TypeError('NodePort workload selector is required'); }
    const metadata = { name, namespace };
    const service = { apiVersion: 'v1', kind: 'Service', metadata, spec: {
        type: 'NodePort', externalTrafficPolicy: 'Local', selector, ports: [{ name: portName, port, targetPort: port, nodePort }]
    } };
    const peers = [...namespacePeers.map((namespaceSelector) => { return { namespaceSelector }; }),
        ...peerAddresses.map((address) => {
            if (isIP(address) !== 4) { throw new TypeError('Peer ingress requires an IPv4 address'); }
            return { ipBlock: { cidr: `${address}/32` } };
        })];
    const ingress = [
        ...(peers.length ? [{ from: peers, ports: [{ protocol: 'TCP', port }] }] : []),
        ...(additionalPorts.length ? [{ ports: additionalPorts.map((number) => { return { protocol: 'TCP', port: number }; }) }] : [])
    ];
    return [service, { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata, spec: {
        podSelector: { matchLabels: selector }, policyTypes: ['Ingress'], ingress
    } }];
}
