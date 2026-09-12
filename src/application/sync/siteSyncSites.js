/**
 * Builds the allowlist of remote plant APIs a site may pull from.
 *
 * Reads SYNC_SITES, EDGE_SITES, and CENTRAL_PLANT_URL. First id wins.
 *
 * @param {NodeJS.ProcessEnv} env - process environment
 * @returns {object[]} frozen sites with id, url, optional token and machines
 *
 * @example
 *   siteSyncSites({ SYNC_SITES: '[{"id":"edge-icht-1","url":"http://edge/api/v1"}]' });
 */
function parseJson(raw, label) {
    try {
        return JSON.parse(raw);
    } catch (cause) {
        throw new Error(`${label} must be valid JSON: ${cause.message}`);
    }
}

function asSite(raw, index, label) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`${label}[${index}] must be an object`);
    }
    const url = raw.url || raw.baseUrl;
    if (typeof url !== 'string' || url.length === 0) {
        throw new Error(`${label}[${index}] requires url`);
    }
    const id = raw.id || (Array.isArray(raw.machines) && raw.machines[0]) || `${label}-${index}`;
    const site = { id, url };
    if (typeof raw.token === 'string' && raw.token.length > 0) {
        site.token = raw.token;
    }
    if (Array.isArray(raw.machines) && raw.machines.length > 0) {
        site.machines = raw.machines;
    }
    return Object.freeze(site);
}

function parseList(raw, label) {
    const parsed = parseJson(raw, label);
    if (!Array.isArray(parsed)) {
        throw new Error(`${label} must be a JSON array`);
    }
    return parsed.map((item, index) => {
        return asSite(item, index, label);
    });
}

function merge(lists) {
    const seen = new Map();
    lists.flat().forEach((site) => {
        if (!seen.has(site.id)) {
            seen.set(site.id, site);
        }
    });
    return [...seen.values()];
}

export default function siteSyncSites(env) {
    const lists = [];
    if (typeof env.SYNC_SITES === 'string' && env.SYNC_SITES.length > 0) {
        lists.push(parseList(env.SYNC_SITES, 'SYNC_SITES'));
    }
    if (typeof env.EDGE_SITES === 'string' && env.EDGE_SITES.length > 0) {
        lists.push(parseList(env.EDGE_SITES, 'EDGE_SITES'));
    }
    if (typeof env.CENTRAL_PLANT_URL === 'string' && env.CENTRAL_PLANT_URL.length > 0) {
        lists.push([Object.freeze({ id: 'central', url: env.CENTRAL_PLANT_URL })]);
    }
    return merge(lists);
}

export function siteById(sites, id) {
    const found = sites.find((site) => {
        return site.id === id;
    });
    if (!found) {
        throw new Error(`site sync unknown site ${id}`);
    }
    return found;
}
