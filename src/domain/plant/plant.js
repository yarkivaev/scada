/**
 * Top-level plant structure containing shops.
 * Provides initialization for all contained shops.
 *
 * @param {object} shops - initialized list of shops
 * @returns {object} plant with shops property and init method
 *
 * @example
 *   const p = plant(initialized({ area: shop }, Object.values));
 *   p.init();
 */
export default function plant(shops, options = {}) {
    return {
        shops,
        operations: options.operations,
        init() {
            shops.init();
        }
    };
}
