import { readKube } from './deploymentKube.js';

function podValue(pod, container, key) {
    const definition = pod.spec?.containers?.find((entry) => { return entry.name === container; });
    return definition?.env?.find((entry) => { return entry.name === key; })?.value;
}

/** Require matching environment on the desired workload and all currently selected pods. */
export function requireWorkloadEnvironment(kube, { workload, selector, container, key, value,
    workloadError = 'Workload environment differs', podError = 'Pod environment differs' }) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) { throw new TypeError('Invalid environment variable name'); }
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(container ?? '')) { throw new TypeError('Invalid workload container name'); }
    const query = `jsonpath={range .spec.template.spec.containers[?(@.name=="${container}")]}{.env[?(@.name=="${key}")].value}{end}`;
    if (readKube(kube, workload, query) !== value) { throw new Error(workloadError); }
    const { items } = JSON.parse(kube(['get', 'pods', '-l', selector, '-o', 'json'], undefined, true));
    if (!Array.isArray(items) || !items.length || items.some((pod) => { return podValue(pod, container, key) !== value; })) {
        throw new Error(podError);
    }
}

function jobTarget(job) {
    if (typeof job === 'string' && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(job)) {
        return [`job/${job}`];
    }
    if (typeof job?.selector === 'string' && /^[A-Za-z0-9_./-]+=[A-Za-z0-9_.-]+$/u.test(job.selector)) {
        return ['job', '-l', job.selector];
    }
    throw new TypeError('Kubernetes readiness requires an explicit Job name or exact label');
}

export function waitForJob(kube, job, timeout = '300s') {
    kube(['wait', '--for=condition=complete', ...jobTarget(job), `--timeout=${timeout}`]);
}

/** Verify PostgreSQL from the deployed application, or directly while it is absent. */
export function verifyPostgresReadiness(kube, { workload, fallback, connectionEnv = 'POSTGRES_URL' }) {
    const live = kube(['get', workload, '--ignore-not-found', '-o', 'name'], undefined, true);
    if (!String(live).trim()) {
        kube(['exec', fallback.target, '--', 'pg_isready', '-U', fallback.user, '-d', fallback.database]);
        return;
    }
    const env = JSON.stringify(connectionEnv);
    const probe = `import pg from 'pg'; const client = new pg.Client({ connectionString: process.env[${env}], connectionTimeoutMillis: 5000, query_timeout: 5000 }); try { await client.connect(); await client.query('SELECT 1'); console.log('PostgreSQL service verified'); } finally { await client.end(); }`;
    kube(['exec', workload, '--', 'node', '--input-type=module', '-e', probe]);
}

/** Require recent, target-bound proof before a rollout that replaces live data paths. */
export function validateDeploymentEvidence({ context, required, claims, catalogVersion, readers = {} }, evidence, now = Date.now()) {
    if (!evidence || evidence.cluster !== context || !required.every((key) => { return evidence[key]; })
        || !(Date.parse(evidence.expiresAt) > now)) {
        throw new Error('Verified per-host deployment evidence required');
    }
    if (catalogVersion !== undefined && evidence.controlCatalogVersion !== catalogVersion) {
        throw new Error('Published control catalog version evidence required before collector cutover');
    }
    for (const [key, value] of Object.entries(readers)) {
        if (evidence.optionalReaders?.[key] !== value) {
            throw new Error(`Deployment evidence optional reader mismatch: ${key}`);
        }
    }
    for (const claim of claims) {
        const claimUid = evidence.claims?.[claim];
        const volume = evidence.volumes?.[claim];
        if (typeof claimUid !== 'string' || !claimUid || !volume?.name || !volume.uid) {
            throw new Error('PVC identity evidence required');
        }
    }
}
