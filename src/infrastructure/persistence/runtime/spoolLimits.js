import { spoolCheckpointLimits } from './spoolCheckpoints.js';

export default function spoolLimits({ maxBytes, maxRecords = 100000, legacyMigrationMaxBytes = 16 * 1024 * 1024, walCheckpoint } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) { throw new TypeError('Explicit positive spool maxBytes required'); }
    if (!Number.isSafeInteger(maxRecords) || maxRecords <= 0) { throw new TypeError('Positive safe spool maxRecords required'); }
    if (!Number.isSafeInteger(legacyMigrationMaxBytes) || legacyMigrationMaxBytes <= 0) { throw new TypeError('Positive safe legacyMigrationMaxBytes required'); }
    return { maxBytes, maxRecords, legacyMigrationMaxBytes, walCheckpoint: spoolCheckpointLimits(walCheckpoint) };
}
