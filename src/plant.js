/**
 * Top-level plant structure containing melting shops.
 * Provides initialization for all contained shops.
 *
 * @param {object} shops - initialized list of melting shops
 * @returns {object} plant with shops property and init method
 *
 * @example
 *   const p = plant(initializedList(shop1, shop2));
 *   p.shops.list(); // [shop1, shop2]
 *   p.init();
 */
export default function plant(shops) {
    return {
        shops,
        init() {
            shops.init();
        },
    };
}
