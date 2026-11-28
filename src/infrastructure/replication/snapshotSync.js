import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';

function samples(state) {
    const imported = state.checkpoint ? Date.parse(state.checkpoint.importedAt) / 1000 : 0;
    const exported = state.checkpoint ? Date.parse(state.checkpoint.exportedAt) / 1000 : 0;
    return {
        ready: state.checkpoint ? 1 : 0,
        last_success_timestamp_seconds: imported,
        snapshot_timestamp_seconds: exported,
        snapshot_age_seconds: exported ? Math.max(0, Date.now() / 1000 - exported) : 0,
        sync_errors_total: state.errors,
        last_attempt_success: state.lastAttempt ? 1 : 0,
        tls_renewal_errors_total: state.tlsErrors,
        tls_last_success_timestamp_seconds: state.tlsSuccess
    };
}

function status(state, prefix, incoming, response) {
    if (incoming.method !== 'GET') { response.writeHead(405).end(); }
    else if (incoming.url === '/healthz') {
        response.writeHead(state.checkpoint ? 200 : 503, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ ready: Boolean(state.checkpoint) }));
    } else if (incoming.url === '/metrics') {
        const metrics = Object.entries(samples(state)).map(([name, value]) => { return `${prefix}_${name} ${value}`; });
        response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(`${metrics.join('\n')}\n`);
    } else { response.writeHead(404).end(); }
}

/** Readiness follows the local checkpoint. Remote failures are reported separately. */
export async function snapshotSync({
    checkpoint, fetchSnapshot, applySnapshot, renewTLS, stateFile, interval = 60000, metricPrefix = 'snapshot_replica'
}) {
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/u.test(metricPrefix)) { throw new Error('Invalid replica metric prefix'); }
    const state = { checkpoint: await checkpoint(), errors: 0, lastAttempt: false, tlsErrors: 0, tlsSuccess: 0 };
    const server = createServer((incoming, response) => { status(state, metricPrefix, incoming, response); });
    let timer;
    let stopped = false;
    let running;
    async function update() {
        try {
            state.checkpoint = await applySnapshot(await fetchSnapshot());
            state.lastAttempt = true;
            if (stateFile) { await writeFile(stateFile, JSON.stringify(state.checkpoint), { mode: 0o600 }); }
        } catch { state.errors += 1; state.lastAttempt = false; }
    }
    async function renewal() {
        try {
            if (renewTLS && await renewTLS()) { state.tlsSuccess = Date.now() / 1000; }
        } catch { state.tlsErrors += 1; }
    }
    async function poll() {
        await Promise.all([update(), renewal()]);
        if (!stopped) { timer = setTimeout(() => { running = poll(); }, interval); }
    }
    return {
        server,
        start() { if (!running && !stopped) { running = poll(); } },
        async stop() { stopped = true; clearTimeout(timer); await running; }
    };
}
