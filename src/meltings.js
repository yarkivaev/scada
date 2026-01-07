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
    const subscribers = [];
    let counter = 0;
    function notify(event) {
        subscribers.forEach((callback) => {
            callback(event);
        });
    }
    return {
        start(machine) {
            counter += 1;
            const id = `m${  counter}`;
            const item = { machine, melting: null };
            items.push(item);
            const active = melting(id, machine, new Date(), (completed) => {
                item.melting = completed;
                notify({ type: 'completed', melting: completed });
            });
            item.melting = active;
            notify({ type: 'started', melting: active });
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
        stream(callback) {
            subscribers.push(callback);
            return {
                cancel() {
                    const index = subscribers.indexOf(callback);
                    subscribers.splice(index, 1);
                }
            };
        }
    };
}
