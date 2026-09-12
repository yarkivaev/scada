/**
 * In-memory alert hydration port for tests and local runs.
 *
 * @param {object} store - shared mutable store with alerts array
 * @returns {object} alerts port with put and listUnacknowledged
 */
export default function alertsStateMemory(store) {
    return {
        put(row) {
            const found = store.alerts.find((item) => {
                return item.machine === row.machine && item.timestamp === row.timestamp && item.name === row.name;
            });
            if (found) {
                return found;
            }
            const created = { id: store.alerts.length + 1, ...row };
            store.alerts.push(created);
            return created;
        },
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
