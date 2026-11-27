/** Load the host-owned inventory and compose its runtime adapters. */
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import kubernetes from './kubernetes.js';
import systemd from './systemd.js';
import remote from './remote.js';
import { contextName, urlOf } from './protocol.js';

const name = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,62}$/u);
const unit = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*\.service$/u);
const target = z.discriminatedUnion('runtime', [
    z.strictObject({
        runtime: z.literal('kubernetes'), kubeContext: z.string().min(1), namespace: name, release: name,
        values: z.string().min(1).optional(), releasePlan: z.string().min(1).optional()
    }).refine(({ values, releasePlan }) => { return !values || !releasePlan; }),
    z.strictObject({ runtime: z.literal('systemd'), units: z.record(unit, z.literal('running')) }),
    z.strictObject({
        runtime: z.literal('remote'), server: z.string(), context: contextName,
        tokenEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/u)
    })
]);
const inventory = z.strictObject({ contexts: z.record(contextName, target) });

function adapter(config, directory, env) {
    if (config.runtime === 'systemd') {
        return systemd(config);
    }
    if (config.runtime === 'kubernetes') {
        return kubernetes({
            ...config, values: config.values && resolve(directory, config.values),
            releasePlan: config.releasePlan && resolve(directory, config.releasePlan)
        });
    }
    const token = env[config.tokenEnv];
    if (!token) {
        throw new Error(`missing credential ${config.tokenEnv}`);
    }
    return remote({ ...config, token });
}

function writeLocks(config) {
    if (config.runtime === 'systemd') {
        return Object.keys(config.units).map((id) => { return `systemd:${id}`; });
    }
    if (config.runtime === 'kubernetes') {
        return [JSON.stringify(['kubernetes', config.kubeContext, config.namespace])];
    }
    return [JSON.stringify(['remote', urlOf(config.server).origin, config.context])];
}

export default async function readInventory(path, env) {
    const result = inventory.safeParse(JSON.parse(await readFile(path, 'utf8')));
    if (!result.success) {
        throw new Error(`invalid inventory at ${result.error.issues[0].path.join('.') || 'root'}`);
    }
    return new Map(Object.entries(result.data.contexts).map(([id, config]) => {
        return [id, {
            runtime: config.runtime, forwards: config.runtime === 'remote', locks: writeLocks(config),
            adapter: adapter(config, dirname(resolve(path)), env)
        }];
    }));
}
