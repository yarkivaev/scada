import { build } from './stompAlertsLogic.js';

/**
 * Loads initial alerts from a hydration port into memory.
 *
 * @param {object} hydrate - port with listUnacknowledged
 * @param {Array} items - mutable items array
 * @param {object} state - shared state with counter
 * @returns {Promise<void>}
 */
export default async function stompAlertsInit(hydrate, items, state) {
    const rows = await hydrate.listUnacknowledged({});
    rows.forEach((row) => {
        items.push(build({
            id: row.id,
            message: row.message,
            timestamp: row.timestamp,
            machine: row.machine,
            acknowledged: row.acknowledged,
            name: row.name
        }));
        state.counter = Math.max(state.counter, row.id);
    });
}
