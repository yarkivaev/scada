/**
 * Maps an operator domain record to REST JSON shape.
 *
 * @param {object} row - operator with id, cardUid, firstName, lastName, displayName
 * @returns {object} JSON-serializable operator
 *
 * @example
 *   operatorJson({ id: 1, cardUid: 'dev-card-001', firstName: 'Иван', lastName: 'Петров', displayName: 'Иван Петров' });
 */
export default function operatorJson(row) {
    return {
        id: row.id,
        cardUid: row.cardUid,
        firstName: row.firstName,
        lastName: row.lastName,
        displayName: row.displayName
    };
}
