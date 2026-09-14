import { jsonResponse, route } from '@yarkivaev/simple-server';
import topologyFromPlant from '../../../../application/topologyFromPlant.js';
import topologyHealth from '../../../../application/topologyHealth.js';

/**
 * Plant topology graph route.
 *
 * @param {string} basePath - API base path
 * @param {object} plant - plant domain object
 * @param {function} [clock] - () => Date for sensor freshness
 * @returns {array} route objects
 *
 * @example
 *   topologyRoute('/api/v1', plant);
 */
export default function topologyRoute(basePath, plant, clock) {
    return [
        route('GET', `${basePath}/topology`, async (req, res) => {
            const graph = await topologyHealth(topologyFromPlant(plant), plant, clock);
            jsonResponse(graph).send(res);
        })
    ];
}
