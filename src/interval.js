/**
 * Periodic action executor wrapping setInterval.
 *
 * @param {number} period - interval in milliseconds
 * @param {function} action - callback to execute periodically
 * @returns {object} interval with start method
 *
 * @example
 *   const i = interval(1000, function() { console.log('tick'); });
 *   i.start();
 */
export default function interval(period, action) {
    return {
        start() {
            setInterval(action, period);
        }
    };
}
