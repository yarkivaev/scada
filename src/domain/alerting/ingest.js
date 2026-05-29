/**
 * Maps alert ingest status to persistence action.
 *
 * @param {object} record - alert record with status field
 * @returns {string|undefined} action name insert or acknowledge
 *
 * @example
 *   alertIngestAction({ status: 'pending' });
 */
export function alertIngestAction(record) {
    if (record.status === 'pending') {
        return 'insert';
    }
    if (record.status === 'completed') {
        return 'acknowledge';
    }
    return undefined;
}
