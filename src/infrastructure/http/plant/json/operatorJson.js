import operatorExtras, { operatorIdentityKeys } from '../../../operators/operatorExtras.js';

/**
 * Maps an operator domain record to REST JSON shape.
 * Plant-owned attributes beyond identity are passed through unchanged.
 *
 * @param {object} row - operator with id, cardUid, firstName, lastName, displayName
 * @returns {object} JSON-serializable operator
 *
 * @example
 *   operatorJson({ id: 1, cardUid: 'dev-card-001', firstName: 'Ivan', lastName: 'Petrov', displayName: 'Ivan Petrov' });
 */
export default function operatorJson(row) {
    return {
        id: row.id,
        cardUid: row.cardUid,
        firstName: row.firstName,
        lastName: row.lastName,
        displayName: row.displayName,
        ...operatorExtras(row, operatorIdentityKeys())
    };
}
