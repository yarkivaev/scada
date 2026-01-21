/**
 * Top-level plant structure containing melting shops.
 * Provides initialization for all contained shops.
 *
 * @param {object} shops - initialized list of melting shops
 * @param {object} events - events collection shared by all shops
 * @returns {object} plant with shops, events properties and init method
 *
 * @example
 *   const p = plant(initializedList(shop1, shop2), events(event, rules));
 *   p.shops.list(); // [shop1, shop2]
 *   p.events.create(new Date(), {}, ['label']);
 *   p.init();
 */
export default function plant(shops, events) {
    return {
        shops,
        events,
        init() {
            shops.init();
        },
    };
}
