/**
 * History of alert occurrences with filtering support.
 * Creates and stores alert events, replaces with acknowledged version on acknowledge.
 * Generates unique IDs for each alert.
 *
 * @param {function} alert - factory function to create alerts
 * @param {function} acknowledgedAlert - factory function to create acknowledged alerts
 * @returns {object} alerts history with trigger, all, find methods
 *
 * @example
 *   const history = alerts(alert, acknowledgedAlert);
 *   const a = history.trigger('High voltage', new Date(), 'icht1');
 *   a.id; // 'alert-0'
 *   a.acknowledge(); // replaces with acknowledged version
 */
export default function alerts(alert, acknowledgedAlert) {
    const items = [];
    let counter = 0;
    return {
        trigger(message, timestamp, object) {
            const id = `alert-${counter}`;
            counter += 1;
            const index = items.length;
            const created = alert(id, message, timestamp, object, () => {
                const acknowledged = acknowledgedAlert(id, message, timestamp, object);
                items[index] = acknowledged;
            });
            items.push(created);
            return created;
        },
        all(...filters) {
            return items.filter((a) => {
                return filters.every((filter) => {
                    return filter(a);
                });
            });
        },
        find(id) {
            return items.find((a) => {
                return a.id === id;
            });
        }
    };
}
