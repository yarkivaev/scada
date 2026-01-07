/**
 * Melting shop containing melting machines and their meltings.
 * Provides initialization for all contained machines.
 *
 * @param {string} name - unique identifier for the shop
 * @param {object} meltingMachines - initialized wrapper of melting machines
 * @param {object} meltings - collection managing melting sessions
 * @returns {object} shop with name, machines, meltings properties and init method
 *
 * @example
 *   const shop = meltingShop('shop1', initialized({ m1: machine }, Object.values), meltings());
 *   shop.name(); // 'shop1'
 *   shop.machines.init().m1; // access machine by key
 *   shop.init();
 */
export default function meltingShop(name, meltingMachines, meltings) {
    return {
        name() {
            return name;
        },
        machines: meltingMachines,
        meltings,
        init() {
            meltingMachines.init();
        },
    };
}
