/**
 * Melting shop containing a collection of melting machines.
 * Provides initialization for all contained machines.
 *
 * @param {object} meltingMachines - initialized list of melting machines
 * @returns {object} shop with machines property and init method
 *
 * @example
 *   const shop = meltingShop(initializedList(machine1, machine2));
 *   shop.machines.list(); // [machine1, machine2]
 *   shop.init();
 */
export default function meltingShop(meltingMachines) {
    return {
        machines: meltingMachines,
        init() {
            meltingMachines.init();
        },
    };
}
