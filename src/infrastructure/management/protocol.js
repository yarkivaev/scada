/** Versioned management protocol shared by the server, CLI and forwarding runtime. */
import { z } from 'zod';

export const endpoint = '/api/management/v1/command';
export const contextName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/u);
const scope = { forwarded: z.boolean().optional() };
export const request = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('contexts') }),
    z.strictObject({ action: z.literal('status'), context: contextName.optional() }),
    z.strictObject({ action: z.literal('load'), context: contextName.optional() }),
    z.strictObject({ action: z.literal('components'), context: contextName.optional(), ...scope }),
    z.strictObject({
        action: z.literal('logs'), context: contextName, ...scope,
        component: z.string().min(1).max(300), tail: z.int().min(1).max(1000).default(100)
    }),
    z.strictObject({ action: z.literal('plan'), context: contextName, ...scope }),
    z.strictObject({ action: z.literal('apply'), context: contextName, ...scope })
]);

export function loopback(host) {
    return ['127.0.0.1', '::1', '[::1]'].includes(host);
}

export function urlOf(value) {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url.hostname))) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('management server must be an HTTPS origin (HTTP is allowed on loopback)');
    }
    if (url.protocol === 'https:' && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
        throw new Error('HTTPS management requires TLS certificate verification');
    }
    return new URL(endpoint, url);
}

const component = z.object({
    id: z.string(), state: z.enum(['ready', 'stopped', 'pending', 'failed'])
});
const changes = z.object({ changes: z.array(z.object({ id: z.string(), action: z.string() })) });
const components = z.object({ contexts: z.array(z.union([
    z.object({ name: contextName, components: z.array(component) }),
    z.object({ name: contextName, error: z.string() })
])) });
const traffic = z.enum(['flowing', 'idle', 'unknown']);
const observation = z.object({
    broker: contextName, queue: z.string(), stream: z.string().optional(), traffic, ackRate: z.number().optional()
});
const queue = z.object({
    name: z.string(), ready: z.number().optional(), unacked: z.number().optional(), consumers: z.number().optional(),
    bytes: z.number().optional(), publishRate: z.number().optional(), ackRate: z.number().optional()
});
const metric = z.union([
    z.object({ name: z.string(), unit: z.string(), resource: z.string().optional(), value: z.number() }),
    z.object({ name: z.string(), unit: z.string(), resource: z.string().optional(), error: z.string() })
]);
const source = { name: contextName, site: contextName };
const sourceError = z.object({ ...source, error: z.string() });
const load = z.object({ load: z.object({
    brokers: z.array(z.union([z.object({ ...source, queues: z.array(queue) }), sourceError])),
    metrics: z.array(z.union([z.object({ ...source, metrics: z.array(metric) }), sourceError]))
}) });
const state = z.enum(['ready', 'degraded', 'unknown']);
const topology = z.object({ topology: z.object({
    state,
    namespace: z.array(z.string()),
    sites: z.array(z.object({
        name: z.string(), state, contexts: z.array(contextName),
        objects: z.array(z.string()), localStreams: z.array(z.string())
    })),
    flows: z.array(z.object({
        from: z.string(), to: z.string(), streams: z.array(z.string()), declared: z.boolean().optional(),
        traffic, evidence: z.array(observation)
    }))
}) });
const results = {
    contexts: z.object({ contexts: z.array(z.object({ name: contextName, runtime: z.string() })) }),
    components,
    status: z.union([topology, components]),
    load,
    logs: z.object({ logs: z.string() }),
    plan: changes,
    apply: changes
};

function deadline({ action, forwarded }) {
    if (action === 'apply') {
        return 720000;
    }
    return forwarded ? 45000 : 90000;
}

export async function send(server, token, command) {
    const url = urlOf(server);
    const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(command),
        redirect: 'error',
        signal: AbortSignal.timeout(deadline(command))
    });
    const data = await response.json().catch(() => { return null; });
    if (command.action === 'status' && response.status === 400 && data?.error === 'invalid management command') {
        return send(server, token, { ...command, action: 'components' });
    }
    if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `management HTTP ${response.status}`);
    }
    const result = results[command.action].safeParse(data);
    if (!result.success) {
        throw new Error('invalid response from management server');
    }
    return result.data;
}
