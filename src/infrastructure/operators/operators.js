/**
 * In-memory operators provider for edge site-server.
 * Implements the operators provider port: list() and replace(items) for central sync.
 *
 * @param {array} [seed] - optional initial operators
 * @returns {object} provider with list() and replace(items)
 *
 * @example
 *   const provider = operators();
 *   provider.replace([operator(1, 'card-1', 'Иван', 'Петров', 'Иван Петров')]);
 *   const rows = await provider.list();
 */
export default function operators(seed) {
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
