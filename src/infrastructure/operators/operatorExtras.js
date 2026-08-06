const IDENTITY = ['id', 'cardUid', 'firstName', 'lastName', 'displayName'];
const DRAFT = ['cardUid', 'firstName', 'lastName', 'displayName'];

/**
 * Copies plant-owned operator fields that are outside the shared identity shape.
 *
 * @param {object} row - operator JSON or domain record
 * @param {array} reserved - identity keys owned by scada
 * @returns {object} extra own properties from row
 *
 * @example
 *   operatorExtras({ id: 1, cardUid: 'A', brigade: '2' }, ['id', 'cardUid']);
 */
export default function operatorExtras(row, reserved) {
    const skip = new Set(reserved);
    const extra = {};
    Object.keys(row).forEach((key) => {
        if (!skip.has(key)) {
            extra[key] = row[key];
        }
    });
    return extra;
}

/**
 * Reserved identity keys for operator JSON serialization.
 *
 * @returns {array} identity key names
 */
export function operatorIdentityKeys() {
    return IDENTITY.slice();
}

/**
 * Reserved draft keys for operator create body parsing.
 *
 * @returns {array} draft key names
 */
export function operatorDraftKeys() {
    return DRAFT.slice();
}
