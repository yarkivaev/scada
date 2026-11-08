import expand from './expand.js';
import { assertHeld, edgesOf } from './releaseEdges.js';
import { profileFor, serverFor } from './releaseNodes.js';
import { bindModules, busesFor, machinesOf, passedApps, routesFor } from './releaseValues.js';
import frozen from './frozen.js';

/**
 * Starts release values from the scada app and the profile modules.
 *
 * @param {object} profile - resolved profile
 * @returns {object} image and module values
 * @example
 *   withImage({ apps: { scada: { image: 'example.invalid/plant:1' } }, modules: {} });
 */
function withImage(profile) {
    const app = profile.apps && profile.apps.scada;
    const image = app && app.image;
    if (!image) {
        throw new Error('system document has no scada image');
    }
    return { image, ...(app.site && { site: app.site }), ...(app.sink && { sink: app.sink }),
        ...bindModules(profile, app.secret) };
}

/**
 * Copies process fields the chart reads beside the image.
 *
 * @param {object} values - release values
 * @param {object} profile - resolved profile
 * @param {object} server - selected server
 * @returns {object} values with command, service, env, and pull secret
 * @example
 *   withProcess({ image: 'example.invalid/plant:1' }, { apps: { scada: {} } }, {});
 */
function withProcess(values, profile, server) {
    const app = profile.apps && profile.apps.scada;
    const copy = { ...values };
    if (profile.command) {
        copy.command = profile.command;
    }
    if (app && app.pullSecret) {
        copy.pullSecret = app.pullSecret;
    }
    if (server.service) {
        copy.service = server.service;
    }
    if (profile.env) {
        copy.env = profile.env;
    }
    return copy;
}

/**
 * Copies machines, sites, and bus addresses when the server has any.
 *
 * @param {object} values - release values
 * @param {object[]} owned - local fan-in records
 * @param {object[]} routes - incoming sites
 * @param {object[]} buses - fan-out bus bindings
 * @returns {object} values with those lists
 * @example
 *   withFlows({ image: 'example.invalid/plant:1' }, [], [], []);
 */
function withFlows(values, owned, routes, buses) {
    const copy = { ...values };
    if (owned.length > 0) {
        copy.machines = owned;
    }
    if (routes.length > 0) {
        copy.sites = routes;
    }
    if (buses.length > 0) {
        copy.buses = buses;
    }
    return copy;
}

/**
 * Chart values for one server.
 *
 * @param {object} document - expanded document
 * @param {object} server - selected server
 * @param {object} profile - resolved profile
 * @param {object[]} edges - directed edges
 * @returns {object} scada release values
 * @example
 *   scadaRelease({ servers: [] }, { fan_in: [], fan_out: [], id: 'cell' }, { apps: { scada: { image: 'example.invalid/plant:1' } } }, []);
 */
function scadaRelease(document, server, profile, edges) {
    const buses = busesFor(document, server);
    const owned = machinesOf(server);
    const routes = routesFor(document, edges, server);
    const values = withImage(profile);
    return withFlows(withProcess(values, profile, server), owned, routes, buses);
}

/**
 * Cuts one cluster out of a system document.
 *
 * @param {object} document - system document
 * @param {string} cluster - release selector
 * @returns {{apps: object[], scada: object}} scada values and the profile's other apps
 * @example
 *   releases({ profiles: {}, servers: [] }, 'missing');
 */
export default function releases(document, cluster) {
    const expanded = expand(document);
    const host = serverFor(expanded, cluster);
    const links = edgesOf(expanded);
    const profile = profileFor(expanded, host);
    assertHeld(expanded, links);
    return frozen({
        ...(expanded.hmi !== undefined && { hmi: expanded.hmi }),
        ...(profile.target && { target: profile.target }),
        apps: passedApps(profile),
        scada: scadaRelease(expanded, host, profile, links)
    });
}
