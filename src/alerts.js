/**
 * History of alert occurrences with filtering support.
 * Creates and stores alert events, replaces with acknowledged version on acknowledge.
 *
 * @param {function} alert - factory function to create alerts
 * @param {function} acknowledgedAlert - factory function to create acknowledged alerts
 * @returns {object} alerts history with trigger, all methods
 *
 * @example
 *   const history = alerts(alert, acknowledgedAlert);
 *   const a = history.trigger('High voltage', new Date(), 'icht1');
 *   a.acknowledge(); // replaces with acknowledged version
 */
export default function alerts(alert, acknowledgedAlert) {
    const items = [];
    return {
        trigger(message, timestamp, object) {
            const index = items.length;
            const created = alert(message, timestamp, object, () => {
                const acknowledged = acknowledgedAlert(message, timestamp, object);
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
        }
    };
}
