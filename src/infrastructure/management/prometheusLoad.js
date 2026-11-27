/** Read configured Prometheus instant queries as site load observations. */
import responseJson from './responseJson.js';
import { urlOf } from './protocol.js';

const maxSeries = 200;

function rowsOf({ resultType, result }) {
    if (resultType === 'scalar') {
        return [{ value: result }];
    }
    if (resultType === 'vector' && Array.isArray(result)) {
        return result;
    }
    return [];
}

function observations(data, base, resourceLabel) {
    return rowsOf(data).flatMap((series) => {
        const raw = series?.value?.[1];
        if (typeof raw !== 'string' || !raw.trim() || !Number.isFinite(Number(raw))) {
            return [];
        }
        const label = resourceLabel && series.metric?.[resourceLabel];
        return [{
            ...base, value: Number(raw),
            ...(typeof label === 'string' && label && { resource: label.replace(/\p{Cc}/gu, '') })
        }];
    });
}

function queryRows({ status, data }, base, resourceLabel) {
    if (status !== 'success' || !data) {
        return [{ ...base, error: 'Prometheus query failed' }];
    }
    const rows = observations(data, base, resourceLabel);
    if (rows.length > maxSeries) {
        return [{ ...base, error: 'too many Prometheus series for this query' }];
    }
    return rows.length ? rows : [{ ...base, error: 'no finite Prometheus samples' }];
}

async function measure(endpoint, headers, { name, query, unit, resourceLabel }) {
    const base = { name, unit };
    const url = new URL(endpoint);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', String(maxSeries + 1));
    try {
        const response = await fetch(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
            return [{ ...base, error: 'Prometheus query failed' }];
        }
        return queryRows(await responseJson(response, 1024 * 1024), base, resourceLabel);
    } catch {
        return [{ ...base, error: 'Prometheus query failed' }];
    }
}

export default function prometheusLoad({ site, url, tokenEnv, metrics }, env = process.env) {
    const endpoint = new URL('/api/v1/query', urlOf(url));
    const token = tokenEnv && env[tokenEnv];
    if (tokenEnv && !token) {
        throw new Error(`missing credential ${tokenEnv}`);
    }
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    return { site, async sample() {
        const groups = await Promise.all(metrics.map((metric) => { return measure(endpoint, headers, metric); }));
        return groups.flat();
    } };
}
