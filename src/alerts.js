import pubsub from './pubsub.js';

/**
 * History of alert occurrences with filtering support.
 * Creates and stores alerts, replaces with acknowledged version on acknowledge.
 * Generates unique IDs for each alert.
 *
 * @param {function} alert - factory function to create alerts
 * @param {function} acknowledgedAlert - factory function to create acknowledged alerts
 * @returns {object} alerts history with trigger, all, find, stream methods
 *
 * @example
 *   const history = alerts(alert, acknowledgedAlert);
 *   const a = history.trigger('High voltage', new Date(), 'icht1');
 *   a.id; // 'alert-0'
 *   a.acknowledge(); // replaces with acknowledged version
 *   history.trigger('From event', new Date(), 'icht1', sourceEvent); // with event
 *   history.stream((evt) => console.log(evt)); // subscribe to events
 */
export default function alerts(alert, acknowledgedAlert) {
    const items = [];
    const bus = pubsub();
    let counter = 0;
    return {
        trigger(message, timestamp, object, source) {
            const id = `alert-${counter}`;
            counter += 1;
            const index = items.length;
            const created = alert(id, message, timestamp, object, source, () => {
                const acknowledged = acknowledgedAlert(id, message, timestamp, object, source);
                items[index] = acknowledged;
                bus.emit({ type: 'acknowledged', alert: acknowledged });
            });
            items.push(created);
            bus.emit({ type: 'created', alert: created });
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
        },
        stream: bus.stream
    };
}
