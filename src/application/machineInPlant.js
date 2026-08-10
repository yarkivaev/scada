/**
 * Locates a machine inside a plant by id.
 *
 * @param {object} plant - plant with shops
 * @param {string} id - machine id
 * @returns {object|undefined} machine and shop or undefined
 *
 * @example
 *   const found = machineInPlant(plant, 'm1');
 *   found.machine.sensors;
 */
export default function machineInPlant(plant, id) {
    for (const area of Object.values(plant.shops.get())) {
        const found = area.machines.get()[id];
        if (found) {
            return { machine: found, shop: area };
        }
    }
    return undefined;
}
