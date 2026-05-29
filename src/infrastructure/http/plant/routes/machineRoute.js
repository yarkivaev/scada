import machineInPlant from '../../../../application/machineInPlant.js';
import { errorResponse, jsonResponse, route } from '@yarkivaev/simple-server';

/**
 * Machine list and info routes.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object
 * @returns {array} route objects
 *
 * @example
 *   machineRoute('/api/v1', plant);
 */
export default function machineRoute(basePath, plant) {
    function all() {
        return Object.values(plant.shops.get()).flatMap((area) => {
            return Object.values(area.machines.get()).map((item) => {
                return { id: item.name(), name: item.name() };
            });
        });
    }
    return [
        route('GET', `${basePath}/machines`, (req, res) => {
            jsonResponse({ items: all() }).send(res);
        }),
        route('GET', `${basePath}/machines/:machineId`, (req, res, params) => {
            const result = machineInPlant(plant, params.machineId);
            if (!result) {
                errorResponse('NOT_FOUND', `Machine '${params.machineId}' not found`, 404).send(res);
                return;
            }
            jsonResponse({ id: result.machine.name(), name: result.machine.name() }).send(res);
        })
    ];
}
