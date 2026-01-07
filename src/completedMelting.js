/**
 * Immutable record of a finished melting session.
 * Contains timing, machine reference, and metal load/dispense chronology.
 *
 * @param {string} id - unique melting session identifier
 * @param {object} machine - the machine that performed this melting
 * @param {Date} startTime - when the melting session started
 * @param {Date} endTime - when the melting session ended
 * @param {object} chronology - chronology tracking load/dispense events
 * @returns {object} completed melting with id, machine, start, end, chronology methods
 *
 * @example
 *   const completed = completedMelting('m1', machine, startTime, endTime, chronology);
 *   completed.id(); // 'm1'
 *   completed.chronology().get().loaded; // 500
 */
export default function completedMelting(id, machine, startTime, endTime, chronology) {
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
        end() {
            return endTime;
        },
        chronology() {
            return chronology;
        }
    };
}
