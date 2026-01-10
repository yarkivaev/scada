import meltingChronology from './meltingChronology.js';
import completedMelting from './completedMelting.js';

/**
 * In-progress melting session that can be stopped to produce a completed melting.
 * Chronology is bound to machine and derives values from machine's weight history.
 * Notifies callbacks when stopped or updated.
 *
 * @param {string} id - unique melting session identifier
 * @param {object} machine - the melting machine running this session
 * @param {Date} start - when the melting session started
 * @param {function} onStop - callback invoked with completedMelting when stopped
 * @param {function} onUpdate - callback invoked when melting is updated
 * @returns {object} active melting with id, machine, chronology, stop, update methods
 *
 * @example
 *   const active = activeMelting('m1', machine, new Date(), onStop, onUpdate);
 *   machine.load(500);
 *   machine.dispense(480);
 *   const completed = active.stop();
 */
export default function activeMelting(id, machine, start, onStop, onUpdate) {
    return {
        id() {
            return id;
        },
        machine() {
            return machine;
        },
        chronology() {
            return meltingChronology(machine, start, undefined);
        },
        stop() {
            const end = new Date();
            const chron = meltingChronology(machine, start, end);
            const completed = completedMelting(id, machine, chron, onUpdate);
            onStop(completed);
            return completed;
        },
        update(data) {
            const opts = data === undefined ? {} : data;
            const newStart = opts.start === undefined ? start : new Date(opts.start);
            if (opts.end !== undefined) {
                const chron = meltingChronology(machine, newStart, new Date(opts.end));
                const completed = completedMelting(id, machine, chron, onUpdate);
                onStop(completed);
                return completed;
            }
            const updated = activeMelting(id, machine, newStart, onStop, onUpdate);
            onUpdate(updated);
            return updated;
        }
    };
}
