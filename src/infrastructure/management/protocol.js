/** Versioned management protocol shared by the server, CLI and forwarding runtime. */
import { z } from 'zod';

export const endpoint = '/api/management/v1/command';
export const contextName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/u);
const scope = { forwarded: z.boolean().optional() };
export const request = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('contexts') }),
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
const results = {
    contexts: z.object({ contexts: z.array(z.object({ name: contextName, runtime: z.string() })) }),
    components: z.object({ contexts: z.array(z.union([
        z.object({ name: contextName, components: z.array(component) }),
        z.object({ name: contextName, error: z.string() })
    ])) }),
    logs: z.object({ logs: z.string() }),
    plan: changes,
    apply: changes
};

export async function send(server, token, command) {
    const url = urlOf(server);
    const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(command),
        redirect: 'error',
        signal: AbortSignal.timeout(command.action === 'apply' ? 720000 : 90000)
    });
    const data = await response.json().catch(() => { return null; });
    if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `management HTTP ${response.status}`);
    }
    const result = results[command.action].safeParse(data);
    if (!result.success) {
        throw new Error('invalid response from management server');
    }
    return result.data;
}
