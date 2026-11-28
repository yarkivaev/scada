/** This module is self-contained so clients can ship it to an existing Node.js pod. */
function canonical(value) {
    if (Array.isArray(value)) { return value.map(canonical); }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => {
            return [key, canonical(value[key])];
        }));
    }
    return value;
}

/** Runtime counters and other fields outside the declaration do not require a write. */
function same(actual, desired) {
    return actual && Object.keys(desired).every((key) => {
        return JSON.stringify(canonical(actual[key])) === JSON.stringify(canonical(desired[key]));
    });
}

function apiAt({ base, username, password }) {
    if (!base || typeof username !== 'string' || typeof password !== 'string') {
        throw new Error('management base, username and password are required');
    }
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    return async (method, path, body) => {
        const response = await fetch(`${base.replace(/\/$/u, '')}/api/${path}`, { method,
            headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
        if (!response.ok) { throw new Error(`broker ${method} ${path}: HTTP ${response.status}`); }
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    };
}

/** A conflicting immutable declaration fails in place, preserving the stored queue. */
async function declare(api, path, desired) {
    const current = await api('GET', path);
    const changes = desired.filter((item) => {
        return !same(current.find((row) => { return row.name === item.name; }), item);
    });
    await Promise.all(changes.map((item) => { return api('PUT', `${path}/${encodeURIComponent(item.name)}`, item); }));
    return changes.length;
}

function identity(item) {
    return { source: item.source, destination: item.destination, kind: item.destination_type || 'queue',
        key: item.routing_key, arguments: item.arguments || {} };
}

function bindingPath(path, item) {
    const kind = item.destination_type === 'exchange' ? 'e' : 'q';
    return `${path}/e/${encodeURIComponent(item.source)}/${kind}/${encodeURIComponent(item.destination)}`;
}

async function bindings(api, path, desired, ownsBinding) {
    const current = await api('GET', path);
    function includes(rows, item) {
        return rows.some((row) => { return same(identity(row), identity(item)); });
    }
    const missing = desired.filter((item) => { return !includes(current, item); });
    const stale = current.filter((item) => { return item.source && ownsBinding?.(item) && !includes(desired, item); });
    await Promise.all(missing.map((item) => {
        return api('POST', bindingPath(path, item), { routing_key: item.routing_key, arguments: item.arguments || {} });
    }));
    await Promise.all(stale.map((item) => {
        return api('DELETE', `${bindingPath(path, item)}/${encodeURIComponent(item.properties_key)}`);
    }));
    return missing.length + stale.length;
}

async function upsertNamed(api, path, desired, body) {
    const current = await api('GET', path) || [];
    const changed = desired.filter((item) => {
        const found = current.find((row) => { return row.name === item.name; });
        return !same(found, body(item));
    });
    await Promise.all(changed.map((item) => {
        return api('PUT', `${path}/${encodeURIComponent(item.name)}`, body(item));
    }));
    return { count: changed.length, current };
}

async function pruneNamed(api, path, current, desired, owns) {
    const stale = current.filter((item) => {
        return owns?.(item) && !desired.some((row) => { return row.name === item.name; });
    });
    await Promise.all(stale.map((item) => { return api('DELETE', `${path}/${encodeURIComponent(item.name)}`); }));
    return stale.length;
}

function parameter(item) {
    return { value: item.value };
}

function policy(item) {
    return { pattern: item.pattern, definition: item.definition, priority: item.priority, 'apply-to': item['apply-to'] };
}

function ensureVirtualHost(objects, vhost) {
    if (objects.some((item) => { return item.vhost !== undefined && item.vhost !== vhost; })) {
        throw new Error('topology contains a different virtual host');
    }
}

async function reconcileShovels(api, path, desired, owns) {
    const shovels = await upsertNamed(api, path, desired, parameter);
    return shovels.count + await pruneNamed(api, path, shovels.current, desired, owns);
}

/** Apply only topology belonging to the selected virtual host. Users and permissions are bootstrap data. */
export default async function reconcileRabbitmq(desired, options) {
    const { vhost, ownsBinding, ownsShovel } = options;
    if (!vhost) { throw new Error('a virtual host is required'); }
    const api = apiAt(options);
    const host = encodeURIComponent(vhost);
    const objects = [...desired.exchanges, ...desired.queues, ...desired.bindings, ...desired.parameters];
    ensureVirtualHost(objects, vhost);
    if (desired.parameters.some((item) => { return item.component !== 'shovel'; })) {
        throw new Error('only shovel parameters can be reconciled');
    }
    const exchanges = await declare(api, `exchanges/${host}`, desired.exchanges);
    const queues = await declare(api, `queues/${host}`, desired.queues);
    const links = await bindings(api, `bindings/${host}`, desired.bindings, ownsBinding);
    const parameters = await reconcileShovels(api, `parameters/shovel/${host}`, desired.parameters, ownsShovel);
    return exchanges + queues + links + parameters;
}

/** Apply only dynamic shovels managed by a caller. */
export function reconcileRabbitmqShovels(desired, options) {
    const { vhost, ownsShovel, api = apiAt(options) } = options;
    if (!vhost) { throw new Error('a virtual host is required'); }
    ensureVirtualHost(desired, vhost);
    if (desired.some((item) => { return item.component !== 'shovel'; })) {
        throw new Error('only shovel parameters can be reconciled');
    }
    return reconcileShovels(api, `parameters/shovel/${encodeURIComponent(vhost)}`, desired, ownsShovel);
}

/** Reconcile federation objects for one vhost. Only owned objects are eligible for deletion. */
export async function reconcileRabbitmqFederation(desired, options) {
    const { vhost, ownsUpstream, ownsPolicy } = options;
    if (!vhost) { throw new Error('a virtual host is required'); }
    const upstreams = (desired.parameters || []).filter((row) => { return row.component === 'federation-upstream'; });
    const policies = desired.policies || [];
    ensureVirtualHost([...upstreams, ...policies], vhost);
    const host = encodeURIComponent(vhost);
    const api = apiAt(options);
    const upstreamPath = `parameters/federation-upstream/${host}`;
    const policyPath = `policies/${host}`;
    const links = await upsertNamed(api, upstreamPath, upstreams, parameter);
    const rules = await upsertNamed(api, policyPath, policies, policy);
    const dropped = await pruneNamed(api, upstreamPath, links.current, upstreams, ownsUpstream);
    const retired = await pruneNamed(api, policyPath, rules.current, policies, ownsPolicy);
    return links.count + rules.count + dropped + retired;
}

/** Apply queue bindings and shovels before changing federation. */
export async function reconcileRabbitmqTopology(desired, options) {
    const parameters = desired.parameters || [];
    ensureVirtualHost([...parameters, ...(desired.policies || [])], options.vhost);
    const shovels = parameters.filter((row) => { return row.component === 'shovel'; });
    const topology = await reconcileRabbitmq({ ...desired, parameters: shovels }, options);
    return topology + await reconcileRabbitmqFederation(desired, options);
}
