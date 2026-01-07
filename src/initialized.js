/**
 * Wrapper that provides batch initialization for a collection.
 * Calls init() on each item once, then returns the collection.
 * Subsequent calls to init() return the collection without re-initializing.
 *
 * @param {object} collection - object or array containing items with init method
 * @param {function} toList - function that extracts array of items from collection
 * @returns {object} wrapper with init method that returns the collection
 *
 * @example
 *   const machines = initialized({ icht1: machine }, Object.values);
 *   machines.init(); // initializes all items once
 *   machines.init().icht1; // returns collection, no re-init
 */
export default function initialized(collection, toList) {
    let done = false;
    return {
        init() {
            if (!done) {
                toList(collection).forEach((item) => {
                    item.init();
                });
                done = true;
            }
            return collection;
        }
    };
}
