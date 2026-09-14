import { jsonResponse, route } from '@yarkivaev/simple-server';
import topologyFromPlant from '../../../../application/topologyFromPlant.js';

/**
 * Plant topology graph route.
 *
 * @param {string} basePath - API base path
 * @param {object} plant - plant domain object
 * @returns {array} route objects
 *
 * @example
 *   topologyRoute('/api/v1', plant);
 */
export default function topologyRoute(basePath, plant) {
    return [
        route('GET', `${basePath}/topology`, (req, res) => {
            jsonResponse(topologyFromPlant(plant)).send(res);
        })
    ];
}
