/**
 * Edge operators provider: local cache for reads, central proxy for create.
 * Registration flag writes are central-only; edge returns 405 on permit.
 *
 * @param {object} cache - in-memory operators with list, replace, enabled, permit
 * @param {object} [source] - centralOperators with create and pull, or undefined
 * @returns {object} provider with list, create, enabled, permit
 *
 * @example
 *   const provider = edgeOperators(operators(), centralOperators(client, '/api/v1'));
 *   await provider.create({ cardUid: 'AB12', firstName: 'Иван', lastName: 'Петров', displayName: 'Иван Петров' });
 */
export default function edgeOperators(cache, source) {
    return {
        list() {
            return cache.list();
        },
        async create(fields) {
            if (!source) {
                const err = new Error('CENTRAL_PLANT_URL is required for edge operator create');
                err.routeCode = 'SERVICE_UNAVAILABLE';
                err.routeStatus = 503;
                throw err;
            }
            const created = await source.create(fields);
            cache.replace(await source.pull());
            return created;
        },
        enabled() {
            return cache.enabled();
        },
        permit() {
            const err = new Error('edge operator registration flag write is not supported');
            err.routeCode = 'METHOD_NOT_ALLOWED';
            err.routeStatus = 405;
            return Promise.reject(err);
        }
    };
}
