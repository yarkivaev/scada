/**
 * Returns whether a migration file applies to the given database profile.
 *
 * @param {string} fileName - migration file name
 * @param {string} profile - sink database profile: central or edge
 * @returns {boolean}
 */
export function migrationApplies(fileName, profile) {
    if (fileName.startsWith('E')) {
        return profile === 'edge';
    }
    if (fileName.startsWith('C')) {
        return profile === 'central';
    }
    return true;
}

const privilegedOnly = new Set([
    'C0002__central_revoke_delete.sql',
    'C0004__central_operations_grants.sql',
    'E0002__edge_retention_delete.sql',
    'E0003__edge_operations_grants.sql'
]);

/**
 * Privilege migrations run as scada only, not supervisor_sink.
 *
 * @param {string} fileName - migration file name
 * @returns {boolean}
 */
export function migrationSinkRunnable(fileName) {
    return !privilegedOnly.has(fileName);
}
