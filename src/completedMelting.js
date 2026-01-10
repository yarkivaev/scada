import meltingChronology from './meltingChronology.js';

/**
 * Immutable record of a finished melting session.
 * Chronology is bound to machine and derives values from machine's weight history.
 * Notifies callback when updated.
 *
 * @param {string} id - unique melting session identifier
 * @param {object} machine - the machine that performed this melting
 * @param {object} chron - chronology bound to machine with start/end times
 * @param {function} onUpdate - callback invoked when melting is updated
 * @returns {object} completed melting with id, machine, chronology, update methods
 *
 * @example
 *   const completed = completedMelting('m1', machine, chron, onUpdate);
 *   completed.id(); // 'm1'
 *   completed.chronology().get().start; // start time
 *   completed.chronology().get().end; // end time
 */
export default function completedMelting(id, machine, chron, onUpdate) {
    return {
        id() {
            return id;
        },
        machine() {
            return machine;
        },
        chronology() {
            return chron;
        },
        update(data) {
            const opts = data === undefined ? {} : data;
            const original = chron.get();
            const newStart = opts.start === undefined ? original.start : new Date(opts.start);
            const newEnd = opts.end === undefined ? original.end : new Date(opts.end);
            const updated = meltingChronology(machine, newStart, newEnd);
            const result = completedMelting(id, machine, updated, onUpdate);
            onUpdate(result);
            return result;
        }
    };
}
