import machineInPlant from '../machineInPlant.js';

/**
 * Finds a plant machine from a namespace path or a bare machine id.
 *
 * @param {object} plant - plant hierarchy
 * @param {string} path - namespace path or machine id
 * @returns {object} machine and optional metric key
 *
 * @example
 *   locate(plant, 'fixture/site/pump/power').metric;
 */
export default function locate(plant, path) {
    const parts = path.split('/');
    for (let index = parts.length - 1; index >= 0; index -= 1) {
        const found = machineInPlant(plant, parts[index]);
        if (found) {
            return {
                machine: found.machine,
                metric: index === parts.length - 1 ? '' : parts[parts.length - 1]
            };
        }
    }
    throw new Error(`Namespace machine is missing: ${path}`);
}
