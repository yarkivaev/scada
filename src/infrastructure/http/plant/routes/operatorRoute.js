import operatorJson from '../json/operatorJson.js';
import { jsonResponse, route } from '@yarkivaev/simple-server';

/**
 * Operator list route for central plant API.
 *
 * @param {string} basePath - base URL path
 * @param {object} provider - operators provider with list()
 * @returns {array} route objects
 *
 * @example
 *   operatorRoute('/api/v1', operatorsFromPg(pool));
 */
export default function operatorRoute(basePath, provider) {
    return [
        route('GET', `${basePath}/operators`, async (req, res) => {
            const rows = await provider.list();
            jsonResponse({ items: rows.map(operatorJson) }).send(res);
        })
    ];
}
