/**
 * In-memory alert hydration port for tests and local runs.
 *
 * @param {object} store - shared mutable store with alerts array
 * @returns {object} alerts port with listUnacknowledged
 */
export default function alertsStateMemory(store) {
    return {
        listUnacknowledged(filters) {
            let rows = store.alerts.filter((row) => {
                return row.acknowledged === false;
            });
            if (filters.machine) {
                rows = rows.filter((row) => {
                    return row.machine === filters.machine;
                });
            }
            return rows;
        }
    };
}
