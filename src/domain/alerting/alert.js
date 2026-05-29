/* eslint-disable max-params */
/**
 * Immutable alert record with acknowledgment capability.
 * Represents a single actionable item for supervisors.
 *
 * @param {string} id - unique alert identifier
 * @param {string} message - alert description
 * @param {Date} timestamp - when the alert occurred
 * @param {string} object - identifier of the object that raised the alert
 * @param {object} source - optional source event that triggered this alert
 * @param {function} acknowledge - callback to dismiss the alert
 * @returns {object} alert with id, message, timestamp, object, event, acknowledge, acknowledged
 *
 * @example
 *   const a = alert('alert-1', 'High voltage', new Date(), 'icht1', srcEvent, ackCallback);
 *   a.id; // 'alert-1'
 *   a.event; // srcEvent reference
 *   a.acknowledged; // false
 *   a.acknowledge(); // triggers callback
 */
export function alert(id, message, timestamp, object, source, acknowledge) {
    return {
        id,
        message,
        timestamp,
        object,
        event: source,
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
 * @param {object} source - optional source event that triggered this alert
 * @returns {object} acknowledged alert with id, message, timestamp, object, event, acknowledged
 *
 * @example
 *   const a = acknowledgedAlert('alert-1', 'High voltage', new Date(), 'icht1', srcEvent);
 *   a.id; // 'alert-1'
 *   a.event; // srcEvent reference
 *   a.acknowledged; // true
 */
export function acknowledgedAlert(id, message, timestamp, object, source) {
    return {
        id,
        message,
        timestamp,
        object,
        event: source,
        acknowledged: true
    };
}
