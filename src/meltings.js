import events from './events.js';

/**
 * Collection of melting sessions associated with machines.
 * Automatically generates unique IDs and updates when sessions complete.
 *
 * @param {function} melting - factory function to create active meltings
 * @returns {object} collection with start, all, find, stream methods
 *
 * @example
 *   const list = meltings(activeMelting);
 *   const active = list.start(machine);
 *   active.stop();
 *   list.all(); // returns completed meltings only
 *   list.find(machine); // returns completed meltings for machine
 *   list.stream((event) => console.log(event)); // subscribe to events
 */
export default function meltings(melting) {
    const items = [];
    const bus = events();
    let counter = 0;
    return {
        start(machine) {
            counter += 1;
            const id = `m${  counter}`;
            const item = { machine, melting: null };
            items.push(item);
            const active = melting(id, machine, new Date(), (completed) => {
                item.melting = completed;
                bus.emit({ type: 'completed', melting: completed });
            });
            item.melting = active;
            bus.emit({ type: 'started', melting: active });
            return active;
        },
        all() {
            return items.filter((item) => {
                return item.melting.end;
            });
        },
        find(machine) {
            return items.filter((item) => {
                return item.machine === machine && item.melting.end;
            }).map((item) => {
                return item.melting;
            });
        },
        stream: bus.stream
    };
}
