/**
 * Immutable alert record with acknowledgment capability.
 * Represents a single alert event from a monitored object.
 *
 * @param {string} message - alert description
 * @param {Date} timestamp - when the alert occurred
 * @param {string} object - identifier of the object that raised the alert
 * @param {function} acknowledge - callback to dismiss the alert
 * @returns {object} alert with message, timestamp, object, acknowledge, acknowledged properties
 *
 * @example
 *   const a = alert('High voltage', new Date(), 'icht1', ackCallback);
 *   a.message; // 'High voltage'
 *   a.acknowledged; // false
 *   a.acknowledge(); // triggers callback
 */
export function alert(message, timestamp, object, acknowledge) {
    return {
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
 * @param {string} message - alert description
 * @param {Date} timestamp - when the alert occurred
 * @param {string} object - identifier of the object that raised the alert
 * @returns {object} acknowledged alert with message, timestamp, object, acknowledged properties
 *
 * @example
 *   const a = acknowledgedAlert('High voltage', new Date(), 'icht1');
 *   a.message; // 'High voltage'
 *   a.acknowledged; // true
 */
export function acknowledgedAlert(message, timestamp, object) {
    return {
        message,
        timestamp,
        object,
        acknowledged: true
    };
}
