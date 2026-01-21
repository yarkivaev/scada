/**
 * Immutable event record with properties and labels.
 * Represents a single occurrence in the system log.
 *
 * @param {string} id - unique event identifier
 * @param {Date} timestamp - when the event occurred
 * @param {object} properties - event-specific data
 * @param {string[]} labels - classification tags for the event
 * @returns {object} event with id, timestamp, properties, labels methods
 *
 * @example
 *   const e = event('ev-1', new Date(), {machine: 'icht1', voltage: 340}, ['sensor']);
 *   e.id();         // 'ev-1'
 *   e.labels();     // ['sensor']
 *   e.properties(); // {machine: 'icht1', voltage: 340}
 */
export default function event(id, timestamp, properties, labels) {
    return {
        id: () => {return id},
        timestamp: () => {return timestamp},
        properties: () => {return properties},
        labels: () => {return [...labels]}
    };
}
