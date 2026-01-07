/**
 * Melting shop containing melting machines and their meltings.
 * Provides initialization for all contained machines.
 *
 * @param {object} meltingMachines - initialized list of melting machines
 * @param {object} meltings - collection managing melting sessions
 * @returns {object} shop with machines, meltings properties and init method
 *
 * @example
 *   const shop = meltingShop(initializedList(machine1, machine2), meltings());
 *   shop.machines.list(); // [machine1, machine2]
 *   shop.meltings.start(machine1); // start melting session
 *   shop.init();
 */
export default function meltingShop(meltingMachines, meltings) {
    return {
        machines: meltingMachines,
        meltings,
        init() {
            meltingMachines.init();
        },
    };
}
