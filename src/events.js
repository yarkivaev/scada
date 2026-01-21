import pubsub from './pubsub.js';

/**
 * Append-only event log for system occurrences.
 * Events are immutable and never modified after creation.
 * Optionally evaluates rules when events are created.
 *
 * @param {function} factory - factory function to create event records
 * @param {object} rules - optional rules collection to evaluate on create
 * @returns {object} log with create, all, find, stream methods
 *
 * @example
 *   const log = events(event, rules([rule1, rule2]));
 *   const e = log.create(new Date(), {machine: 'icht1'}, ['sensor']);
 *   log.all();                              // returns all events
 *   log.all((e) => e.labels().includes('sensor')); // filter events
 *   log.find('ev-0');                       // find by id
 *   log.stream((evt) => console.log(evt));  // subscribe to new events
 */
export default function events(factory, rules) {
    const items = [];
    const bus = pubsub();
    let counter = 0;
    return {
        create(timestamp, properties, labels) {
            const id = `ev-${counter}`;
            counter += 1;
            const tags = labels === undefined ? [] : labels;
            const e = factory(id, timestamp, properties, tags);
            items.push(e);
            bus.emit({ type: 'created', event: e });
            if (rules !== undefined) {
                rules.evaluate({ event: e });
            }
            return e;
        },
        all(...filters) {
            return items.filter((e) => {
                return filters.every((filter) => {
                    return filter(e);
                });
            });
        },
        find(id) {
            return items.find((e) => {
                return e.id() === id;
            });
        },
        stream: bus.stream
    };
}
