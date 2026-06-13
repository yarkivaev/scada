import operator from '../../domain/operator/operator.js';

function operatorFromJson(row) {
    if (row.id === undefined || row.id === null) {
        throw new Error('central operators item missing id');
    }
    if (!row.cardUid) {
        throw new Error('central operators item missing cardUid');
    }
    if (!row.firstName) {
        throw new Error('central operators item missing firstName');
    }
    if (!row.lastName) {
        throw new Error('central operators item missing lastName');
    }
    if (!row.displayName) {
        throw new Error('central operators item missing displayName');
    }
    return operator(row.id, row.cardUid, row.firstName, row.lastName, row.displayName);
}

/**
 * Central plant operator catalog via GET /api/v1/operators.
 *
 * @param {object} client - HTTP client with getJson(path, query)
 * @param {string} basePath - plant API base path
 * @returns {object} source with pull()
 *
 * @example
 *   const source = centralOperators(stateHttpClient({ baseUrl: 'http://central:3000' }), '/api/v1');
 *   const rows = await source.pull();
 */
export default function centralOperators(client, basePath) {
    return {
        async pull() {
            const payload = await client.getJson(`${basePath}/operators`, {});
            if (!payload || !Array.isArray(payload.items)) {
                throw new Error(`central operators response missing items array from ${basePath}/operators`);
            }
            return payload.items.map((row) => {
                return operatorFromJson(row);
            });
        }
    };
}
