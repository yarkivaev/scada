import { readManifest, validateManifest } from './manifest.js';
import collectorSignals from './collectorSignals.js';
import createRuntime from './runtime.js';
import runtimeServices from './runtimeServices.js';
import runtimeHealth from './runtimeHealth.js';
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
/** Local executable host. The external agent can instead use createRuntime directly. */
// eslint-disable-next-line max-statements
export default async function runCollector({ registry, env = process.env, argv = process.argv.slice(2), signals = true, manifestReader = readManifest, ...services }) {
    const owned = runtimeServices(env, services);
    const runtime = createRuntime({ registry, ...owned });
    const state = { health: null, reloading: false, stopped: false, detach: null, agent: null };
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
        async stop() {
            state.stopped = true;
            state.detach?.();
            await state.agent?.stop();
            try { await runtime.stop(); } finally { await Promise.all([owned.close(), state.health?.stop()]); }
        }
    };
    if (signals) { state.detach = collectorSignals(collector); }
    try {
        await owned.open?.();
        if (env.COLLECTOR_CONTROL_ENDPOINTS) {
            const store = controlStore(clientFromEnv(env, 'COLLECTOR_CONTROL'), env.COLLECTOR_CONTROL_PREFIX);
            state.agent = assignmentAgent({ nodeId: env.COLLECTOR_NODE_ID, file: env.COLLECTOR_ASSIGNMENT_FILE, store, runtime,
                validate(document) { return validateManifest(document, registry); },
                onError(error) { process.stderr.write(`collector control: ${error.name}\n`); } });
            await state.agent.start();
        } else { await collector.reload(); }
        if (env.COLLECTOR_HEALTH_PORT) { Object.assign(state, { health: await runtimeHealth(runtime, { port: Number(env.COLLECTOR_HEALTH_PORT), host: env.COLLECTOR_HEALTH_HOST ?? '127.0.0.1' }) }); }
    } catch (error) {
        try { await collector.stop(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Collector startup cleanup failed'); }
        throw error;
    }
    return collector;
}
