/**
 * Resolves operator records by numeric id from a list provider.
 *
 * @param {object} provider - operators provider with list()
 * @returns {object} resolver with resolve(operatorId)
 *
 * @example
 *   const lookup = operatorById(operatorsFromPg(pool));
 *   const row = await lookup.resolve(3);
 */
export default function operatorById(provider) {
    if (!provider || typeof provider.list !== 'function') {
        throw new Error('Provider must have a list() method');
    }
    return {
        /**
         * Finds an operator by id or returns undefined when absent.
         *
         * @param {number|string} operatorId - operator primary key
         * @returns {Promise<object|undefined>} operator or undefined
         */
        async resolve(operatorId) {
            const id = Number(operatorId);
            if (!Number.isFinite(id)) {
                throw new RangeError(`Invalid operator id ${operatorId}`);
            }
            const rows = await provider.list();
            return rows.find((row) => {
                return row.id === id;
            });
        }
    };
}
