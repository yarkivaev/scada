/**
 * Silence budget for persistence-side open segment close.
 * Mirrors supervisor Segmentation: wall-clock idle of machine.window * 2.
 *
 * @param {number} window - supervisor machine window in seconds
 * @returns {number} silence budget in seconds
 *
 * @example
 *   silenceBudget(15);
 */
export default function silenceBudget(window) {
    if (typeof window !== 'number' || !(window > 0)) {
        throw new Error(`Window must be a positive number: ${window}`);
    }
    return window * 2;
}
