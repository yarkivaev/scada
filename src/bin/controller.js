#!/usr/bin/env node
import { clientFromEnv, controller, controlStore } from '../application/control/index.js';
try {
    if (!process.env.CONTROL_NODE_ID) { throw new Error('CONTROL_NODE_ID required'); }
    const store = controlStore(clientFromEnv(process.env), process.env.CONTROL_PREFIX);
    const host = controller(store, process.env.CONTROL_NODE_ID, { clockSkewMs: Number(process.env.CONTROL_CLOCK_SKEW_MS ?? 5000), replacementDelayMs: Number(process.env.CONTROL_REPLACEMENT_DELAY_MS ?? 30000), onError(error) { process.stderr.write(`controller: ${error.name}\n`); } });
    for (const signal of ['SIGTERM', 'SIGINT']) { process.once(signal, () => { void host.stop(); }); }
} catch (error) { process.stderr.write(`controller: ${error.name}\n`); process.exitCode = 1; }
