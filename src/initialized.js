/**
 * Wrapper that provides batch initialization for a collection.
 * init() initializes items once, get() returns the collection.
 *
 * @param {object} collection - object or array containing items with init method
 * @param {function} toList - function that extracts array of items from collection
 * @returns {object} wrapper with init() and get() methods
 *
 * @example
 *   const machines = initialized({ icht1: machine }, Object.values);
 *   machines.init();        // initializes all items once
 *   machines.get().icht1;   // access by key
 *   Object.values(machines.get()); // iterate
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
        },
        get() {
            return collection;
        }
    };
}
