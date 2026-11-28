import { createHash } from 'node:crypto';

function endpoint(address, port) {
    const host = address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
    return `https://${host}:${port}`;
}

/** Derive etcd peer and client addresses from declared voting roles. */
export function etcdMembership(nodes, { clientPort, peerPort }) {
    const voters = nodes.filter(({ voter }) => { return voter; });
    return {
        endpoints: voters.map(({ address }) => { return endpoint(address, clientPort); }).join(','),
        initialCluster: voters.map(({ id, address }) => { return `${id}=${endpoint(address, peerPort)}`; }).join(',')
    };
}

/** Build a stable catalog revision using exactly the scheduling inputs. */
export function versionedControlCatalog({ version, controlEpoch, nodes, tasks }) {
    if (new Set(tasks.map(({ taskId }) => { return taskId; })).size !== tasks.length) {
        throw new TypeError('Duplicate control task identity');
    }
    const content = { controlEpoch, nodes: nodes.map(({ id, capacity }) => { return { id, capacity }; }), tasks };
    const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    return { version: `${version}:${digest}`, ...content };
}

/** Validate the requests and limits object accepted by a Kubernetes chart. */
export function deploymentResources(value) {
    if (value === undefined) { return; }
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || ['requests', 'limits'].some((key) => {
            return value[key] !== undefined && (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key]));
        })) {
        throw new TypeError('Invalid control resources');
    }
}

function recoveryTimeout(value = 900000) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) { throw new TypeError('Invalid collector recovery timeout'); }
    return value;
}

function agentCapacity(config, node) {
    if (node.agent !== undefined && (!node.agent || typeof node.agent !== 'object' || Array.isArray(node.agent))) {
        throw new TypeError('Invalid collector capacity');
    }
    const result = {
        storage: config.agentStorage, spoolMaxBytes: config.spoolMaxBytes, spoolMaxRecords: config.spoolMaxRecords,
        recoveryTimeoutMs: config.recoveryTimeoutMs, resources: config.agentResources, ...node.agent
    };
    for (const key of ['spoolMaxBytes', 'spoolMaxRecords']) {
        if (!Number.isSafeInteger(result[key]) || result[key] < 1) { throw new TypeError(`Invalid collector ${key}`); }
    }
    deploymentResources(result.resources);
    if (result.heapMb !== undefined && (!Number.isSafeInteger(result.heapMb) || result.heapMb < 1)) {
        throw new TypeError('Invalid collector heapMb');
    }
    return result;
}

function collectorStartupProbe(timeout) {
    const periodSeconds = 5;
    return {
        httpGet: { path: '/startup', port: 9092 },
        periodSeconds,
        timeoutSeconds: 2,
        failureThreshold: Math.ceil(timeout / (periodSeconds * 1000)) + 1
    };
}

/** Render the standard SCADA collector agent runtime with caller-provided credential references. */
export function collectorControlDeployment(config, node, { endpoints, brokerEndpoints, hostDevices, deliverySecret, renderDeployment = false }) {
    const capacity = agentCapacity(config, node);
    const recoveryMs = recoveryTimeout(capacity.recoveryTimeoutMs);
    return {
        nodeId: node.id, renderDeployment, image: config.agentImage,
        tlsSecret: node.clientTlsSecret ?? `${node.id}-control-client`,
        authSecret: node.authSecret ?? `${node.id}-control-auth`,
        authUsernameKey: config.authUsernameKey, authPasswordKey: config.authPasswordKey,
        deliverySecret, storage: capacity.storage, resources: capacity.resources,
        hostDevices, startupProbe: collectorStartupProbe(recoveryMs),
        env: {
            ...(capacity.heapMb !== undefined && { NODE_OPTIONS: `--max-old-space-size=${capacity.heapMb}` }),
            COLLECTOR_RECOVERY_TIMEOUT_MS: String(recoveryMs), COLLECTOR_NODE_ID: node.id,
            COLLECTOR_BROKER_ENDPOINTS: JSON.stringify(brokerEndpoints), COLLECTOR_CONTROL_ENDPOINTS: endpoints,
            COLLECTOR_CONTROL_PREFIX: config.prefix, COLLECTOR_ASSIGNMENT_FILE: '/data/assignment.json',
            COLLECTOR_CONTROL_CA: '/tls/ca.crt', COLLECTOR_CONTROL_CERT: '/tls/tls.crt', COLLECTOR_CONTROL_KEY: '/tls/tls.key',
            COLLECTOR_HEALTH_HOST: '0.0.0.0', COLLECTOR_HEALTH_PORT: '9091', COLLECTOR_STARTUP_PORT: '9092',
            COLLECTOR_LIVE_STALE_MS: '2147483647', COLLECTOR_SPOOL_DIR: '/data/spool',
            COLLECTOR_SPOOL_MAX_BYTES: String(capacity.spoolMaxBytes), COLLECTOR_SPOOL_MAX_RECORDS: String(capacity.spoolMaxRecords)
        }
    };
}
