/**
 * Top-level plant structure containing shops.
 * Provides initialization for all contained shops.
 *
 * @param {object} shops - initialized list of shops
 * @param {object} [options] - operations, topology
 * @returns {object} plant with shops property and init method
 *
 * @example
 *   const p = plant(initialized({ area: shop }, Object.values), { topology: () => graph });
 *   p.init();
 */
export default function plant(shops, options = {}) {
    return {
        shops,
        operations: options.operations,
        topology: options.topology,
        init() {
            shops.init();
        }
    };
}
