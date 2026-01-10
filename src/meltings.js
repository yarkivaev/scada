/* eslint-disable max-lines-per-function, max-statements */
import events from './events.js';
import meltingChronology from './meltingChronology.js';
import activeMelting from './activeMelting.js';
import completedMelting from './completedMelting.js';

/**
 * Collection of melting sessions associated with machines.
 * Uses add() for creating both active and completed meltings.
 * Uses query() for filtering and streaming meltings.
 *
 * @returns {object} collection with add, query methods
 *
 * @example
 *   const list = meltings();
 *   const active = list.add(machine, {}); // creates active melting
 *   const completed = list.add(machine, { start, end }); // creates completed melting
 *   list.query(); // returns all completed meltings
 *   list.query({ machine }); // returns meltings for machine
 *   list.query({ id: 'm1' }); // returns melting by id
 *   list.query({ stream: callback }); // subscribe to events
 */
export default function meltings() {
    const items = [];
    const bus = events();
    let counter = 0;
    function onUpdate(id, updated) {
        const item = items.find((i) => {
            return i.melting.id() === id;
        });
        if (item) {
            item.melting = updated;
            bus.emit({ type: 'updated', melting: updated });
        }
    }
    return {
        add(machine, data) {
            const opts = data === undefined ? {} : data;
            if (opts.end === undefined) {
                const existing = items.find((i) => {
                    const chron = i.melting.chronology().get();
                    return i.machine === machine && chron.end === undefined;
                });
                if (existing) {
                    return existing.melting;
                }
            }
            counter += 1;
            const id = `m${counter}`;
            if (opts.end !== undefined) {
                const chron = meltingChronology(machine, new Date(opts.start), new Date(opts.end));
                const completed = completedMelting(id, machine, chron, (updated) => {
                    onUpdate(id, updated);
                });
                items.push({ machine, melting: completed });
                bus.emit({ type: 'completed', melting: completed });
                return completed;
            }
            const start = opts.start === undefined ? new Date() : new Date(opts.start);
            const item = { machine, melting: null };
            items.push(item);
            const active = activeMelting(id, machine, start, (completed) => {
                item.melting = completed;
                bus.emit({ type: 'completed', melting: completed });
            }, (updated) => {
                onUpdate(id, updated);
            });
            item.melting = active;
            bus.emit({ type: 'started', melting: active });
            return active;
        },
        query(options) {
            const opts = options === undefined ? {} : options;
            if (opts.stream !== undefined) {
                return bus.stream(opts.stream);
            }
            if (opts.id !== undefined) {
                const item = items.find((i) => {
                    return i.melting.id() === opts.id;
                });
                return item === undefined ? undefined : item.melting;
            }
            if (opts.machine !== undefined) {
                return items.filter((i) => {
                    return i.machine === opts.machine;
                }).map((i) => {
                    return i.melting;
                });
            }
            return items.filter((i) => {
                return i.melting.chronology().get().end !== undefined;
            }).map((i) => {
                return i.melting;
            });
        }
    };
}
