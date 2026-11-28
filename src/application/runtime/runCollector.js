import { readManifest, validateManifest } from './manifest.js';
import collectorStartup from './collectorStartup.js';
import collectorSignals from './collectorSignals.js';
import createRuntime from './runtime.js';
import runtimeServices from './runtimeServices.js';
import runtimeHealth from './runtimeHealth.js';
import spoolSurface from './spoolSurface.js';
import deadline from './deadline.js';
import assignmentAgent from '../control/agent.js';
import controlStore from '../control/controlStore.js';
import { clientFromEnv } from '../control/controlClient.js';

async function apply(runtime, document) {
    for (const removal of document.removals ?? []) {
        // Retire explicitly before opening replacement resource owners.
        // eslint-disable-next-line no-await-in-loop
        await runtime.remove(removal);
    }
    for (const input of document.assignments) {
        // Keep startup concurrency bounded; task execution remains concurrent.
        // eslint-disable-next-line no-await-in-loop
        await runtime.apply(input);
    }
}
function healthView(runtime, state, queue) {
    return { status() {
        const status = runtime.status();
        const { pending, bytes, maxBytes, recordLimit, droppedRecords, droppedBytes } = queue?.status?.() ?? {};
        return { ...status, delivery: { pending, bytes, maxBytes, recordLimit, droppedRecords, droppedBytes }, stopping: status.stopping || state.stopped, fatal: status.fatal || state.failed,
            initialized: state.initialized && (!state.agent || state.agent.status().appliedGeneration !== null) };
    } };
}
async function initialize(collector, owned, state, { env, registry, store }) {
    const { runtime } = collector;
    if (state.stopped) { throw new Error('Collector stopped during recovery'); }
    await owned.open?.();
    if (state.stopped) { throw new Error('Collector stopped during recovery'); }
    if (store) {
        state.agent = assignmentAgent({ nodeId: env.COLLECTOR_NODE_ID, store, runtime,
            validate(document) { return validateManifest(document, registry); },
            onError(error) { process.stderr.write(`collector control: ${error.name}\n`); } });
        await state.agent.start({ waitForInitialTick: false });
    } else { await collector.reload(); }
    if (state.stopped) { throw new Error('Collector stopped during recovery'); }
    state.initialized = true;
}
function startupPort(env) {
    if (env.COLLECTOR_STARTUP_PORT === undefined) { return null; }
    const port = Number(env.COLLECTOR_STARTUP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) { throw new TypeError('Invalid collector startup port'); }
    return port;
}
async function startProbe(runtime, state, port, host) {
    if (state.stopped) { throw new Error('Collector stopped during recovery'); }
    if (port === null) { return; }
    Object.assign(state, { startup: collectorStartup(healthView(runtime, state), { port, host }) });
    await state.startup;
    if (state.stopped) { throw new Error('Collector stopped during recovery'); }
}
async function stopListener(listener) {
    const server = await listener?.catch(() => { return null; });
    await server?.stop();
}
async function shutdown(runtime, state, owned) {
    state.stopped = true;
    state.detach?.();
    try { await state.agent?.stop(); } finally {
        try { await runtime.stop(); } finally {
            await Promise.all([owned.close(), stopListener(state.health), stopListener(state.startup)]);
        }
    }
}
/** Local executable host. The external agent can instead use createRuntime directly. */
// eslint-disable-next-line max-statements
export default async function runCollector({ registry, env = process.env, argv = process.argv.slice(2), signals = true, manifestReader = readManifest, ...services }) {
    const probePort = startupPort(env);
    const host = env.COLLECTOR_HEALTH_HOST ?? '127.0.0.1';
    const store = env.COLLECTOR_CONTROL_ENDPOINTS
        ? controlStore(clientFromEnv(env, 'COLLECTOR_CONTROL'), env.COLLECTOR_CONTROL_PREFIX) : null;
    const owned = runtimeServices(env, services);
    let runtime;
    try { runtime = createRuntime({ registry, ...owned }); }
    catch (error) {
        try { await owned.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Collector startup cleanup failed'); }
        throw error;
    }
    const state = { initialized: false, failed: false, health: null, reloading: false, stopped: false, detach: null, agent: null };
    const collector = {
        runtime,
        async reload() {
            if (state.stopped || state.reloading) { throw new Error('Collector stopped or reload in progress'); }
            state.reloading = true;
            try {
                const document = await manifestReader(env, argv, runtime.status());
                await validateManifest(document, registry);
                await apply(runtime, document);
            } finally { Object.assign(state, { reloading: false }); }
        },
        stop() {
            state.shutdown ??= shutdown(runtime, state, owned);
            return state.shutdown;
        }
    };
    if (signals) { state.detach = collectorSignals(collector); }
    try {
        if (env.COLLECTOR_HEALTH_PORT) {
            Object.assign(state, { health: runtimeHealth(healthView(runtime, state, owned.deliveryQueue), {
                port: Number(env.COLLECTOR_HEALTH_PORT), host,
                handle: env.STATE_HTTP_TOKEN ? spoolSurface(owned.deliveryQueue, env.STATE_HTTP_TOKEN, services.spoolMachine) : null,
                staleMs: Number(env.COLLECTOR_LIVE_STALE_MS ?? 30000) }) });
            await state.health;
        }
        const recoveryMs = Number(env.COLLECTOR_RECOVERY_TIMEOUT_MS ?? 900000);
        if (!Number.isSafeInteger(recoveryMs) || recoveryMs < 1) { throw new TypeError('Positive collector recovery timeout required'); }
        await deadline(() => { return initialize(collector, owned, state, { env, registry, store }); }, recoveryMs);
        await startProbe(runtime, state, probePort, host);
    } catch (error) {
        Object.assign(state, { failed: true });
        try { await collector.stop(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Collector startup cleanup failed'); }
        throw error;
    }
    return collector;
}
