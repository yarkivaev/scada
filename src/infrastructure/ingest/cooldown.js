/**
 * Decorator that rate-limits an issue callback by message.
 * Blocks duplicate messages within the cooldown interval.
 *
 * @param {function} issue - callback to wrap (message, timestamp)
 * @param {number} interval - cooldown interval in milliseconds
 * @returns {function} wrapped callback that enforces cooldown
 *
 * @example
 *   const limited = cooldown(console.log, 60000);
 *   limited('alert', new Date()); // fires
 *   limited('alert', new Date()); // blocked (within 60s)
 */
export default function cooldown(issue, interval) {
    const history = {};
    return function limited(message, timestamp) {
        const now = timestamp.getTime();
        const last = history[message] || 0;
        if (now - last >= interval) {
            history[message] = now;
            issue(message, timestamp);
        }
    };
}
