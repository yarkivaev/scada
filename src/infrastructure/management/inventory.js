/** Load the host-owned inventory and compose its runtime adapters. */
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import readDocument from '../../application/deploy/readDocument.js';
import topology from '../../application/management/topology.js';
import readObservations, { observationConfig } from './observations.js';
import kubernetes from './kubernetes.js';
import systemd from './systemd.js';
import remote from './remote.js';
import { contextName, urlOf } from './protocol.js';

const name = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,62}$/u);
const unit = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*\.service$/u);
const workload = z.string().regex(/^(?:deployment|statefulset|daemonset|job)\/[a-z0-9][a-z0-9.-]{0,252}$/u);
const target = z.discriminatedUnion('runtime', [
    z.strictObject({
        runtime: z.literal('kubernetes'), kubeContext: z.string().min(1), namespace: name, release: name.optional(),
        workloads: z.array(workload).min(1).max(100).optional(),
        values: z.string().min(1).optional(), releasePlan: z.string().min(1).optional()
    }).refine(({ values, releasePlan, release, workloads }) => {
        return (!values || !releasePlan) && Boolean(release || (workloads && !values && !releasePlan));
    }),
    z.strictObject({ runtime: z.literal('systemd'), units: z.record(unit, z.literal('running')) }),
    z.strictObject({
        runtime: z.literal('remote'), server: z.string(), context: contextName,
        tokenEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/u)
    })
]);
const inventory = z.strictObject({
    contexts: z.record(contextName, target),
    observations: observationConfig,
    system: z.strictObject({
        file: z.string().min(1),
        sites: z.record(contextName, z.array(contextName)).default({})
    }).optional()
});

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

function readSystem(system, directory, targets) {
    if (!system) {
        return undefined;
    }
    const file = resolve(directory, system.file);
    const document = readDocument(readFileSync(file, 'utf8'), (include) => {
        return readFileSync(resolve(dirname(file), include), 'utf8');
    });
    return topology(document, system.sites, targets);
}

export default async function readInventory(path, env) {
    const result = inventory.safeParse(JSON.parse(await readFile(path, 'utf8')));
    if (!result.success) {
        throw new Error(`invalid inventory at ${result.error.issues[0].path.join('.') || 'root'}`);
    }
    const directory = dirname(resolve(path));
    const targets = new Map(Object.entries(result.data.contexts).map(([id, config]) => {
        return [id, {
            runtime: config.runtime, forwards: config.runtime === 'remote', locks: writeLocks(config),
            adapter: adapter(config, directory, env)
        }];
    }));
    const production = readSystem(result.data.system, directory, targets);
    return { targets, topology: production, network: readObservations(result.data.observations, production, env) };
}
