import completedMelting from './completedMelting.js';

/**
 * In-progress melting session that can be stopped to produce a completed melting.
 * Tracks metal load/dispense events via chronology during the session.
 * Notifies the callback when stopped to enable automatic collection updates.
 *
 * @param {string} id - unique melting session identifier
 * @param {object} machine - the melting machine running this session
 * @param {Date} startTime - when the melting session started
 * @param {object} chronology - chronology tracking load/dispense events
 * @param {function} onStop - callback invoked with completedMelting when stopped
 * @returns {object} active melting with id, machine, start, chronology, stop methods
 *
 * @example
 *   const active = activeMelting('m1', machine, new Date(), chronology, function(completed) {
 *       console.log('Melting completed:', completed.id());
 *   });
 *   active.chronology().load(500);
 *   active.chronology().dispense(480);
 *   const completed = active.stop();
 */
export default function activeMelting(id, machine, startTime, chronology, onStop) {
    return {
        id() {
            return id;
        },
        machine() {
            return machine;
        },
        start() {
            return startTime;
        },
        chronology() {
            return chronology;
        },
        stop() {
            const completed = completedMelting(id, machine, startTime, new Date(), chronology);
            onStop(completed);
            return completed;
        }
    };
}
