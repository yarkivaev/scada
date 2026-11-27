/** Bind trusted monitoring sources and exclusive route queues at gateway startup. */
import { z } from 'zod';
import networkLoad from '../../application/management/networkLoad.js';
import controlLoad from './controlLoad.js';
import { contextName } from './protocol.js';
import prometheusLoad from './prometheusLoad.js';
import rabbitmqLoad from './rabbitmqLoad.js';

const credential = z.string().regex(/^[A-Z_][A-Z0-9_]*$/u);
const queueName = z.string().min(1).max(300);
const rabbitmq = z.strictObject({
    site: contextName, url: z.string().min(1), vhost: z.string().min(1).default('/'),
    prefix: z.string().max(150).optional(), username: z.string().min(1).optional(), passwordEnv: credential.optional()
}).refine(({ username, passwordEnv }) => { return Boolean(username) === Boolean(passwordEnv); });
const metric = z.strictObject({
    name: contextName, query: z.string().min(1).max(5000), unit: z.string().max(40),
    resourceLabel: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/u).optional()
});
const prometheus = z.strictObject({
    site: contextName, url: z.string().min(1), tokenEnv: credential.optional(), metrics: z.array(metric).min(1).max(30)
});
const control = z.strictObject({
    site: contextName, envPrefix: credential.default('CONTROL'),
    keyPrefix: z.string().min(1).max(200).optional()
});
const link = z.strictObject({
    from: contextName, to: contextName, broker: contextName, queue: queueName, stream: queueName.optional()
});
export const observationConfig = z.strictObject({
    rabbitmq: z.record(contextName, rabbitmq).default({}),
    prometheus: z.record(contextName, prometheus).default({}),
    control: z.record(contextName, control).default({}),
    links: z.array(link).default([])
}).default({ rabbitmq: {}, prometheus: {}, control: {}, links: [] });

function validateLinks(links, brokers, topology) {
    const sites = new Set(topology?.sites.map(({ name }) => { return name; }));
    const seen = new Set();
    links.forEach(({ from, to, broker, queue, stream }) => {
        if (!sites.has(from) || !sites.has(to) || brokers.get(broker)?.site !== from || from === to) {
            throw new Error(`invalid route observation ${from} -> ${to}`);
        }
        const key = JSON.stringify([broker, queue]);
        if (seen.has(key)) {
            throw new Error(`route observation queue ${queue} is already bound`);
        }
        if (stream && !topology.flows.some((flow) => {
            return flow.from === from && flow.to === to && flow.streams.includes(stream);
        })) {
            throw new Error(`unknown stream ${stream} on route ${from} -> ${to}`);
        }
        seen.add(key);
    });
}

function shared(source) {
    let pending;
    function sample() {
        pending ??= source.sample().finally(() => { pending = undefined; });
        return pending;
    }
    return { ...source, sample };
}

export default function readObservations(config, topology, env) {
    const brokers = new Map(Object.entries(config.rabbitmq).map(([name, source]) => {
        return [name, shared(rabbitmqLoad(source, env))];
    }));
    validateLinks(config.links, brokers, topology);
    const metrics = new Map(Object.entries(config.prometheus).map(([name, source]) => {
        return [name, shared(prometheusLoad(source, env))];
    }));
    Object.entries(config.control).forEach(([name, source]) => {
        if (metrics.has(name)) {
            throw new Error(`duplicate metric source ${name}`);
        }
        metrics.set(name, shared(controlLoad(source, env)));
    });
    return networkLoad(brokers, metrics, config.links);
}
