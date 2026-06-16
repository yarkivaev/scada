/**
 * Immutable operator identity for central audit and HMI card lookup.
 *
 * @param {number} id - database primary key
 * @param {string} cardUid - RFID or badge identifier
 * @param {string} firstName - given name
 * @param {string} lastName - family name
 * @param {string} displayName - full name shown in HMI
 * @returns {object} operator with id, cardUid, firstName, lastName, displayName
 *
 * @example
 *   const op = operator(1, 'dev-card-001', 'Иван', 'Петров', 'Иван Петров');
 *   op.displayName;
 */
export default function operator(id, cardUid, firstName, lastName, displayName) {
    return {
        id,
        cardUid,
        firstName,
        lastName,
        displayName
    };
}
