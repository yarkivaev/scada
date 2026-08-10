/**
 * Immutable generic machine operation record.
 *
 * @param {string} machine - machine identifier
 * @param {Date} occurredAt - when the operation occurred on the machine
 * @param {string} kind - opaque operation category defined by the plant package
 * @param {string} key - idempotent storage key
 * @param {object} payload - structured operation body
 * @returns {object} operation value with machine, occurredAt, kind, key, payload
 *
 * @example
 *   const item = operation('m1', new Date(), 'sample', 'nb-1', { lot: 'A' });
 *   item.key;
 */
export function operation(machine, occurredAt, kind, key, payload) {
    return {
        machine,
        occurredAt,
        kind,
        key,
        payload
    };
}
