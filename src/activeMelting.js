import completedMelting from './completedMelting.js';

/**
 * In-progress melting session that can be stopped to produce a completed melting.
 * Notifies the callback when stopped to enable automatic collection updates.
 *
 * @param {string} id - unique melting session identifier
 * @param {object} machine - the melting machine running this session
 * @param {Date} startTime - when the melting session started
 * @param {function} onStop - callback invoked with completedMelting when stopped
 * @returns {object} active melting with id and stop methods
 *
 * @example
 *   const active = activeMelting('m1', machine, new Date(), function(completed) {
 *       console.log('Melting completed:', completed.id());
 *   });
 *   active.id(); // 'm1'
 *   const completed = active.stop();
 */
export default function activeMelting(id, machine, startTime, onStop) {
    return {
        id() {
            return id;
        },
        stop() {
            const end = new Date();
            const range = { start: startTime, end };
            const completed = completedMelting(id, startTime, end, machine.measurements(range));
            onStop(completed);
            return completed;
        }
    };
}
