/* eslint-disable max-params */
/**
 * Immutable generic machine operation record from an external structured source.
 *
 * @param {string} machine - machine identifier
 * @param {Date} occurredAt - when the operation occurred on the machine
 * @param {string} kind - operation category (chem analysis, QC, etc)
 * @param {string} externalKey - idempotent key from the external source
 * @param {object} payload - structured operation body
 * @param {Date} sourceUpdatedAt - last update timestamp in the external source
 * @param {string} sourceId - identifier in the external source
 * @param {Date} ingestedAt - when SCADA stored the operation
 * @returns {object} operation value with machine, occurredAt, kind, externalKey, payload, sourceUpdatedAt, sourceId, ingestedAt
 *
 * @example
 *   const item = operation('icht1', new Date(), 'chem', 'nb-1', { lot: 'A' }, new Date(), '99', new Date());
 *   item.externalKey;
 */
export function operation(machine, occurredAt, kind, externalKey, payload, sourceUpdatedAt, sourceId, ingestedAt) {
    return {
        machine,
        occurredAt,
        kind,
        externalKey,
        payload,
        sourceUpdatedAt,
        sourceId,
        ingestedAt
    };
}
