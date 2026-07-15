import operatorJson from '../json/operatorJson.js';
import { jsonResponse, route, sendRouteError } from '@yarkivaev/simple-server';

/**
 * Operator list route for central plant API.
 *
 * @param {string} basePath - base URL path
 * @param {object} provider - operators provider with list()
 * @param {object} [logger] - optional logger with error(message, err)
 * @returns {array} route objects
 *
 * @example
 *   operatorRoute('/api/v1', operatorsFromPg(pool));
 */
export default function operatorRoute(basePath, provider, logger) {
    return [
        route('GET', `${basePath}/operators`, async (req, res) => {
            try {
                const rows = await provider.list();
                jsonResponse({ items: rows.map(operatorJson) }).send(res);
            } catch (err) {
                const message = `GET ${basePath}/operators failed: ${err && err.message ? err.message : 'unknown error'}`;
                if (logger && typeof logger.error === 'function') {
                    logger.error(message, err);
                } else {
                    console.error(message, err); // eslint-disable-line no-console
                }
                sendRouteError(res, err);
            }
        })
    ];
}
