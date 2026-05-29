/**
 * Shared alert record helpers for STOMP-backed alert history.
 */

/**
 * @param {object} translations - map of rule names to messages
 * @param {string} name - rule identifier
 * @returns {string} translated message or original name
 */
function translate(translations, name) {
    return translations[name] || name;
}

/**
 * @param {object} fields - alert field values
 * @returns {object} normalized alert
 */
export function build({ id, message, timestamp, machine, acknowledged, name }) {
    return {
        id: String(id),
        message,
        timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
        object: machine,
        event: undefined,
        acknowledged,
        name
    };
}

/**
 * @param {object} raw - STOMP frame
 * @param {object} state - shared mutable state
 * @param {object} translations - rule name map
 */
export function consume(raw, state, translations) {
    const parsed = JSON.parse(raw.payload);
    if (parsed.status === 'pending') {
        state.counter += 1;
        const alert = build({ id: state.counter, message: translate(translations, parsed.name), timestamp: new Date(parsed.start * 1000), machine: parsed.machine, acknowledged: false, name: parsed.name });
        state.items.push(alert);
        state.bus.emit({ type: 'created', alert });
    } else if (parsed.status === 'completed') {
        state.items.forEach((existing, index) => {
            if (existing.name === parsed.name && existing.object === parsed.machine && !existing.acknowledged) {
                const replaced = build({ id: existing.id, message: existing.message, timestamp: existing.timestamp, machine: existing.object, acknowledged: true, name: existing.name });
                state.items[index] = replaced;
                state.bus.emit({ type: 'acknowledged', alert: replaced });
            }
        });
    }
}
