/**
 * Fake clock for deterministic ingest tests.
 *
 * @param {number} [initial=0] - Initial time in milliseconds
 * @returns {object} Clock with millis() and advance(ms)
 */
export default function fakeClock(initial = 0) {
    let time = initial;
    return {
        millis() {
            return time;
        },
        advance(ms) {
            time += ms;
        }
    };
}
