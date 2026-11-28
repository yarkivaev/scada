/**
 * Parses EDGE_SITES JSON; empty array or blank → undefined (all-local STOMP).
 *
 * @param {string} raw - EDGE_SITES value
 * @returns {Array|{sites: object}|undefined} array sites, legacy map, or undefined
 */
function parseEdgeSites(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (cause) {
        throw new Error(`EDGE_SITES must be valid JSON: ${cause.message}`);
    }
    if (Array.isArray(parsed)) {
        return parsed.length === 0 ? undefined : parsed;
    }
    if (parsed && typeof parsed === 'object') {
        return { sites: parsed };
    }
    throw new Error('EDGE_SITES must be a JSON array of { baseUrl, machines, token? }');
}

/**
 * Builds machineOwners site list from legacy EDGE_SITES + MACHINE_OWNERS maps.
 *
 * @param {object} sites - siteId → { baseUrl, token? }
 * @param {object} owners - machineId → siteId
 * @returns {Array<{baseUrl: string, token?: string, machines: string[]}>} site list
 */
function sitesFromMaps(sites, owners) {
    const buckets = new Map();
    for (const [machineId, siteId] of Object.entries(owners)) {
        if (typeof siteId === 'string' && siteId.length > 0 && siteId !== 'local') {
            const site = sites[siteId];
            if (!site || typeof site.baseUrl !== 'string' || site.baseUrl.length === 0) {
                throw new Error(`MACHINE_OWNERS machine ${machineId} references unknown site ${siteId}`);
            }
            if (!buckets.has(siteId)) {
                buckets.set(siteId, {
                    baseUrl: site.baseUrl,
                    token: site.token,
                    machines: []
                });
            }
            buckets.get(siteId).machines.push(machineId);
        }
    }
    return [...buckets.values()];
}

/**
 * Validates one EDGE_SITES array entry for machineOwners.
 *
 * @param {object} site - site descriptor
 * @param {number} index - array index for error context
 * @returns {object} site with baseUrl, machines, optional token
 */
function normalizeSite(site, index) {
    if (!site || typeof site !== 'object' || Array.isArray(site)) {
        throw new Error(`EDGE_SITES[${index}] must be an object`);
    }
    if (typeof site.baseUrl !== 'string' || site.baseUrl.length === 0) {
        throw new Error(`EDGE_SITES[${index}] requires baseUrl`);
    }
    if (!Array.isArray(site.machines) || site.machines.length === 0) {
        throw new Error(`EDGE_SITES[${index}] requires non-empty machines`);
    }
    return {
        baseUrl: site.baseUrl,
        machines: site.machines,
        token: site.token
    };
}

/**
 * Parses legacy MACHINE_OWNERS object map.
 *
 * @param {string} raw - MACHINE_OWNERS JSON
 * @returns {object} machineId → siteId map
 */
function parseOwnersMap(raw) {
    let owners;
    try {
        owners = JSON.parse(raw);
    } catch (cause) {
        throw new Error(`MACHINE_OWNERS must be valid JSON: ${cause.message}`);
    }
    if (!owners || typeof owners !== 'object' || Array.isArray(owners)) {
        throw new Error('MACHINE_OWNERS must be a JSON object');
    }
    return owners;
}

/**
 * Legacy two-map form: EDGE_SITES object + MACHINE_OWNERS.
 *
 * @param {object} sites - siteId → { baseUrl, token? }
 * @param {NodeJS.ProcessEnv} env - process environment
 * @returns {Array<{baseUrl: string, token?: string, machines: string[]}>} site list
 */
function legacyFromMaps(sites, env) {
    const ownersRaw = env.MACHINE_OWNERS;
    if (typeof ownersRaw !== 'string' || ownersRaw.length === 0) {
        throw new Error('legacy EDGE_SITES object map requires MACHINE_OWNERS');
    }
    return sitesFromMaps(sites, parseOwnersMap(ownersRaw));
}

/**
 * Reads EDGE_SITES into a machineOwners site list.
 *
 * Primary (infra / scada): JSON array of { baseUrl, machines, token? }.
 * Unset, empty string, or `[]` → undefined (legacy all-local STOMP).
 * Optional legacy: EDGE_SITES object map + MACHINE_OWNERS machine→siteId map.
 *
 * @param {NodeJS.ProcessEnv} [env] - process environment
 * @returns {Array<{baseUrl: string, token?: string, machines: string[]}>|undefined} sites
 *
 * @example
 *   edgeSitesFromEnv({
 *     EDGE_SITES: '[{"baseUrl":"http://edge:30300/api/v1","machines":["fixture-pump"]}]'
 *   });
 */
export default function edgeSitesFromEnv(env = process.env) {
    const sitesRaw = env.EDGE_SITES;
    if (typeof sitesRaw !== 'string' || sitesRaw.length === 0) {
        return undefined;
    }
    const parsed = parseEdgeSites(sitesRaw);
    if (!parsed) {
        return undefined;
    }
    if (Array.isArray(parsed)) {
        return parsed.map(normalizeSite);
    }
    return legacyFromMaps(parsed.sites, env);
}
