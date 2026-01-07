/**
 * Immutable alert record with acknowledgment capability.
 * Represents a single alert event from a monitored object.
 *
 * @param {string} id - unique alert identifier
 * @param {string} message - alert description
 * @param {Date} timestamp - when the alert occurred
 * @param {string} object - identifier of the object that raised the alert
 * @param {function} acknowledge - callback to dismiss the alert
 * @returns {object} alert with id, message, timestamp, object, acknowledge, acknowledged properties
 *
 * @example
 *   const a = alert('alert-1', 'High voltage', new Date(), 'icht1', ackCallback);
 *   a.id; // 'alert-1'
 *   a.acknowledged; // false
 *   a.acknowledge(); // triggers callback
 */
export function alert(id, message, timestamp, object, acknowledge) {
    return {
        id,
        message,
        timestamp,
        object,
        acknowledge,
        acknowledged: false
    };
}

/**
 * Immutable acknowledged alert record.
 * Represents an alert that has been acknowledged by the user.
 *
 * @param {string} id - unique alert identifier
 * @param {string} message - alert description
 * @param {Date} timestamp - when the alert occurred
 * @param {string} object - identifier of the object that raised the alert
 * @returns {object} acknowledged alert with id, message, timestamp, object, acknowledged properties
 *
 * @example
 *   const a = acknowledgedAlert('alert-1', 'High voltage', new Date(), 'icht1');
 *   a.id; // 'alert-1'
 *   a.acknowledged; // true
 */
export function acknowledgedAlert(id, message, timestamp, object) {
    return {
        id,
        message,
        timestamp,
        object,
        acknowledged: true
    };
}
