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
 * Central plant operator catalog via HTTP (/api/v1/operators).
 * Supports pull for sync, create for edge proxy writes, and enabled for registration flag.
 *
 * @param {object} client - HTTP client with getJson(path, query) and postJson(path, body)
 * @param {string} basePath - plant API base path
 * @returns {object} source with pull(), create(fields), enabled()
 *
 * @example
 *   const source = centralOperators(stateHttpClient({ baseUrl: 'http://central:3000' }), '/api/v1');
 *   const rows = await source.pull();
 *   const flag = await source.enabled();
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
        },
        async create(fields) {
            const row = await client.postJson(`${basePath}/operators`, fields);
            return operatorFromJson(row);
        },
        async enabled() {
            const payload = await client.getJson(`${basePath}/operators/registration-enabled`, {});
            if (!payload || typeof payload.enabled !== 'boolean') {
                throw new Error(
                    `central registration-enabled response missing enabled boolean from ${basePath}/operators/registration-enabled`
                );
            }
            return payload.enabled;
        }
    };
}
