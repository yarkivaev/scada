/**
 * Immutable record of a finished melting session.
 * Contains timing information and measurements captured during the session.
 *
 * @param {string} id - unique melting session identifier
 * @param {Date} startTime - when the melting session started
 * @param {Date} endTime - when the melting session ended
 * @param {object} measurements - measurements captured during the session
 * @returns {object} completed melting with id, start, end, measurements methods
 *
 * @example
 *   const completed = completedMelting('m1', startTime, endTime, []);
 *   completed.id(); // 'm1'
 *   completed.start(); // start timestamp
 *   completed.end(); // end timestamp
 */
export default function completedMelting(id, startTime, endTime, measurements) {
    return {
        id() {
            return id;
        },
        start() {
            return startTime;
        },
        end() {
            return endTime;
        },
        measurements() {
            return measurements;
        }
    };
}
