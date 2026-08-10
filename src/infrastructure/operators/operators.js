/**
 * In-memory operators provider for edge site-server.
 * Implements list()/replace(items) for central sync and enabled()/permit(flag) for registration cache.
 *
 * @param {array} [seed] - optional initial operators
 * @returns {object} provider with list, replace, enabled, permit
 *
 * @example
 *   const provider = operators();
 *   provider.replace([operator(1, 'card-1', 'Ivan', 'Petrov', 'Ivan Petrov')]);
 *   await provider.permit(true);
 *   const rows = await provider.list();
 */
export default function operators(seed) {
    let snapshot = seed ? seed.slice() : [];
    let registration = false;
    return {
        list() {
            return Promise.resolve(snapshot.slice());
        },
        replace(items) {
            snapshot = items.slice();
        },
        enabled() {
            return Promise.resolve(registration);
        },
        permit(flag) {
            registration = flag === true;
            return Promise.resolve(registration);
        }
    };
}
