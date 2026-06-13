/**
 * In-memory operators cache for edge site-server.
 * Storage is memory-only; snapshot is lost on restart until the next successful sync.
 * Implements the operators provider port: list().
 *
 * @param {array} [seed] - optional initial operators
 * @returns {object} provider with list() and replace(items)
 *
 * @example
 *   const cache = operatorsFromCache();
 *   cache.replace([operator(1, 'card-1', 'Иван', 'Петров', 'Иван Петров')]);
 *   const rows = await cache.list();
 */
export default function operatorsFromCache(seed) {
    let snapshot = seed ? seed.slice() : [];
    return {
        list() {
            return Promise.resolve(snapshot.slice());
        },
        replace(items) {
            snapshot = items.slice();
        }
    };
}
