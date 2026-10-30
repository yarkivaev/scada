import { nodeFor, profileFor } from './releaseNodes.js';
import { assertHeld, edgesOf } from './releaseEdges.js';
import { bindModules, passedApps, routesFor, telemetryOf } from './releaseValues.js';

/**
 * Copies process fields the chart reads beside the image.
 *
 * @param {object} values - release values
 * @param {object} profile - implementation profile
 * @param {object} node - selected node
 * @param {object|undefined} app - scada app entry
 * @returns {object} the same values
 * @example
 *   withProcess(values, profile, node, app);
 */
function withProcess(values, profile, node, app) {
    if (profile.command) {
        values.command = profile.command;
    }
    if (app && app.pullSecret) {
        values.pullSecret = app.pullSecret;
    }
    if (node.implementation.service) {
        values.service = node.implementation.service;
    }
    if (profile.env) {
        values.env = profile.env;
    }
    return values;
}

/**
 * Copies telemetry and routes when the node has any.
 *
 * @param {object} values - release values
 * @param {object[]} telemetry - fan-in records
 * @param {object[]} routes - routes to source nodes
 * @returns {object} the same values
 * @example
 *   withObjects(values, owned, routes);
 */
function withObjects(values, owned, routes) {
    if (owned.length > 0) {
        values.machines = owned;
    }
    if (routes.length > 0) {
        values.sites = routes;
    }
    return values;
}

/**
 * Chart values for one node.
 *
 * @param {object} document - system document
 * @param {object} node - selected node
 * @param {object} profile - implementation profile
 * @param {object[]} edges - directed edges
 * @returns {object} scada release values
 * @example
 *   scadaRelease(document, node, profile, []);
 */
function scadaRelease(document, node, profile, edges) {
    const app = document.apps && document.apps.scada;
    const image = profile.image || (app && app.image);
    if (!image) {
        throw new Error('system document has no scada image');
    }
    const values = withProcess(
        { image, ...bindModules(profile, app && app.secret) },
        profile,
        node,
        app
    );
    return withObjects(values, telemetryOf(document, node), routesFor(document, edges, node));
}

/**
 * Cuts one cluster out of a system document.
 *
 * @example
 *   releases(document, 'archive').scada.image;
 *
 * @param {object} document - system document
 * @param {string} cluster - release selector
 * @returns {{scada: object, apps: object[]}} scada values and pass-through apps
 */
export default function releases(document, cluster) {
    const node = nodeFor(document, cluster);
    const profile = profileFor(document, node);
    const edges = edgesOf(document);
    assertHeld(document, edges);
    return {
        apps: passedApps(document, cluster),
        scada: scadaRelease(document, node, profile, edges)
    };
}
