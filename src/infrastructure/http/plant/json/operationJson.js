function iso(value) {
    if (value instanceof Date) {
        return value.toISOString();
    }
    return new Date(value).toISOString();
}

/**
 * Maps persistence operation row to Plant API JSON item.
 *
 * @param {object} row - operation row from persistence
 * @returns {object} API item with external_key and source_updated_at
 *
 * @example
 *   operationJson({ key: 'nb-1', occurred_at: new Date(), kind: 'chem', payload: {}, machine: 'icht1' });
 */
export default function operationJson(row) {
    const occurred = iso(row.occurred_at);
    const updated = row.source_updated_at ? iso(row.source_updated_at) : occurred;
    return {
        external_key: row.key,
        occurred_at: occurred,
        kind: row.kind,
        payload: row.payload,
        machine: row.machine,
        source_updated_at: updated
    };
}
