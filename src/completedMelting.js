/**
 * Immutable record of a finished melting session.
 * Contains timing information and machine reference for querying sensor data.
 *
 * @param {string} id - unique melting session identifier
 * @param {object} machine - the machine that performed this melting
 * @param {Date} startTime - when the melting session started
 * @param {Date} endTime - when the melting session ended
 * @returns {object} completed melting with id, machine, start, end methods
 *
 * @example
 *   const completed = completedMelting('m1', machine, startTime, endTime);
 *   completed.id(); // 'm1'
 *   const range = { start: completed.start(), end: completed.end() };
 *   completed.machine().sensors.voltage.measurements(range, 1000);
 */
export default function completedMelting(id, machine, startTime, endTime) {
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
        }
    };
}
