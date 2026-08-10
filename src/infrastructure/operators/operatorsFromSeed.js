/**
 * In-memory operators provider for tests and local wiring.
 * Implements the operators provider port: list().
 *
 * @param {array} seed - operator records supplied by caller
 * @returns {object} provider with async list()
 *
 * @example
 *   const provider = operatorsFromSeed([operator(1, 'card-1', 'Ivan', 'Petrov', 'Ivan Petrov')]);
 *   const rows = await provider.list();
 */
export default function operatorsFromSeed(seed) {
    return {
        list() {
            return Promise.resolve(seed);
        }
    };
}
