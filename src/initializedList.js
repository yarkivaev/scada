/**
 * List wrapper that provides iteration and batch initialization.
 * Calls init() on each item when initialized.
 *
 * @param {...object} items - objects with init method
 * @returns {object} list with list and init methods
 *
 * @example
 *   const l = initializedList(machine1, machine2);
 *   l.list(); // [machine1, machine2]
 *   l.init(); // calls init on each item
 */
export default function initializedList(...items) {
    return {
        list() {
            return items;
        },
        init() {
            items.forEach((item) => {
                item.init();
            });
        }
    };
}
