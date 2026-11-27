/** Read bounded RabbitMQ queue snapshots through the management HTTP API. */
import responseJson from './responseJson.js';
import { urlOf } from './protocol.js';

const pageSize = 100;
const maxPages = 10;

function number(value) {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function queueOf(row) {
    const stats = row.message_stats;
    return {
        name: row.name,
        ready: number(row.messages_ready),
        unacked: number(row.messages_unacknowledged),
        consumers: number(row.consumers),
        bytes: number(row.message_bytes),
        publishRate: number(stats?.publish_details?.rate),
        ackRate: number(stats?.ack_details?.rate)
    };
}

function credentials({ username, passwordEnv }, env) {
    if (!username) {
        return {};
    }
    if (!env[passwordEnv]) {
        throw new Error(`missing credential ${passwordEnv}`);
    }
    const encoded = Buffer.from(`${username}:${env[passwordEnv]}`).toString('base64');
    return { authorization: `Basic ${encoded}` };
}

export default function rabbitmqLoad({ site, url, vhost, prefix, username, passwordEnv }, env) {
    const { origin } = urlOf(url);
    const headers = credentials({ username, passwordEnv }, env);
    const endpoint = new URL(`/api/queues/${encodeURIComponent(vhost)}`, origin);
    const search = endpoint.searchParams;
    search.set('pagination', 'true');
    search.set('page_size', String(pageSize));
    if (prefix) {
        search.set('name', `^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`);
        search.set('use_regex', 'true');
    }

    async function page(index) {
        const target = new URL(endpoint);
        target.searchParams.set('page', String(index));
        const response = await fetch(target, { headers, redirect: 'error', signal: AbortSignal.timeout(8000) })
            .catch(() => { throw new Error('RabbitMQ management endpoint unavailable'); });
        if (!response.ok) {
            throw new Error(`RabbitMQ management HTTP ${response.status}`);
        }
        const data = await responseJson(response, 4 * 1024 * 1024).catch(() => { return null; });
        if (!Array.isArray(data?.items) || !Number.isInteger(data.page_count) || data.page_count < 0) {
            throw new Error('invalid RabbitMQ queue response');
        }
        return data;
    }

    async function sample() {
        const first = await page(1);
        if (first.page_count > maxPages) {
            throw new Error('RabbitMQ queue scope is too large; configure a narrower prefix');
        }
        const rest = await Promise.all(Array.from({ length: Math.max(0, first.page_count - 1) }, (unused, index) => {
            return page(index + 2);
        }));
        const rows = [first, ...rest].flatMap(({ items }) => { return items; });
        const queues = new Map(rows.filter((row) => {
            return typeof row?.name === 'string' && (!prefix || row.name.startsWith(prefix));
        }).map((row) => { return [row.name, queueOf(row)]; }));
        return Array.from(queues.values());
    }

    return { site, sample };
}
