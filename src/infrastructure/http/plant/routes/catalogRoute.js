import { jsonResponse, route } from '@yarkivaev/simple-server';
import tagCatalog from '../../../catalog/tagCatalog.js';

/**
 * Tag catalog HTTP routes for HMI label/cascade lookup.
 *
 * @param {string} basePath - base URL path
 * @param {object} [catalog] - optional preloaded catalog
 * @returns {array} route objects
 *
 * @example
 *   catalogRoute('/api/v1');
 */
export default function catalogRoute(basePath, catalog) {
    const loaded = catalog || tagCatalog();
    return [
        route('GET', `${basePath}/tag-catalog`, (req, res) => {
            jsonResponse({ items: loaded.entries() }).send(res);
        })
    ];
}
